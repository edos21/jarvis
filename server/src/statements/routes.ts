import { existsSync, readFileSync } from "node:fs";

import type { Hono } from "hono";

import {
  type StatementCsv,
  type StatementCsvFile,
  type StatementCsvSave,
  type StatementImport,
  type StatementRow,
  type SpendingResponse,
  isStatementDate,
} from "../../../shared/statements.js";
import { type ApiError, macOnly } from "../app.js";
import { readKeyValues } from "../files.js";
import type { CommandRunner } from "../mac/collect.js";
import { InvalidCsv, toCsv } from "./csv.js";
import { readSpending } from "./spending.js";
import { MAX_STATEMENT_BYTES, ScriptFailed, type StatementDeps, UnsupportedStatement, csvRef, importStatement, listCsvs, readCsv, writeCsv } from "./run.js";

const MAC_ONLY = "Las cuentas solo se abren desde la Mac.";
const NO_CSV = "Ese CSV no existe.";

const validRows = (rows: unknown): rows is StatementRow[] =>
  Array.isArray(rows) &&
  rows.every(
    (r: Partial<StatementRow> | null) =>
      typeof r?.date === "string" &&
      isStatementDate(r.date) &&
      typeof r.description === "string" &&
      r.description.trim() !== "" &&
      typeof r.amount === "number" &&
      Number.isFinite(r.amount),
  );

export const statementRoutes =
  (deps: StatementDeps, run: CommandRunner, categoriesFile: string) =>
  (app: Hono): void => {
    macOnly(app, "/statements", MAC_ONLY);

    app.get("/statements", (c) => c.json<StatementCsvFile[]>(listCsvs(deps)));

    // The patterns file is tiny and edited by hand: read on each request, so a new line counts right away.
    app.get("/statements/spending", (c) => {
      const rules = existsSync(categoriesFile) ? readKeyValues(readFileSync(categoriesFile, "utf8")) : new Map<string, string>();
      return c.json<SpendingResponse>(readSpending(deps, rules, categoriesFile));
    });

    app.post("/statements/import", async (c) => {
      if (Number(c.req.header("content-length") ?? 0) > MAX_STATEMENT_BYTES + 64 * 1024) {
        return c.json<ApiError>({ error: "El archivo pasa de 20 MB." }, 413);
      }
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) return c.json<ApiError>({ error: "Falta el estado de cuenta." }, 400);
      try {
        const result = await importStatement({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, deps);
        return c.json<StatementImport>(result);
      } catch (error) {
        if (error instanceof UnsupportedStatement) return c.json<ApiError>({ error: error.message }, 400);
        if (error instanceof ScriptFailed) return c.json<ApiError>({ error: `El script falló: ${error.message}` }, 422);
        throw error;
      }
    });

    app.get("/statements/csv", (c) => {
      const csv = csvRef(deps, c.req.query("file"));
      if (!csv) return c.json<ApiError>({ error: NO_CSV }, 404);
      try {
        return c.json<StatementCsv>(readCsv(csv));
      } catch (error) {
        if (error instanceof InvalidCsv) return c.json<ApiError>({ error: error.message }, 422);
        throw error;
      }
    });

    app.put("/statements/csv", async (c) => {
      const body = await c.req.json<Partial<StatementCsvSave>>().catch((): Partial<StatementCsvSave> => ({}));
      const csv = csvRef(deps, body.file);
      if (!csv) return c.json<ApiError>({ error: NO_CSV }, 404);
      if (!validRows(body.rows) || typeof body.mtimeMs !== "number") {
        return c.json<ApiError>({ error: "Cada fila necesita una fecha dd/mm/aaaa, una descripción y un monto." }, 400);
      }
      const rows = body.rows.map((r) => ({ date: r.date, description: r.description.trim(), amount: Math.round(r.amount * 100) / 100 }));
      const result = writeCsv(deps, csv, toCsv(rows), body.mtimeMs);
      switch (result.status) {
        case "ok":
          return c.json<StatementCsv>(readCsv(csv));
        case "changed":
          return c.json<ApiError>({ error: "El CSV cambió fuera de Jarvis; recárgalo." }, 409);
        case "failed":
          return c.json<ApiError>({ error: result.error }, 500);
      }
    });

    app.get("/statements/csv/download", (c) => {
      const csv = csvRef(deps, c.req.query("file"));
      if (!csv) return c.json<ApiError>({ error: NO_CSV }, 404);
      c.header("content-type", "text/csv; charset=utf-8");
      c.header("content-disposition", `attachment; filename="${csv.file}"`);
      return c.body(readFileSync(csv.abs, "utf8"));
    });

    app.post("/statements/reveal", async (c) => {
      const body = await c.req.json<{ file?: unknown }>().catch((): { file?: unknown } => ({}));
      const csv = csvRef(deps, body.file);
      if (!csv) return c.json<ApiError>({ error: NO_CSV }, 404);
      await run("open", ["-R", csv.abs]);
      return c.json({ ok: true });
    });
  };
