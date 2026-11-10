import { XMLParser } from "fast-xml-parser";

import type { CashBalance, FlexPosition, FlexSnapshot, NavPoint } from "../../../shared/wallet.js";
import type { IbkrConfig } from "../env.js";

const SEND_REQUEST_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";

// The statement is generated on demand: IBKR answers 1019 until it is ready.
const IN_PROGRESS = "1019";
const RETRY_WAITS_MS = [5_000, 10_000, 20_000, 30_000, 30_000, 30_000];
const TOKEN_ERRORS = new Set(["1012", "1015"]);

// IBKR's message, never the request URL: the token travels in its query string.
export class FlexError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(`IBKR Flex ${code}: ${detail}`);
  }
}

// Expired or revoked: only a new token from the portal fixes it.
export class FlexTokenInvalid extends FlexError {}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false });

type FlexResponse = { Status?: string; ReferenceCode?: string | number; Url?: string; ErrorCode?: string | number; ErrorMessage?: string };

const asResponse = (xml: string): FlexResponse | null => {
  const parsed = parser.parse(xml) as { FlexStatementResponse?: FlexResponse };
  return parsed.FlexStatementResponse ?? null;
};

const failure = (response: FlexResponse): FlexError => {
  const code = String(response.ErrorCode ?? "unknown");
  const message = response.ErrorMessage ?? "no message";
  return TOKEN_ERRORS.has(code) ? new FlexTokenInvalid(code, message) : new FlexError(code, message);
};

const get = async (fetchFn: typeof fetch, url: URL): Promise<string> => {
  const res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "Jarvis/1.0" } });
  if (!res.ok) throw new FlexError(String(res.status), "the Flex Web Service did not answer");
  return res.text();
};

export const fetchFlexStatement = async (
  config: IbkrConfig,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<string> => {
  const send = new URL(SEND_REQUEST_URL);
  send.search = new URLSearchParams({ t: config.token, q: config.queryId, v: "3" }).toString();
  const sent = asResponse(await get(fetchFn, send));
  if (!sent || sent.Status !== "Success" || !sent.ReferenceCode || !sent.Url) throw failure(sent ?? {});

  const statement = new URL(sent.Url);
  statement.search = new URLSearchParams({ t: config.token, q: String(sent.ReferenceCode), v: "3" }).toString();
  for (let attempt = 0; ; attempt += 1) {
    const xml = await get(fetchFn, statement);
    const response = asResponse(xml);
    if (!response) return xml;
    if (String(response.ErrorCode) !== IN_PROGRESS || attempt >= RETRY_WAITS_MS.length) throw failure(response);
    await sleep(RETRY_WAITS_MS[attempt] ?? 30_000);
  }
};

type Attributes = Record<string, string | undefined>;

const list = (value: unknown): Attributes[] => (Array.isArray(value) ? value : value ? [value] : []) as Attributes[];

const num = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Flex dates come as yyyyMMdd or yyyy-MM-dd depending on the query's settings.
const isoDate = (value: string | undefined): string => {
  const digits = (value ?? "").replace(/[^0-9]/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
};

type Statement = Attributes & {
  OpenPositions?: { OpenPosition?: unknown } | "";
  CashReport?: { CashReportCurrency?: unknown };
  EquitySummaryInBase?: { EquitySummaryByReportDateInBase?: unknown } | "";
};

// The one account's statement of a Flex report: both queries are read for a single account.
const singleStatement = (xml: string): Statement => {
  const parsed = parser.parse(xml) as { FlexQueryResponse?: { FlexStatements?: { FlexStatement?: Statement | Statement[] } } };
  const found = parsed.FlexQueryResponse?.FlexStatements?.FlexStatement;
  if (Array.isArray(found) && found.length > 1) {
    throw new FlexError("format", "la Flex Query trae más de una cuenta; déjala con una sola cuenta");
  }
  const statement = Array.isArray(found) ? found[0] : found;
  if (!statement) throw new FlexError("format", "el reporte llegó sin cuentas; revisa las secciones de la Flex Query");
  return statement;
};

// A statement Jarvis cannot read with certainty is refused whole: a half-read one would mark positions as sold.
export const parseFlexPositions = (xml: string): FlexSnapshot => {
  const statement = singleStatement(xml);
  if (!("OpenPositions" in statement)) {
    throw new FlexError("format", "la Flex Query no tiene la sección Open Positions; agrégala con todos sus campos");
  }
  // A query set to lot detail repeats each position per lot; the summary row is the position.
  const rows = list(statement.OpenPositions ? statement.OpenPositions.OpenPosition : undefined).filter(
    (p) => !p.levelOfDetail || p.levelOfDetail === "SUMMARY",
  );
  const missingRate = rows.find((p) => p.currency !== "USD" && !p.fxRateToBase);
  if (missingRate) {
    throw new FlexError("format", `falta el campo fxRateToBase (${missingRate.symbol}); marca todos los campos de Open Positions`);
  }
  const positions: FlexPosition[] = rows.map((p) => ({
    symbol: p.symbol ?? "",
    description: p.description ?? "",
    assetCategory: p.assetCategory ?? "",
    subCategory: p.subCategory ?? "",
    currency: p.currency ?? "USD",
    listingExchange: p.listingExchange ?? "",
    quantity: num(p.position),
    markPrice: num(p.markPrice),
    costBasisPrice: num(p.costBasisPrice),
    positionValue: num(p.positionValue),
    unrealizedPnl: num(p.fifoPnlUnrealized),
    fxRateToBase: p.currency === "USD" ? 1 : num(p.fxRateToBase),
  }));
  const cashRows = list(statement.CashReport?.CashReportCurrency);
  const cash: CashBalance[] = cashRows
    .filter((c) => c.currency && c.currency !== "BASE_SUMMARY")
    .map((c) => ({ currency: c.currency ?? "", amount: num(c.endingCash) }));
  const base = cashRows.find((c) => c.currency === "BASE_SUMMARY");
  const reportDate = isoDate(rows[0]?.reportDate ?? statement.toDate);
  if (!reportDate) throw new FlexError("format", "el reporte no trae fecha; revisa el período de la Flex Query");
  return { reportDate, positions, cash, cashBaseUsd: base ? num(base.endingCash) : null };
};

// The "Net Asset Value (NAV) in Base" section: one row per day of the query's period, oldest first once sorted.
export const parseFlexNav = (xml: string): NavPoint[] => {
  const statement = singleStatement(xml);
  if (!("EquitySummaryInBase" in statement)) {
    throw new FlexError("format", "la Flex Query de NAV no tiene la sección Net Asset Value (NAV) in Base");
  }
  const rows = list(statement.EquitySummaryInBase ? statement.EquitySummaryInBase.EquitySummaryByReportDateInBase : undefined);
  // A day without a total (a holiday the period covers) is skipped, never charted as zero.
  const points = rows
    .map((r) => ({ date: isoDate(r.reportDate), totalUsd: r.total?.trim() ? Number(r.total) : 0 }))
    .filter((p) => p.date && Number.isFinite(p.totalUsd) && p.totalUsd !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) throw new FlexError("format", "la Flex Query de NAV llegó sin días; revisa su período");
  return points;
};
