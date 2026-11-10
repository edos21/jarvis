import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CleanupConflict } from "./cleanup.js";
import { createMole, findInstallers, moleBytes, parseAnalyze, parseCleanDryRun, parseCleanList, parseCleanRun, parseMoleVersion } from "./mole.js";

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const DRY_RUN = fixture("mole-clean-dry-run.txt");
const DRY_RUN_WITH_TRASH = DRY_RUN.replace("◎ Trash · skipped, grant Full Disk Access to your terminal", "○ Trash · would empty, 9 items");
const CLEAN_LIST = fixture("mole-clean-list.txt");
const CLEAN_RUN = `
Clean Your Mac

Running in non-interactive mode
  • System-level cleanup skipped, requires sudo
  • User-level cleanup will proceed automatically

➤ User essentials
  ✓ User app cache · 51 items, 6.69GB

======================================================================
Cleanup complete
Removed: 6.69GB · 51 items
Free space: 66.26GB (+6.69GB)
======================================================================
`;

describe("mole output", () => {
  it("reads sizes in Mole's decimal units", () => {
    expect(moleBytes("6.69GB")).toBe(6_690_000_000);
    expect(moleBytes("369.9MB")).toBe(369_900_000);
    expect(moleBytes("119KB")).toBe(119_000);
    expect(moleBytes("0B")).toBe(0);
    expect(moleBytes("344.6MB+")).toBe(344_600_000);
    expect(moleBytes("would clean")).toBeNull();
  });

  it("reads the version out of the system block", () => {
    expect(parseMoleVersion(fixture("mole-version.txt"))).toBe("1.69.0");
    expect(parseMoleVersion("command not found")).toBeNull();
  });

  it("the overview keeps the biggest rows and marks insights", () => {
    const view = parseAnalyze(fixture("mole-analyze.json"));
    expect(view.path).toBeNull();
    expect(view.scanStatus).toBe("partial");
    expect(view.entries[0]).toMatchObject({ name: "User Library", path: "/Users/me/Library", isDir: true, insight: false });
    expect(view.entries.find((e) => e.name === "uv Cache")).toMatchObject({ insight: true, cleanable: true });
    expect(view.entries.every((e, i, all) => i === 0 || (all[i - 1]?.bytes ?? 0) >= e.bytes)).toBe(true);
  });

  it("a folder view lists its large files", () => {
    const view = parseAnalyze(fixture("mole-analyze-dir.json"));
    expect(view.path).toBe("/Users/me/Library");
    expect(view.largeFiles[0]?.name).toBe("Docker.raw");
  });

  it("an analysis that is not Mole's JSON is an error", () => {
    expect(() => parseAnalyze("{}")).toThrow();
  });

  it("the dry run becomes sections of rows, with what each one would free", () => {
    const preview = parseCleanDryRun(DRY_RUN, CLEAN_LIST);
    expect(preview.potentialBytes).toBe(17_950_000_000);
    expect(preview.items).toBe(3866);
    expect(preview.skippedSystem).toBe(true);
    expect(preview.emptiesTrash).toBe(false);
    const essentials = preview.sections.find((s) => s.name === "User essentials");
    expect(essentials?.rows).toEqual([
      { text: "User app cache · 51 items, 6.69GB", bytes: 6_690_000_000, kind: "clean" },
      { text: "User app logs · 59 items, 369.9MB", bytes: 369_900_000, kind: "clean" },
      { text: "Trash · skipped, grant Full Disk Access to your terminal", bytes: null, kind: "skipped" },
    ]);
    expect(essentials?.topPaths[0]).toEqual({ path: "/Users/me/Library/Caches/Cypress", bytes: 525_200_000 });
    expect(preview.sections.find((s) => s.name === "Browsers")?.rows[0]?.bytes).toBe(453_800_000);
    // Mole only points at these: nothing in them is deleted.
    expect(preview.sections.find((s) => s.name === "Project artifacts")?.rows).toEqual([
      { text: "Build artifacts · 24+ dirs, 344.6MB+ · mo purge", bytes: null, kind: "review" },
    ]);
    expect(preview.sections.some((s) => s.name === "Cloud & Office")).toBe(false);
    expect(preview.sections.find((s) => s.name === "Developer tools")?.rows[0]).toEqual({
      text: "npm cache · would clean",
      bytes: null,
      kind: "clean",
    });
  });

  it("a dry run that would empty the Trash is flagged", () => {
    const preview = parseCleanDryRun(
      DRY_RUN_WITH_TRASH,
      CLEAN_LIST,
    );
    expect(preview.emptiesTrash).toBe(true);
  });

  it("a dry run cut short is an error, not an empty preview", () => {
    expect(() => parseCleanDryRun(DRY_RUN.split("Dry run complete")[0] ?? "", CLEAN_LIST)).toThrow();
  });

  it("the file list skips paths already counted under their parent", () => {
    const appCaches = parseCleanList(`=== App caches ===
/Users/me/Library/Caches/GeoServices  # 64.0MB
/Users/me/Library/Caches/GeoServices/Tiles  # 6.2MB, counted under /Users/me/Library/Caches/GeoServices
/Users/me/Library/Caches/Odd  # size unknown
`).get("App caches");
    expect(appCaches).toEqual([{ path: "/Users/me/Library/Caches/GeoServices", bytes: 64_000_000 }]);
  });

  it("the real run says what it removed", () => {
    expect(parseCleanRun(CLEAN_RUN)).toEqual({ complete: true, removedBytes: 6_690_000_000 });
    expect(parseCleanRun("Cleanup interrupted")).toEqual({ complete: false, removedBytes: null });
  });
});

