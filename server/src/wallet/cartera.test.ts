import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFlexPositions } from "./flex.js";
import { readOtherCustodians, rewriteIbkrSection, syncCartera } from "./cartera.js";

const fixture = readFileSync(new URL("./fixtures/cartera.md", import.meta.url), "utf8");
const snapshot = parseFlexPositions(readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8"));

const rewrite = (markdown = fixture) => {
  const result = rewriteIbkrSection(markdown, snapshot, "2026-10-31");
  if ("error" in result) throw new Error(result.error);
  return result.markdown;
};

const tableOf = (markdown: string): string[] => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Ticker |"));
  const end = lines.findIndex((l, i) => i > start && !l.startsWith("|"));
  return lines.slice(start, end);
};

describe("readOtherCustodians", () => {
  it("adds every custodian but IBKR and reads their date", () => {
    expect(readOtherCustodians(fixture)).toEqual({ totalUsd: 41_800.5, asOf: "2026-08-19" });
  });
});

describe("rewriteIbkrSection", () => {
  it("only the IBKR table and its date line change; every other byte is identical", () => {
    const out = rewrite();
    const strip = (md: string) =>
      md
        .split("\n")
        .filter((l) => !l.startsWith("| ") && !l.startsWith("|---") && !l.startsWith("|--------") && !l.startsWith("> Datos del broker"))
        .join("\n");
    expect(strip(out)).toBe(strip(fixture));
    expect(out).toContain("> Datos del broker al **2026-10-30**.");
    // Tables outside section 1 are untouched too.
    expect(out).toContain("| Fondo X | $30,000 |");
    expect(out).toContain("| Banco Uno | $30,000 | 59.5% |");
    expect(out).toContain("| ✅ **XYZ: cierre total** | Texto escrito a mano. |");
  });

  it("struck-through rows are kept as they are", () => {
    expect(tableOf(rewrite())).toContain("| ~~XYZ~~ | Acción | Una que vendí | 0 | — | 284.80 | — | — | ✅ Vendida 08/10 @ $280.00 |");
  });

  it("live rows keep the hand-written type and description and get IBKR's numbers", () => {
    const table = tableOf(rewrite());
    // 8,005 / (8,005 + 3,240 + 1,500 + 1,300 cash + 41,800.50) = 14.3%
    expect(table).toContain("| CSPX | ETF | S&P 500 (mi descripción) | 10 | 800.50 | 700.25 | $8,005.00 | +$1,002.50 | 14.3% |");
    expect(table).toContain("| BRK.B | Acción | Berkshire (a mano) | 3 | 500.00 | 480.00 | $1,500.00 | +$60.00 | 2.7% |");
  });

  it("a ticker gone from IBKR is struck with a note, a new one is added in its currency", () => {
    const table = tableOf(rewrite());
    expect(table).toContain("| ~~OLD~~ | Acción | Vieja que ya vendí | 0 | — | 12.00 | — | — | Ya no está en IBKR (2026-10-31) |");
    expect(table).toContain("| VWCE | ETF | VANGUARD FTSE ALL-WORLD | 20 | 150.00 EUR | 130.00 EUR | $3,240.00 | +$432.00 | 5.8% |");
    // New rows go with the live ones, before the struck and cash rows.
    const order = table.map((l) => l.split("|")[1]?.trim());
    expect(order.indexOf("VWCE")).toBeLessThan(order.indexOf("~~OLD~~"));
    expect(order.indexOf("~~OLD~~")).toBeLessThan(order.indexOf("~~XYZ~~"));
  });

  it("cash and subtotal are recomputed; the cash note is kept", () => {
    const table = tableOf(rewrite());
    expect(table).toContain("| Cash | Efectivo | USD disponible (nota mía) | — | — | — | $1,300.00 | — | 2.3% |");
    // Positions only, as the row's name says: 12,745 / 55,845.50 = 22.8%.
    expect(table.at(-1)).toBe("| | | **Subtotal posiciones** | | | | **$12,745.00** | **+$1,494.50** | **22.8%** |");
  });

  it("running it again on its own output changes nothing", () => {
    const once = rewrite();
    const twice = rewriteIbkrSection(once, snapshot, "2026-11-01");
    expect(twice).toEqual({ markdown: once, changed: false });
  });

  it("a snapshot with no positions, or one that drops most of them, is refused", () => {
    expect(rewriteIbkrSection(fixture, { ...snapshot, positions: [] }, "2026-10-31")).toHaveProperty("error");
    // The table holds CSPX, BRK.B and OLD; a snapshot with only VWCE would strike all three.
    expect(rewriteIbkrSection(fixture, { ...snapshot, positions: snapshot.positions.filter((p) => p.symbol === "VWCE") }, "2026-10-31")).toHaveProperty("error");
  });

  it("other rows with an empty ticker are kept as they are", () => {
    const withNote = fixture.replace("| Cash |", "| | | _nota a mano_ | | | | | | |\n| Cash |");
    expect(tableOf(rewrite(withNote))).toContain("| | | _nota a mano_ | | | | | | |");
  });

  it("a renamed section or table is refused", () => {
    expect(rewriteIbkrSection(fixture.replace("## 1. Acciones", "## 1b Otras"), snapshot, "2026-10-31")).toHaveProperty("error");
    expect(rewriteIbkrSection(fixture.replace("| Ticker | Tipo |", "| Símbolo | Tipo |"), snapshot, "2026-10-31")).toHaveProperty("error");
    expect(rewriteIbkrSection(fixture.replace("> Datos del broker al", "> Datos al"), snapshot, "2026-10-31")).toHaveProperty("error");
  });
});

