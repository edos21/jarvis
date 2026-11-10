import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SpendingResponse, StatementCsv, StatementImport } from "../../../shared/statements.js";
import { createApp } from "../app.js";
import { parseCsv, toCsv } from "./csv.js";
import { statementRoutes } from "./routes.js";
import type { Exec } from "./run.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";

const CSV = 'Date,Description,Amount\n10/09/2026,"PAYPAL *INSTITUCION, SA",75.00\n30/09/2026,PEDIDOSYA*TOKIO PIZZ,-5.38\n';

// Plays import_split.py: writes into ./files/out what the real one would, from the cwd it is given.
const fakeScript = (behavior: "ok" | "skip" | "crash" = "ok") => {
  const runs: { cwd: string; seen: string[] }[] = [];
  const exec: Exec = async (_cmd, _args, { cwd }) => {
    runs.push({ cwd, seen: readdirSync(join(cwd, "files")) });
    if (behavior === "crash") throw Object.assign(new Error("exit 1"), { stderr: "Traceback\nValueError: bad page" });
    if (behavior === "skip") return { stdout: "[skip] x.pdf: does not look like a bank statement (no transaction lines)\n", stderr: "" };
    mkdirSync(join(cwd, "files", "out"));
    writeFileSync(join(cwd, "files", "out", "bank_usd_v_22.csv"), CSV);
    return { stdout: "[ok]   V 22.pdf -> files/out/bank_usd_v_22.csv (2 rows)\n[skip] V 22.pdf: no UYU transactions\n", stderr: "" };
  };
  return { exec, runs };
};

const setup = (behavior?: "ok" | "skip" | "crash") => {
  const statementsDir = mkdtempSync(join(tmpdir(), "jarvis-cuentas-"));
  mkdirSync(join(statementsDir, "files", "out"), { recursive: true });
  writeFileSync(join(statementsDir, "files", "otro.pdf"), "ya estaba");
  const script = fakeScript(behavior);
  const opened: string[][] = [];
  const deps = { statementsDir, backupsDir: join(statementsDir, "backups"), exec: script.exec };
  const categoriesFile = join(statementsDir, "spending-categories");
  writeFileSync(categoriesFile, "# mine\npedidosya = Delivery\n");
  const app = createApp({
    tailnetHost: TAILNET,
    routes: [statementRoutes(deps, async (cmd, args) => (opened.push([cmd, ...args]), ""), categoriesFile)],
  });
  const upload = (name: string, base = LOCAL) => {
    const form = new FormData();
    form.append("file", new File(["%PDF"], name));
    return app.request(`${base}/api/statements/import`, { method: "POST", headers: { origin: base }, body: form });
  };
  const send = (method: string, path: string, body?: unknown, base = LOCAL) =>
    app.request(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { statementsDir, script, upload, send, opened, categoriesFile };
};

describe("statement csv", () => {
  it("reads and writes quoted fields the way pandas does", () => {
    const rows = parseCsv(CSV);
    expect(rows).toEqual([
      { date: "10/09/2026", description: "PAYPAL *INSTITUCION, SA", amount: 75 },
      { date: "30/09/2026", description: "PEDIDOSYA*TOKIO PIZZ", amount: -5.38 },
    ]);
    expect(toCsv(rows)).toBe(CSV);
    expect(toCsv([{ date: "01/10/2026", description: 'Dijo "hola"', amount: 1 }])).toContain('"Dijo ""hola"""');
  });

  it("refuses a file with other columns or a row without an amount", () => {
    expect(() => parseCsv("a,b\n1,2\n")).toThrow("columnas");
    expect(() => parseCsv("Date,Description,Amount\n01/10/2026,FOO,\n")).toThrow("fila 2");
  });
});

describe("statement import", () => {
  it("runs the script on the statement alone and keeps its CSV in files/out", async () => {
    const { statementsDir, script, upload } = setup();
    const res = await upload("V 22.pdf");
    expect(res.status).toBe(200);
    const result = (await res.json()) as StatementImport;
    expect(result.statement).toBe("V 22.pdf");
    expect(result.skipped).toEqual(["V 22.pdf: no UYU transactions"]);
    expect(result.outputs.map((o) => [o.file, o.issuer, o.currency, o.rows.length])).toEqual([["bank_usd_v_22.csv", "bank", "USD", 2]]);
    expect(script.runs[0]?.seen).toEqual(["V 22.pdf"]);
    expect(existsSync(script.runs[0]!.cwd)).toBe(false);
    expect(readFileSync(join(statementsDir, "files", "out", "bank_usd_v_22.csv"), "utf8")).toBe(CSV);
  });

  it("never overwrites a statement already in files/", async () => {
    const { statementsDir, upload } = setup();
    const result = (await (await upload("otro.pdf")).json()) as StatementImport;
    expect(result.statement).toBe("otro-2.pdf");
    expect(readFileSync(join(statementsDir, "files", "otro.pdf"), "utf8")).toBe("ya estaba");
  });

  it("reports what the script skipped and when it crashes, and keeps no upload that gave nothing", async () => {
    const skipped = setup("skip");
    expect(((await (await skipped.upload("x.pdf")).json()) as StatementImport).skipped[0]).toContain("does not look like");
    expect(existsSync(join(skipped.statementsDir, "files", "x.pdf"))).toBe(false);
    const crashed = setup("crash");
    const res = await crashed.upload("x.pdf");
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("El script falló: ValueError: bad page");
    expect(existsSync(crashed.script.runs[0]!.cwd)).toBe(false);
    expect(existsSync(join(crashed.statementsDir, "files", "x.pdf"))).toBe(false);
  });

  it("the same statement uploaded again replaces its CSV instead of making a second one", async () => {
    const { statementsDir, upload } = setup();
    await upload("V 22.pdf");
    const again = (await (await upload("V 22.pdf")).json()) as StatementImport;
    expect(again.statement).toBe("V 22.pdf");
    expect(readdirSync(join(statementsDir, "files")).filter((f) => f.endsWith(".pdf")).sort()).toEqual(["V 22.pdf", "otro.pdf"]);
    expect(readdirSync(join(statementsDir, "backups"))).toHaveLength(1);
  });

  it("only takes PDF and Numbers files", async () => {
    const { upload, script } = setup();
    expect((await upload("extracto.xlsx")).status).toBe(400);
    expect(script.runs).toHaveLength(0);
  });
});

describe("statement csv routes", () => {
  it("saves edited rows with a backup and refuses a stale copy", async () => {
    const { statementsDir, upload, send } = setup();
    await upload("V 22.pdf");
    const csv = (await (await send("GET", "/statements/csv?file=bank_usd_v_22.csv")).json()) as StatementCsv;
    const rows = [{ ...csv.rows[0]!, amount: 70.004 }];
    const saved = await send("PUT", "/statements/csv", { file: csv.file, rows, mtimeMs: csv.mtimeMs });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(statementsDir, "files", "out", "bank_usd_v_22.csv"), "utf8")).toBe(
      'Date,Description,Amount\n10/09/2026,"PAYPAL *INSTITUCION, SA",70.00\n',
    );
    expect(readdirSync(join(statementsDir, "backups"))).toHaveLength(1);
    expect((await send("PUT", "/statements/csv", { file: csv.file, rows, mtimeMs: csv.mtimeMs - 1000 })).status).toBe(409);
    expect((await send("PUT", "/statements/csv", { file: csv.file, rows: [{ ...rows[0], date: "31/02/2026" }], mtimeMs: 0 })).status).toBe(400);
  });

  it("downloads and reveals only a CSV of files/out", async () => {
    const { upload, send, opened } = setup();
    await upload("V 22.pdf");
    const download = await send("GET", "/statements/csv/download?file=bank_usd_v_22.csv");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="bank_usd_v_22.csv"');
    expect(await download.text()).toBe(CSV);
    expect((await send("POST", "/statements/reveal", { file: "bank_usd_v_22.csv" })).status).toBe(200);
    expect(opened[0]?.[1]).toBe("-R");
    expect((await send("GET", "/statements/csv?file=../../etc/passwd")).status).toBe(404);
    expect((await send("POST", "/statements/reveal", { file: "../otro.pdf" })).status).toBe(404);
  });

  it("is Mac-only, reading included", async () => {
    const { send, upload } = setup();
    expect((await send("GET", "/statements", undefined, `https://${TAILNET}`)).status).toBe(403);
    expect((await upload("V 22.pdf", `https://${TAILNET}`)).status).toBe(403);
  });
});

