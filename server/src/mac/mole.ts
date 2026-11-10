import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import {
  type CleanPreview,
  type CleanRow,
  type CleanRowKind,
  type CleanSection,
  type DiskEntry,
  type DiskView,
  type InstallerFile,
  type InstallerPreview,
  MOLE_PREVIEW_TTL_MINUTES,
  type MoleReport,
  type MoleRun,
  type MoleStatus,
  type ScanStatus,
} from "../../../shared/mac.js";
import { freeName } from "../files.js";
import { type IsExecutable, resolveBin } from "./bin.js";
import { CleanupConflict } from "./cleanup.js";
import { type CommandRunner, readFreeBytes } from "./collect.js";
import { type SerialQueue, serialQueue } from "./queue.js";

const PREVIEW_TTL_MS = MOLE_PREVIEW_TTL_MINUTES * 60_000;
// `mo --version` is cheap, but the page reads the report on every visit.
const STATUS_TTL_MS = 10 * 60_000;
const TOP_ENTRIES = 25;
const TOP_LARGE_FILES = 10;
const TOP_PATHS = 5;
const NOT_INSTALLED = "Mole no está instalado. Instálalo con: brew install mole";

// Mole prints sizes in decimal units, no space: "2.4GB", "512KB", "0B". A trailing "+" marks a lower bound.
const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
const SIZE = /(\d+(?:\.\d+)?)(B|KB|MB|GB|TB)\+?(?![A-Za-z])/g;

const toBytes = (m: RegExpMatchArray): number => Math.round(Number(m[1]) * (UNITS[m[2] ?? ""] ?? 0));

export const moleBytes = (text: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)(B|KB|MB|GB|TB)\+?$/.exec(text.trim());
  return m ? toBytes(m) : null;
};

const lastSize = (text: string): number | null => {
  const m = [...text.matchAll(SIZE)].at(-1);
  return m ? toBytes(m) : null;
};

export const parseMoleVersion = (text: string): string | null => /^Mole version (\S+)/m.exec(text)?.[1] ?? null;

type AnalyzeEntry = { name?: string; path?: string; size?: number; is_dir?: boolean; insight?: boolean; cleanable?: boolean };

type AnalyzeJson = {
  scan_status?: string;
  path?: string;
  overview?: boolean;
  total_size?: number;
  entries?: AnalyzeEntry[];
  large_files?: AnalyzeEntry[];
};

const hasSize = (e: AnalyzeEntry): e is AnalyzeEntry & { path: string; size: number } =>
  typeof e.path === "string" && typeof e.size === "number";

const SCAN_STATUSES: ScanStatus[] = ["complete", "partial", "unavailable"];

