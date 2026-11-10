import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { freeName, safeWrite, writeNew } from "./files.js";

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-files-"));
  const file = join(dir, "nota.md");
  writeFileSync(file, "antes");
  chmodSync(file, 0o640);
  return { dir, file, backupsDir: join(dir, "backups") };
};

const now = new Date(2026, 10, 1, 9);

describe("safeWrite", () => {
  it("backs up the previous version, keeps the permissions and returns the new mtime", () => {
    const { file, backupsDir } = setup();
    const result = safeWrite({ file, content: "después", backupsDir, backupPrefix: "nota", keep: 5, now, expectedMtimeMs: statSync(file).mtimeMs });
    expect(result).toEqual({ status: "ok", mtimeMs: statSync(file).mtimeMs });
    expect(readFileSync(file, "utf8")).toBe("después");
    expect(statSync(file).mode & 0o777).toBe(0o640);
    const [backup] = readdirSync(backupsDir);
    expect(backup).toMatch(/^nota-.*\.md$/);
    expect(readFileSync(join(backupsDir, backup!), "utf8")).toBe("antes");
  });

  it("prunes old backups of the same prefix only", () => {
    const { file, backupsDir } = setup();
    for (let i = 0; i < 4; i += 1) {
      safeWrite({ file, content: `v${i}`, backupsDir, backupPrefix: "nota", keep: 2, now: new Date(now.getTime() + i * 1000) });
    }
    safeWrite({ file, content: "otra", backupsDir, backupPrefix: "otra", keep: 2, now });
    expect(readdirSync(backupsDir).filter((n) => n.startsWith("nota-"))).toHaveLength(2);
    expect(readdirSync(backupsDir).filter((n) => n.startsWith("otra-"))).toHaveLength(1);
  });

  it("keeps the history of a file apart from one whose prefix starts the same", () => {
    const { dir, backupsDir } = setup();
    const other = join(dir, "otra.md");
    writeFileSync(other, "otra");
    for (let i = 0; i < 3; i += 1) {
      safeWrite({ file: other, content: `o${i}`, backupsDir, backupPrefix: "cartera", keep: 2, now: new Date(now.getTime() + i * 1000) });
    }
    safeWrite({ file: setup().file, content: "x", backupsDir, backupPrefix: "cartera-2026", keep: 1, now });
    expect(readdirSync(backupsDir).filter((n) => /^cartera-\d{4}-\d{2}-\d{2}T/.test(n))).toHaveLength(2);
    expect(readdirSync(backupsDir).filter((n) => n.startsWith("cartera-2026-2026"))).toHaveLength(1);
  });

  it("writes nothing when the file changed since it was read", () => {
    const { file, backupsDir } = setup();
    const read = statSync(file).mtimeMs;
    utimesSync(file, new Date(), new Date(read + 5000));
    expect(safeWrite({ file, content: "pisado", backupsDir, backupPrefix: "nota", keep: 5, now, expectedMtimeMs: read })).toEqual({
      status: "changed",
    });
    expect(readFileSync(file, "utf8")).toBe("antes");
    expect(existsSync(backupsDir)).toBe(false);
  });

  it("creates a missing file, but a file read before and gone since is a change", () => {
    const { dir, backupsDir } = setup();
    const file = join(dir, "nueva.md");
    expect(safeWrite({ file, content: "x", backupsDir, backupPrefix: "nota", keep: 5, now })).toMatchObject({ status: "ok" });
    expect(readFileSync(file, "utf8")).toBe("x");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const gone = join(dir, "borrada.md");
    expect(safeWrite({ file: gone, content: "x", backupsDir, backupPrefix: "nota", keep: 5, now, expectedMtimeMs: 1 })).toEqual({ status: "changed" });
  });
});

describe("writeNew and freeName", () => {
  it("never overwrites", () => {
    const { dir, file } = setup();
    expect(writeNew(file, "otra")).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("antes");
    expect(writeNew(join(dir, "nueva.md"), "hola")).toBe(true);
    expect(freeName(dir, "nota.md")).toBe("nota-2.md");
    expect(freeName(dir, "libre.pdf")).toBe("libre.pdf");
  });
});
