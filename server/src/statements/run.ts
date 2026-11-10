import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StatementCsv, StatementCsvFile, StatementImport } from "../../../shared/statements.js";
import { type SafeWriteResult, freeName, safeWrite, writeNew } from "../files.js";
import { parseCsv } from "./csv.js";

// The formats import_split.py knows: a bank's PDF statement and a card's Numbers export.
const STATEMENT_EXTENSIONS = [".pdf", ".numbers"];
export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;
const RUN_TIMEOUT_MS = 120_000;
const CSV_BACKUPS_KEPT = 10;
// The script names each CSV "<issuer>_<currency>_<statement>.csv".
const CSV_NAME = /^([a-z]+)_([a-z]{3})_[\w.-]*\.csv$/;

export type Exec = (cmd: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<{ stdout: string; stderr: string }>;

export const execScript: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

export class UnsupportedStatement extends Error {}
// The script itself failed (a statement it chokes on): its last error line, never the statement's content in a log.
export class ScriptFailed extends Error {}

export type StatementDeps = { statementsDir: string; backupsDir: string; exec: Exec; now?: () => Date };

// A CSV of files/out, checked: the only way the routes reach one.
export type CsvRef = { file: string; abs: string };

const outDir = (deps: StatementDeps): string => join(deps.statementsDir, "files", "out");

// Only a plain file name that exists inside files/out: never a path.
export const csvRef = (deps: StatementDeps, file: unknown): CsvRef | null => {
  if (typeof file !== "string" || !CSV_NAME.test(file)) return null;
  const abs = join(outDir(deps), file);
  return existsSync(abs) ? { file, abs } : null;
};

const entryOf = (file: string, mtimeMs: number): StatementCsvFile => {
  const [, issuer = "", currency = ""] = CSV_NAME.exec(file) ?? [];
  return { file, issuer, currency: currency.toUpperCase(), mtimeMs };
};

export const listCsvs = (deps: StatementDeps): StatementCsvFile[] => {
  const dir = outDir(deps);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => CSV_NAME.test(file))
    .map((file) => entryOf(file, statSync(join(dir, file)).mtimeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
};

export const readCsv = (csv: CsvRef): StatementCsv => ({
  ...entryOf(csv.file, statSync(csv.abs).mtimeMs),
  rows: parseCsv(readFileSync(csv.abs, "utf8")),
});

// Every CSV write, from an import or an edit, keeps the previous version in a backup.
export const writeCsv = (deps: StatementDeps, csv: CsvRef, content: string, expectedMtimeMs?: number): SafeWriteResult =>
  safeWrite({
    file: csv.abs,
    content,
    backupsDir: deps.backupsDir,
    backupPrefix: csv.file.replace(/\.csv$/, ""),
    keep: CSV_BACKUPS_KEPT,
    now: (deps.now ?? (() => new Date()))(),
    expectedMtimeMs,
  });

// Keeps the name readable (the script slugifies it for the CSV) without letting it become a path.
const safeName = (name: string): string => name.replace(/[/\\:\0]/g, "_").replace(/^\.+/, "").trim() || "estado";

// The script always reads ./files and writes ./files/out: it runs in a scratch folder holding only this statement,
// so it neither changes nor sees anything else in cuentas.
export const importStatement = async (upload: { name: string; bytes: Uint8Array }, deps: StatementDeps): Promise<StatementImport> => {
  const name = safeName(upload.name);
  if (!STATEMENT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e))) throw new UnsupportedStatement("Solo un PDF o un archivo .numbers.");
  if (upload.bytes.byteLength > MAX_STATEMENT_BYTES) throw new UnsupportedStatement("El archivo pasa de 20 MB.");

  const filesDir = join(deps.statementsDir, "files");
  mkdirSync(outDir(deps), { recursive: true });
  // The same statement uploaded again keeps its name, so its CSV is replaced instead of duplicated as "<name>_2".
  const sameFile = existsSync(join(filesDir, name)) && Buffer.from(upload.bytes).equals(readFileSync(join(filesDir, name)));
  const statement = sameFile ? name : freeName(filesDir, name);
  if (!sameFile && !writeNew(join(filesDir, statement), upload.bytes)) {
    throw new UnsupportedStatement("Ya existe un archivo con ese nombre; intenta de nuevo.");
  }
  // A new upload the script could not turn into any CSV is not kept: it would only be processed again by hand.
  const discard = (): void => {
    if (!sameFile) rmSync(join(filesDir, statement), { force: true });
  };

  const scratch = mkdtempSync(join(tmpdir(), "jarvis-statements-"));
  const scratchOut = join(scratch, "files", "out");
  try {
    mkdirSync(join(scratch, "files"));
    copyFileSync(join(filesDir, statement), join(scratch, "files", statement));
    let stdout: string;
    try {
      ({ stdout } = await deps.exec(join(deps.statementsDir, "venv", "bin", "python"), [join(deps.statementsDir, "import_split.py")], {
        cwd: scratch,
        timeout: RUN_TIMEOUT_MS,
      }));
    } catch (error) {
      discard();
      const lastLine = String((error as { stderr?: string }).stderr ?? "").trim().split("\n").at(-1);
      throw new ScriptFailed(lastLine || (error as Error).message);
    }
    const skipped = stdout
      .split("\n")
      .filter((line) => line.startsWith("[skip]"))
      .map((line) => line.replace(/^\[skip\]\s*/, ""));
    const produced = existsSync(scratchOut) ? readdirSync(scratchOut).filter((f) => CSV_NAME.test(f)) : [];
    if (produced.length === 0) discard();
    const outputs = produced.map((file): StatementCsv => {
      // A statement imported again replaces its CSV, as running the script by hand does; the old one goes to a backup.
      const csv = { file, abs: join(outDir(deps), file) };
      const written = writeCsv(deps, csv, readFileSync(join(scratchOut, file), "utf8"));
      if (written.status === "failed") throw new ScriptFailed(written.error);
      return readCsv(csv);
    });
    return { statement, outputs, skipped };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
