import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

// A backup is "<prefix>-<ISO time with : and . as ->.<ext>": matching the time too keeps one file's history apart
// from another's whose prefix starts the same ("cartera" and "cartera-2026").
const backupsOf = (dir: string, prefix: string): string[] => {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z`);
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort();
};

export type SafeWriteResult = { status: "ok"; mtimeMs: number } | { status: "changed" } | { status: "failed"; error: string };

// For files that are mine and have no git (notes, cartera.md, the statement CSVs): the previous version goes to a
// backup first, the new one is written next to it and renamed over, and nothing is written if the file changed under
// us (Obsidian, a hand edit) since it was read. A file that does not exist yet is created the same way, with nothing
// to back up, unless the caller read a version of it (expectedMtimeMs): then it is gone and that is a change.
export const safeWrite = (opts: {
  file: string;
  content: string;
  backupsDir: string;
  backupPrefix: string;
  keep: number;
  now: Date;
  expectedMtimeMs?: number;
}): SafeWriteResult => {
  const { file, content, backupsDir, backupPrefix, keep, now, expectedMtimeMs } = opts;
  const exists = existsSync(file);
  if (!exists && expectedMtimeMs !== undefined) return { status: "changed" };
  const temp = join(dirname(file), `.${basename(file)}.jarvis-${process.pid}`);
  try {
    const before = exists ? statSync(file) : null;
    if (before && expectedMtimeMs !== undefined && before.mtimeMs !== expectedMtimeMs) return { status: "changed" };

    // The rename replaces the file, so the new one keeps the old one's permissions; a new file is mine only.
    writeFileSync(temp, content, { mode: before ? before.mode & 0o777 : 0o600 });
    if (before ? statSync(file).mtimeMs !== before.mtimeMs : existsSync(file)) return { status: "changed" };

    // Only a write that is going ahead takes a backup, so a refused one never pushes real history out.
    if (before) {
      mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      writeFileSync(join(backupsDir, `${backupPrefix}-${stamp}${extname(file)}`), readFileSync(file), { mode: 0o600 });
      const backups = backupsOf(backupsDir, backupPrefix);
      for (const old of backups.slice(0, Math.max(0, backups.length - keep))) unlinkSync(join(backupsDir, old));
    }
    renameSync(temp, file);
    return { status: "ok", mtimeMs: statSync(file).mtimeMs };
  } catch (error) {
    return { status: "failed", error: `no pude escribir ${basename(file)}: ${(error as Error).message}` };
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

// "wx" fails instead of overwriting, even if the name was taken between a check and the write.
export const writeNew = (file: string, content: string | Uint8Array): boolean => {
  try {
    writeFileSync(file, content, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
};

// Never overwrites: a name already taken gets -2, -3… before the extension.
export const freeName = (dir: string, name: string): string => {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
};

// The small "KEY=VALUE" files I edit by hand in ~/.jarvis (wallet symbols, spending categories), in file order.
// Blank lines and "#" comments are skipped.
export const readKeyValues = (text: string): Map<string, string> =>
  new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line): [string, string] => {
        const [key = "", value = ""] = line.split("=").map((part) => part.trim());
        return [key, value];
      })
      .filter(([key, value]) => key && value),
  );