const NOW = new Date("2026-11-05T12:00:00Z");

const setup = (opts: { installed?: boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), "jarvis-mole-"));
  const trashDir = join(home, ".Trash");
  const downloads = join(home, "Downloads");
  mkdirSync(downloads, { recursive: true });
  const calls: string[] = [];
  let at = NOW.getTime();
  let dryRun = DRY_RUN;
  let cleanRun = CLEAN_RUN;
  let free = 60e9;
  const run = async (cmd: string, args: string[]): Promise<string> => {
    const line = [cmd, ...args].join(" ");
    if (cmd === "df") return `Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s5 100 50 ${free / 1024} 82%\n`;
    if (line === "/usr/local/bin/mo --version") return fixture("mole-version.txt");
    if (line.startsWith("/usr/local/bin/mo analyze --json")) {
      calls.push(line);
      return fixture(args.length > 2 ? "mole-analyze-dir.json" : "mole-analyze.json");
    }
    if (line === "/usr/local/bin/mo clean --dry-run") {
      mkdirSync(join(home, ".config", "mole"), { recursive: true });
      writeFileSync(join(home, ".config", "mole", "clean-list.txt"), CLEAN_LIST);
      // Mole names where it wrote the list: here, inside this test's home.
      return dryRun.replace("/Users/me/.config", join(home, ".config"));
    }
    calls.push(line);
    if (line === "/usr/local/bin/mo clean") free += 6.69e9;
    return cleanRun;
  };
  const mole = createMole({
    run,
    home,
    trashDir,
    now: () => new Date(at),
    path: "/usr/local/bin",
    isExecutable: async (file) => opts.installed !== false && file === "/usr/local/bin/mo",
    installerDirs: [{ dir: downloads, label: "Descargas" }],
  });
  return {
    mole,
    calls,
    home,
    trashDir,
    downloads,
    advance: (minutes: number) => {
      at += minutes * 60_000;
    },
    trashInPreview: () => {
      dryRun = DRY_RUN_WITH_TRASH;
    },
    cutShort: () => {
      cleanRun = "Cleaning…\n";
    },
  };
};