describe("spending", () => {
  const out = (dir: string, file: string, csv: string) => writeFileSync(join(dir, "files", "out", file), csv);

  it("adds up each month per currency and category, refunds included", async () => {
    const { statementsDir, send } = setup();
    out(statementsDir, "bank_usd_v_22.csv", CSV);
    out(statementsDir, "bank_uyu_v_22.csv", "Date,Description,Amount\n02/09/2026,PEDIDOSYA*BURGER,500.00\n03/09/2026,ANTEL,1200.00\n");
    out(
      statementsDir,
      "card_usd_sept.csv",
      'Date,Description,Amount\n05/09/2026,"La Pasiva (Restaurants)",30.00\n06/09/2026,"La Pasiva (Restaurants)",-10.00\n01/10/2026,"Tienda Inglesa (Grocery Stores)",20.00\n',
    );
    out(statementsDir, "card_usd_broken.csv", "a,b\n1,2\n");
    const spending = (await (await send("GET", "/statements/spending")).json()) as SpendingResponse;
    expect(spending.skipped).toEqual(["card_usd_broken.csv"]);
    expect(spending.months).toEqual([
      {
        month: "2026-09",
        currency: "USD",
        total: 89.62,
        categories: [
          { category: "Sin categoría", total: 75 },
          { category: "Restaurants", total: 20 },
          { category: "Delivery", total: -5.38 },
        ],
      },
      {
        month: "2026-09",
        currency: "UYU",
        total: 1700,
        categories: [
          { category: "Sin categoría", total: 1200 },
          { category: "Delivery", total: 500 },
        ],
      },
      { month: "2026-10", currency: "USD", total: 20, categories: [{ category: "Grocery Stores", total: 20 }] },
    ]);
  });

  it("a new pattern counts on the next read, and it stays on the Mac", async () => {
    const { statementsDir, send, categoriesFile } = setup();
    out(statementsDir, "bank_uyu_v_22.csv", "Date,Description,Amount\n03/09/2026,ANTEL FIJO,1200.00\n");
    writeFileSync(categoriesFile, "antel=Servicios\n");
    const spending = (await (await send("GET", "/statements/spending")).json()) as SpendingResponse;
    expect(spending.months[0]?.categories).toEqual([{ category: "Servicios", total: 1200 }]);
    expect((await send("GET", "/statements/spending", undefined, `https://${TAILNET}`)).status).toBe(403);
  });
});