describe("syncCartera", () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cartera-"));
    const file = join(dir, "cartera.md");
    const backups = join(dir, "backups");
    writeFileSync(file, fixture);
    return { file, backups };
  };

  it("a backup is written before the file and old backups are pruned to 30", () => {
    const { file, backups } = setup();
    for (let i = 0; i < 32; i += 1) {
      syncCartera({ file, backupsDir: backups, snapshot: { ...snapshot, reportDate: `2026-10-${String(i).padStart(2, "0")}` }, now: new Date(2026, 9, 31, 7, 0, i) });
    }
    const kept = readdirSync(backups);
    expect(kept).toHaveLength(30);
    expect(readFileSync(join(backups, kept.sort()[0]!), "utf8")).toContain("> Datos del broker al");
  });

  it("the first backup holds the file exactly as it was", () => {
    const { file, backups } = setup();
    expect(syncCartera({ file, backupsDir: backups, snapshot, now: new Date(2026, 9, 31, 7) })).toEqual({ ok: true, changed: true });
    expect(readFileSync(join(backups, readdirSync(backups)[0]!), "utf8")).toBe(fixture);
    expect(readFileSync(file, "utf8")).toBe(rewrite());
  });

  it("the rewritten file keeps its permissions", () => {
    const { file, backups } = setup();
    chmodSync(file, 0o600);
    syncCartera({ file, backupsDir: backups, snapshot, now: new Date(2026, 9, 31, 7) });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("a structure problem writes nothing and says why", () => {
    const { file, backups } = setup();
    writeFileSync(file, fixture.replace("## 1. Acciones", "## Acciones"));
    const result = syncCartera({ file, backupsDir: backups, snapshot, now: new Date(2026, 9, 31, 7) });
    expect(result).toHaveProperty("error");
    expect(readFileSync(file, "utf8")).toBe(fixture.replace("## 1. Acciones", "## Acciones"));
  });

  it("a write that fails leaves no temp file behind and says why", () => {
    const { file, backups } = setup();
    chmodSync(join(file, ".."), 0o500);
    const result = syncCartera({ file, backupsDir: backups, snapshot, now: new Date(2026, 9, 31, 7) });
    chmodSync(join(file, ".."), 0o700);
    expect(result).toHaveProperty("error");
    expect(readdirSync(join(file, "..")).filter((n) => n.startsWith(".cartera"))).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(fixture);
  });

  it("a missing file is an error, not a crash", () => {
    expect(syncCartera({ file: "/nope/cartera.md", backupsDir: "/nope/b", snapshot, now: new Date() })).toHaveProperty("error");
  });
});
