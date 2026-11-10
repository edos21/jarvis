import { existsSync, readFileSync, statSync } from "node:fs";

import { localDate } from "../../../shared/dates.js";
import { type FlexPosition, type FlexSnapshot, type OtherCustodians, tickerKey } from "../../../shared/wallet.js";
import { safeWrite } from "../files.js";
import { cashInUsd } from "./cash.js";

// cartera.md is written by hand. Jarvis owns exactly one thing in it: the IBKR table of section 1 and the date line
// above it. Everything else, including notes inside section 1, stays byte for byte.
const SECTION = /^## 1\./;
const DATE_LINE = /^> Datos del broker al \*\*[^*]*\*\*\.?$/;
const HEADER = ["Ticker", "Tipo", "Descripción", "Shares", "Precio", "Costo prom.", "MKT VAL (USD)", "Unrlzd P&L", "% Cartera"];
const BACKUPS_KEPT = 30;

const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const rowOf = (cells: string[]): string => `|${cells.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`;

const money = (n: number): string => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (n: number): string => `${n < 0 ? "-" : "+"}${money(n)}`;
const plain = (n: number): string => n.toFixed(2);
const pct = (n: number): string => `${n.toFixed(1)}%`;
const shares = (n: number): string => String(Number(n.toFixed(4)));
const inCurrency = (n: number, currency: string): string => (currency === "USD" ? plain(n) : `${plain(n)} ${currency}`);

const firstAmount = (cell: string): number | null => {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(cell);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
};

export const readOtherCustodians = (markdown: string): OtherCustodians | null => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^## Resumen por Custodio/.test(l));
  if (start < 0) return null;
  let totalUsd = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|") || line.startsWith("|--")) continue;
    const [custodian = "", value = ""] = cellsOf(line);
    if (custodian === "Custodio" || custodian.includes("IBKR") || custodian.includes("Total")) continue;
    totalUsd += firstAmount(value) ?? 0;
  }
  const asOf = /Resto de custodios:\s*(\d{4}-\d{2}-\d{2})/.exec(markdown)?.[1] ?? null;
  return { totalUsd, asOf };
};

const usdOf = (p: FlexPosition): { value: number; pnl: number } => ({
  value: p.positionValue * p.fxRateToBase,
  pnl: p.unrealizedPnl * p.fxRateToBase,
});