export const parseAnalyze = (text: string): Omit<DiskView, "analyzedAt" | "trail"> => {
  const json = JSON.parse(text) as AnalyzeJson;
  if (!Array.isArray(json.entries)) throw new Error("mo analyze: no entries");
  const entries = json.entries
    .filter(hasSize)
    .filter((e) => e.size > 0)
    .map(
      (e): DiskEntry => ({
        name: e.name ?? basename(e.path),
        path: e.path,
        bytes: e.size,
        isDir: e.is_dir === true,
        insight: e.insight === true,
        cleanable: e.cleanable === true,
      }),
    )
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_ENTRIES);
  const largeFiles = (json.large_files ?? [])
    .filter(hasSize)
    .map((f) => ({ name: f.name ?? basename(f.path), path: f.path, bytes: f.size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_LARGE_FILES);
  const status = SCAN_STATUSES.find((s) => s === json.scan_status) ?? "partial";
  return {
    path: json.overview ? null : (json.path ?? null),
    scanStatus: status,
    totalBytes: json.total_size ?? 0,
    entries,
    largeFiles,
  };
};

const ROW_KIND: Record<string, CleanRowKind> = { "○": "clean", "⊙": "review", "◎": "skipped" };

// The detailed list `mo clean --dry-run` writes: "=== Section ===", then "<path>  # 1.2GB[, …]". A path "counted
// under" another is already inside its parent's size.
export const parseCleanList = (text: string): Map<string, { path: string; bytes: number }[]> => {
  const sections = new Map<string, { path: string; bytes: number }[]>();
  let current: { path: string; bytes: number }[] | null = null;
  for (const line of text.split("\n")) {
    const header = /^=== (.+) ===$/.exec(line);
    if (header) {
      current = [];
      sections.set(header[1] ?? "", current);
      continue;
    }
    const item = /^(\/.+?) {2}# (\S+?)(?:,|$)(.*)$/.exec(line);
    if (!current || !item || item[3]?.includes("counted under")) continue;
    const bytes = moleBytes(item[2] ?? "");
    if (bytes !== null) current.push({ path: item[1] ?? "", bytes });
  }
  return sections;
};

// Mole names the file it wrote the detailed list to; the page never sees that path.
export const cleanListPath = (stdout: string): string | null => /^Detailed file list: (.+)$/m.exec(stdout)?.[1]?.trim() ?? null;

export const parseCleanDryRun = (stdout: string, list: string): Omit<CleanPreview, "id" | "previewedAt"> => {
  if (!stdout.includes("Dry run complete")) throw new Error("mo clean --dry-run did not finish");
  const paths = parseCleanList(list);
  const sections: CleanSection[] = [];
  let current: CleanSection | null = null;
  for (const line of stdout.split("\n")) {
    const header = /^➤ (.+)$/.exec(line);
    if (header) {
      const name = header[1]?.trim() ?? "";
      current = { name, bytes: 0, rows: [], topPaths: (paths.get(name) ?? []).sort((a, b) => b.bytes - a.bytes).slice(0, TOP_PATHS) };
      sections.push(current);
      continue;
    }
    // Rows sit two spaces in; deeper lines are the detail of the row above (Homebrew's file list).
    const row = /^ {2}([○⊙◎]) (.+)$/.exec(line);
    if (!current || !row) continue;
    const kind = ROW_KIND[row[1] ?? ""] ?? "review";
    const text = (row[2] ?? "").replace(/ dry$/, "");
    const bytes = kind === "clean" ? lastSize(text) : null;
    current.rows.push({ text, bytes, kind } satisfies CleanRow);
    current.bytes += bytes ?? 0;
  }
  const summary = /Potential space: (\S+) · (\d+) items/.exec(stdout);
  return {
    potentialBytes: summary ? moleBytes(summary[1] ?? "") : null,
    items: summary ? Number(summary[2]) : null,
    sections: sections.filter((s) => s.rows.length > 0),
    emptiesTrash: sections.some((s) => s.rows.some((r) => r.kind === "clean" && /\bTrash\b/i.test(r.text))),
    skippedSystem: /System caches need sudo/.test(stdout),
  };
};

// What the real run printed. "Removed:" is missing when nothing was there to remove.
export const parseCleanRun = (stdout: string): { complete: boolean; removedBytes: number | null } => {
  const removed = /Removed: (\S+) · \d+ items/.exec(stdout);
  return { complete: stdout.includes("Cleanup complete"), removedBytes: removed ? moleBytes(removed[1] ?? "") : null };
};

// Old installers, the way `mo installer` finds them: these folders, two levels deep, these extensions. Homebrew's
// cache is left to brew itself (the deep cleanup and the Homebrew cache finding cover it).
const INSTALLER_EXT = new Set([".dmg", ".pkg", ".mpkg", ".iso", ".xip"]);
const INSTALLER_DIRS = (home: string): { dir: string; label: string }[] => [
  { dir: join(home, "Downloads"), label: "Descargas" },
  { dir: join(home, "Desktop"), label: "Escritorio" },
  { dir: join(home, "Documents"), label: "Documentos" },
  { dir: join(home, "Library", "Downloads"), label: "Library/Downloads" },
  { dir: "/Users/Shared", label: "Compartida" },
];

const listDir = (dir: string): Promise<Dirent[]> => readdir(dir, { withFileTypes: true }).catch(() => []);

export const findInstallers = async (home: string, dirs = INSTALLER_DIRS(home)): Promise<InstallerFile[]> => {
  const found: InstallerFile[] = [];
  const visit = async (dir: string, label: string, depth: number): Promise<void> => {
    for (const entry of await listDir(dir)) {
      const file = join(dir, entry.name);
      // Dirents do not follow links: a symlink is neither a file nor a folder here, so it is never touched.
      if (entry.isDirectory() && depth < 2 && !entry.name.startsWith(".") && extname(entry.name) !== ".app") {
        await visit(file, label, depth + 1);
      } else if (entry.isFile() && INSTALLER_EXT.has(extname(entry.name).toLowerCase())) {
        const bytes = await lstat(file).then(
          (s) => s.size,
          () => null,
        );
        if (bytes !== null) found.push({ path: file, name: entry.name, bytes, folder: label });
      }
    }
  };
  for (const { dir, label } of dirs) await visit(dir, label, 1);
  return found.sort((a, b) => b.bytes - a.bytes);
};

const newId = (): string => randomBytes(8).toString("hex");

export const createMole = (deps: {
  run: CommandRunner;
  home: string;
  trashDir: string;
  now?: () => Date;
  path?: string;
  isExecutable?: IsExecutable;
  installerDirs?: { dir: string; label: string }[];
  serial?: SerialQueue;
}) => {
  const now = deps.now ?? (() => new Date());
  const serial = deps.serial ?? serialQueue();
  const moleConfig = join(deps.home, ".config", "mole");
  let status: { bin: string; value: MoleStatus; at: number } | null = null;
  let disk: DiskView | null = null;
  let clean: CleanPreview | null = null;
  let installers: InstallerPreview | null = null;
  let lastRun: MoleRun | null = null;

  // Only a found `mo` is kept: right after `brew install mole` the page sees it on the next visit.
  const readStatus = async (): Promise<{ bin: string | null; value: MoleStatus }> => {
    if (status && now().getTime() - status.at <= STATUS_TTL_MS) return status;
    const bin = await resolveBin(["mo"], deps.path, deps.isExecutable);
    if (!bin) return { bin, value: { available: false, version: null } };
    const version = await deps
      .run(bin, ["--version"])
      .then(parseMoleVersion)
      .catch(() => null);
    status = { bin, value: { available: true, version }, at: now().getTime() };
    return status;
  };

  const requireBin = async (): Promise<string> => {
    const { bin } = await readStatus();
    if (!bin) throw new CleanupConflict(NOT_INSTALLED);
    return bin;
  };

  const report = async (): Promise<MoleReport> => ({
    mole: (await readStatus()).value,
    disk,
    clean,
    installers,
    lastRun,
  });

  // The preview a deletion may act on: the latest one, and only while fresh. A stale one is dropped.
  const takeFresh = <T extends { id: string; previewedAt: string }>(
    preview: T | null,
    id: string,
    drop: () => void,
    refusal: { notLatest: string; stale: string },
  ): T => {
    if (!preview || preview.id !== id) throw new CleanupConflict(refusal.notLatest);
    if (now().getTime() - Date.parse(preview.previewedAt) > PREVIEW_TTL_MS) {
      drop();
      throw new CleanupConflict(refusal.stale);
    }
    return preview;
  };

  // Mole empties the Trash only when it can list it, and so does Jarvis: both run with the same macOS access.
  const trashHasItems = async (): Promise<boolean> =>
    readdir(deps.trashDir).then(
      (names) => names.some((n) => n !== ".DS_Store"),
      () => false,
    );

  // `mo clean --whitelist` saves the Trash as one line, "$HOME/.Trash" or "~/.Trash".
  const trashWhitelisted = async (): Promise<boolean> => {
    const text = await readFile(join(moleConfig, "whitelist"), "utf8").catch(() => "");
    return text.split("\n").some((line) => {
      const entry = line.trim().replace(/^(~|\$HOME)(?=\/)/, deps.home).replace(/\/+$/, "");
      return entry === deps.trashDir;
    });
  };

  // Only folders the last view listed, or one already opened on the way down: never a path the page made up.
  const target = (path: string | null): { path: string | null; trail: DiskView["trail"] } => {
    if (path === null) return { path: null, trail: [] };
    const trail = disk?.trail ?? [];
    const back = trail.findIndex((t) => t.path === path);
    if (back >= 0) return { path, trail: trail.slice(0, back + 1) };
    const entry = disk?.entries.find((e) => e.path === path && e.isDir);
    if (!entry) throw new CleanupConflict("Esa carpeta ya no aparece en el análisis. Vuelve a analizar.");
    return { path, trail: [...trail, { name: entry.name, path: entry.path }] };
  };

  return {
    read: report,

    // Read-only: a folder's size breakdown is its own preview, nothing to apply.
    analyze: (path: string | null): Promise<MoleReport> =>
      serial(async () => {
        const bin = await requireBin();
        const next = target(path);
        const text = await deps.run(bin, ["analyze", "--json", ...(next.path ? [next.path] : [])]).catch(() => {
          throw new CleanupConflict("Mole no pudo analizar el disco.");
        });
        disk = { ...parseAnalyze(text), path: next.path, analyzedAt: now().toISOString(), trail: next.trail };
        return report();
      }),

    previewClean: (): Promise<MoleReport> =>
      serial(async () => {
        const bin = await requireBin();
        try {
          const stdout = await deps.run(bin, ["clean", "--dry-run"]);
          const listFile = cleanListPath(stdout) ?? join(moleConfig, "clean-list.txt");
          const list = await readFile(listFile, "utf8").catch(() => "");
          clean = { ...parseCleanDryRun(stdout, list), id: newId(), previewedAt: now().toISOString() };
        } catch {
          throw new CleanupConflict("Mole no pudo terminar la previsualización.");
        }
        return report();
      }),

    // Acts only on the preview the click came from, while it is fresh, and only once: `mo clean` without a terminal
    // deletes right away, so this is the only confirmation there is.
    applyClean: (previewId: string): Promise<MoleReport> =>
      serial(async () => {
        const preview = takeFresh(clean, previewId, () => (clean = null), {
          notLatest: "Eso ya no es la última previsualización. Vuelve a previsualizar.",
          stale: "La previsualización ya no está vigente. Vuelve a previsualizar.",
        });
        if (preview.emptiesTrash) throw new CleanupConflict("Esta limpieza vaciaría la Papelera. Protégela primero en Mole.");
        // The preview is minutes old and `mo clean` looks again when it runs: what reached the Trash since then
        // (installers moved from here, files I trashed) would go with it.
        if ((await trashHasItems()) && !(await trashWhitelisted())) {
          throw new CleanupConflict("Ahora hay cosas en la Papelera y Mole la vaciaría. Vuelve a previsualizar.");
        }
        const bin = await requireBin();
        clean = null;
        const before = await readFreeBytes(deps.run);
        const stdout = await deps.run(bin, ["clean"]).catch(() => {
          throw new CleanupConflict("Mole no pudo terminar la limpieza. Lo que alcanzó a borrar ya no está.");
        });
        const after = before === null ? null : await readFreeBytes(deps.run);
        const result = parseCleanRun(stdout);
        lastRun = {
          kind: "clean",
          at: now().toISOString(),
          estimatedBytes: preview.potentialBytes,
          removedBytes: result.removedBytes,
          freedBytes: before !== null && after !== null ? Math.max(0, after - before) : null,
          skipped: [],
          complete: result.complete,
        };
        return report();
      }),

    previewInstallers: (): Promise<MoleReport> =>
      serial(async () => {
        const files = await findInstallers(deps.home, deps.installerDirs);
        installers = {
          id: newId(),
          previewedAt: now().toISOString(),
          files,
          totalBytes: files.reduce((n, f) => n + f.bytes, 0),
        };
        return report();
      }),

    // To the Trash, never deleted: a file that changed after the preview (gone, resized, now a link) stays put.
    applyInstallers: (previewId: string): Promise<MoleReport> =>
      serial(async () => {
        const preview = takeFresh(installers, previewId, () => (installers = null), {
          notLatest: "Eso ya no es la última búsqueda. Vuelve a buscar.",
          stale: "La búsqueda ya no está vigente. Vuelve a buscar.",
        });
        installers = null;
        await mkdir(deps.trashDir, { recursive: true });
        let moved = 0;
        const skipped: string[] = [];
        for (const file of preview.files) {
          const stat = await lstat(file.path).catch(() => null);
          if (!stat?.isFile() || stat.size !== file.bytes) {
            skipped.push(file.name);
            continue;
          }
          try {
            await rename(file.path, join(deps.trashDir, freeName(deps.trashDir, basename(file.path))));
            moved += file.bytes;
          } catch {
            skipped.push(file.name);
          }
        }
        // The Trash is on the same disk: the space only comes back when I empty it.
        lastRun = {
          kind: "installers",
          at: now().toISOString(),
          estimatedBytes: preview.totalBytes,
          removedBytes: moved,
          freedBytes: null,
          skipped,
          complete: true,
        };
        return report();
      }),
  };
};

export type Mole = ReturnType<typeof createMole>;