describe("mole", () => {
  it("without Mole installed the report says so and nothing runs", async () => {
    const { mole, calls } = setup({ installed: false });
    expect((await mole.read()).mole).toEqual({ available: false, version: null });
    await expect(mole.previewClean()).rejects.toBeInstanceOf(CleanupConflict);
    await expect(mole.analyze(null)).rejects.toThrow("brew install mole");
    expect(calls).toEqual([]);
  });

  it("reports its version", async () => {
    const { mole } = setup();
    expect((await mole.read()).mole).toEqual({ available: true, version: "1.69.0" });
  });

  it("opens only folders the last view listed, and goes back along the trail", async () => {
    const { mole, calls } = setup();
    await expect(mole.analyze("/etc")).rejects.toBeInstanceOf(CleanupConflict);
    await mole.analyze(null);
    const report = await mole.analyze("/Users/me/Library");
    expect(report.disk?.trail).toEqual([{ name: "User Library", path: "/Users/me/Library" }]);
    // A folder from the overview is no longer listed once inside another one.
    await expect(mole.analyze("/Applications")).rejects.toBeInstanceOf(CleanupConflict);
    expect((await mole.analyze("/Users/me/Library")).disk?.trail).toHaveLength(1);
    expect((await mole.analyze(null)).disk?.trail).toEqual([]);
    expect(calls).toEqual([
      "/usr/local/bin/mo analyze --json",
      "/usr/local/bin/mo analyze --json /Users/me/Library",
      "/usr/local/bin/mo analyze --json /Users/me/Library",
      "/usr/local/bin/mo analyze --json",
    ]);
  });

  it("cleaning needs a preview first", async () => {
    const { mole, calls } = setup();
    await expect(mole.applyClean("anything")).rejects.toThrow("Vuelve a previsualizar");
    expect(calls).toEqual([]);
  });

  it("cleans only the latest preview, once, and reports estimate, removed and freed", async () => {
    const { mole, calls } = setup();
    const preview = (await mole.previewClean()).clean;
    expect(preview?.potentialBytes).toBe(17_950_000_000);
    await expect(mole.applyClean("another-id")).rejects.toBeInstanceOf(CleanupConflict);
    const report = await mole.applyClean(preview?.id ?? "");
    expect(calls).toEqual(["/usr/local/bin/mo clean"]);
    expect(report.clean).toBeNull();
    expect(report.lastRun).toMatchObject({
      kind: "clean",
      complete: true,
      estimatedBytes: 17_950_000_000,
      removedBytes: 6_690_000_000,
      freedBytes: 6_690_000_000,
    });
    await expect(mole.applyClean(preview?.id ?? "")).rejects.toBeInstanceOf(CleanupConflict);
    expect(calls).toEqual(["/usr/local/bin/mo clean"]);
  });

  it("a preview older than 15 minutes is refused and dropped", async () => {
    const { mole, calls, advance } = setup();
    const preview = (await mole.previewClean()).clean;
    advance(16);
    await expect(mole.applyClean(preview?.id ?? "")).rejects.toThrow("ya no está vigente");
    expect((await mole.read()).clean).toBeNull();
    expect(calls).toEqual([]);
  });

  it("a preview that would empty the Trash never runs", async () => {
    const { mole, calls, trashInPreview } = setup();
    trashInPreview();
    const preview = (await mole.previewClean()).clean;
    expect(preview?.emptiesTrash).toBe(true);
    await expect(mole.applyClean(preview?.id ?? "")).rejects.toThrow("Papelera");
    expect(calls).toEqual([]);
  });

  it("what reached the Trash after the preview stops the clean, unless Mole's whitelist protects it", async () => {
    const { mole, calls, downloads, home, trashDir } = setup();
    const preview = (await mole.previewClean()).clean;
    expect(preview?.emptiesTrash).toBe(false);
    writeFileSync(join(downloads, "Tool.dmg"), "x");
    await mole.applyInstallers((await mole.previewInstallers()).installers?.id ?? "");
    expect(readdirSync(trashDir)).toEqual(["Tool.dmg"]);
    await expect(mole.applyClean(preview?.id ?? "")).rejects.toThrow("Papelera");
    expect(calls).toEqual([]);
    writeFileSync(join(home, ".config", "mole", "whitelist"), "# protected\n$HOME/.Trash/\n");
    await mole.applyClean(preview?.id ?? "");
    expect(calls).toEqual(["/usr/local/bin/mo clean"]);
  });

  it("a clean Mole cut short is reported as not finished", async () => {
    const { mole, cutShort } = setup();
    cutShort();
    const preview = (await mole.previewClean()).clean;
    expect((await mole.applyClean(preview?.id ?? "")).lastRun).toMatchObject({ kind: "clean", complete: false });
  });

  it("installers are found two levels deep, links and app bundles left out", async () => {
    const { downloads } = setup();
    writeFileSync(join(downloads, "Tool.dmg"), "x".repeat(300));
    writeFileSync(join(downloads, "notes.txt"), "x");
    mkdirSync(join(downloads, "old", "deeper"), { recursive: true });
    writeFileSync(join(downloads, "old", "Setup.PKG"), "x".repeat(100));
    writeFileSync(join(downloads, "old", "deeper", "Too-deep.dmg"), "x");
    mkdirSync(join(downloads, "Thing.app"));
    writeFileSync(join(downloads, "Thing.app", "inside.dmg"), "x");
    symlinkSync(join(downloads, "Tool.dmg"), join(downloads, "Link.dmg"));
    const files = await findInstallers("/unused", [{ dir: downloads, label: "Descargas" }]);
    expect(files.map((f) => [f.name, f.bytes, f.folder])).toEqual([
      ["Tool.dmg", 300, "Descargas"],
      ["Setup.PKG", 100, "Descargas"],
    ]);
  });

  it("a missing folder is skipped, not an error", async () => {
    expect(await findInstallers("/unused", [{ dir: "/nonexistent/jarvis", label: "x" }])).toEqual([]);
  });

  it("installers go to the Trash; one that changed after the search stays put", async () => {
    const { mole, downloads, trashDir } = setup();
    writeFileSync(join(downloads, "Tool.dmg"), "x".repeat(300));
    writeFileSync(join(downloads, "Grows.pkg"), "x".repeat(100));
    const preview = (await mole.previewInstallers()).installers;
    expect(preview?.totalBytes).toBe(400);
    writeFileSync(join(downloads, "Grows.pkg"), "x".repeat(200));
    const report = await mole.applyInstallers(preview?.id ?? "");
    expect(readdirSync(trashDir)).toEqual(["Tool.dmg"]);
    expect(readdirSync(downloads).sort()).toEqual(["Grows.pkg"]);
    expect(report.lastRun).toMatchObject({ kind: "installers", removedBytes: 300, freedBytes: null, skipped: ["Grows.pkg"] });
    expect(report.installers).toBeNull();
  });

  it("a name already in the Trash gets a new one instead of overwriting", async () => {
    const { mole, downloads, trashDir } = setup();
    mkdirSync(trashDir);
    writeFileSync(join(trashDir, "Tool.dmg"), "older");
    writeFileSync(join(downloads, "Tool.dmg"), "newer");
    const preview = (await mole.previewInstallers()).installers;
    await mole.applyInstallers(preview?.id ?? "");
    expect(readdirSync(trashDir).sort()).toEqual(["Tool-2.dmg", "Tool.dmg"]);
    expect(readFileSync(join(trashDir, "Tool.dmg"), "utf8")).toBe("older");
  });

  it("moving installers needs a fresh search", async () => {
    const { mole, downloads, advance } = setup();
    writeFileSync(join(downloads, "Tool.dmg"), "x");
    const preview = (await mole.previewInstallers()).installers;
    advance(16);
    await expect(mole.applyInstallers(preview?.id ?? "")).rejects.toThrow("Vuelve a buscar");
    expect(readdirSync(downloads)).toEqual(["Tool.dmg"]);
  });
});