export const rewriteIbkrSection = (
  markdown: string,
  snapshot: FlexSnapshot,
  today: string,
): { markdown: string; changed: boolean } | { error: string } => {
  const lines = markdown.split("\n");
  const sectionStart = lines.findIndex((l) => SECTION.test(l));
  if (sectionStart < 0) return { error: "no encontré la sección '## 1.' de IBKR" };
  const nextSection = lines.findIndex((l, i) => i > sectionStart && l.startsWith("## "));
  const sectionEnd = nextSection < 0 ? lines.length : nextSection;
  const tableStart = lines.findIndex((l, i) => i > sectionStart && i < sectionEnd && l.startsWith("| Ticker |"));
  if (tableStart < 0 || cellsOf(lines[tableStart] ?? "").join("|") !== HEADER.join("|")) {
    return { error: "la tabla de IBKR no tiene las columnas esperadas" };
  }
  const dateLine = lines.findIndex((l, i) => i > sectionStart && i < tableStart && DATE_LINE.test(l));
  if (dateLine < 0) return { error: "no encontré la línea '> Datos del broker al **…**'" };
  let tableEnd = tableStart + 2;
  while (tableEnd < sectionEnd && lines[tableEnd]?.startsWith("|")) tableEnd += 1;

  const others = readOtherCustodians(markdown)?.totalUsd ?? 0;
  const positionsUsd = snapshot.positions.reduce((sum, p) => sum + usdOf(p).value, 0);
  const cashUsd = cashInUsd(snapshot, (currency) =>
    currency === "USD" ? 1 : (snapshot.positions.find((p) => p.currency === currency)?.fxRateToBase ?? 1),
  );
  const portfolioUsd = positionsUsd + cashUsd + others;
  const share = (usd: number): string => pct(portfolioUsd > 0 ? (usd / portfolioUsd) * 100 : 0);

  const held = new Map(snapshot.positions.map((p) => [tickerKey(p.symbol), p]));
  const seen = new Set<string>();
  const live: string[] = [];
  const struck: string[] = [];
  let cashRow: string | null = null;

  for (const line of lines.slice(tableStart + 2, tableEnd)) {
    const cells = cellsOf(line);
    const [ticker = "", kind = "", description = "", , , cost = ""] = cells;
    if (ticker.startsWith("~~")) {
      struck.push(line);
    } else if (ticker === "Cash") {
      const next = [...cells];
      next[6] = money(cashUsd);
      next[8] = share(cashUsd);
      cashRow = rowOf(next);
    } else if (ticker === "" && description.includes("Subtotal")) {
      continue;
    } else if (ticker === "") {
      // A note row of mine, not a position.
      live.push(line);
    } else {
      const position = held.get(tickerKey(ticker));
      if (!position) {
        struck.unshift(rowOf([`~~${ticker}~~`, kind, description, "0", "—", cost, "—", "—", `Ya no está en IBKR (${today})`]));
        continue;
      }
      seen.add(tickerKey(ticker));
      const { value, pnl } = usdOf(position);
      live.push(
        rowOf([
          ticker,
          kind,
          description,
          shares(position.quantity),
          inCurrency(position.markPrice, position.currency),
          inCurrency(position.costBasisPrice, position.currency),
          money(value),
          signedMoney(pnl),
          share(value),
        ]),
      );
    }
  }
  for (const position of snapshot.positions) {
    if (seen.has(tickerKey(position.symbol))) continue;
    const { value, pnl } = usdOf(position);
    live.push(
      rowOf([
        position.symbol.replace(/ /g, "."),
        position.subCategory === "ETF" ? "ETF" : "Acción",
        position.description,
        shares(position.quantity),
        inCurrency(position.markPrice, position.currency),
        inCurrency(position.costBasisPrice, position.currency),
        money(value),
        signedMoney(pnl),
        share(value),
      ]),
    );
  }
  // IBKR leaving out most positions at once is far likelier a misconfigured query than a sale: nothing is written.
  const liveRows = seen.size + struck.filter((row) => row.includes("Ya no está en IBKR")).length;
  const dropped = liveRows - seen.size;
  if (liveRows > 0 && (snapshot.positions.length === 0 || dropped > liveRows / 2)) {
    return { error: `IBKR no trae ${dropped} de las ${liveRows} posiciones de la tabla; no la toco. Revisa la Flex Query` };
  }
  const pnlUsd = snapshot.positions.reduce((sum, p) => sum + usdOf(p).pnl, 0);
  const subtotal = rowOf(["", "", "**Subtotal posiciones**", "", "", "", `**${money(positionsUsd)}**`, `**${signedMoney(pnlUsd)}**`, `**${share(positionsUsd)}**`]);

  const rows = [...live, ...struck, ...(cashRow ? [cashRow] : []), subtotal];
  const out = [
    ...lines.slice(0, dateLine),
    `> Datos del broker al **${snapshot.reportDate}**.`,
    ...lines.slice(dateLine + 1, tableStart + 2),
    ...rows,
    ...lines.slice(tableEnd),
  ].join("\n");
  return { markdown: out, changed: out !== markdown };
};

export type CarteraSyncResult = { ok: true; changed: boolean } | { error: string };

// Backup first, then an atomic write; if the file changed while Jarvis was working on it, nothing is written.
export const syncCartera = (opts: { file: string; backupsDir: string; snapshot: FlexSnapshot; now: Date }): CarteraSyncResult => {
  const { file, backupsDir, snapshot, now } = opts;
  if (!existsSync(file)) return { error: `no existe ${file}` };
  try {
    const { mtimeMs } = statSync(file);
    const result = rewriteIbkrSection(readFileSync(file, "utf8"), snapshot, localDate(now));
    if ("error" in result) return result;
    if (!result.changed) return { ok: true, changed: false };
    const written = safeWrite({
      file,
      content: result.markdown,
      backupsDir,
      backupPrefix: "cartera",
      keep: BACKUPS_KEPT,
      now,
      expectedMtimeMs: mtimeMs,
    });
    if (written.status === "ok") return { ok: true, changed: true };
    return {
      error: written.status === "changed" ? "cartera.md cambió mientras lo actualizaba; lo intento en el próximo refresco" : written.error,
    };
  } catch (error) {
    return { error: `no pude leer cartera.md: ${(error as Error).message}` };
  }
};
