import type { FlexPosition, HistoryRange, PricePoint } from "../../../shared/wallet.js";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

// IBKR's listing exchange → Yahoo's suffix. US exchanges have none, so anything unknown goes without one; a wrong
// guess is fixed in ~/.jarvis/wallet-symbols.
const EXCHANGE_SUFFIX: Record<string, string> = {
  LSE: ".L",
  LSEETF: ".L",
  IBIS: ".DE",
  IBIS2: ".DE",
  FWB: ".F",
  EBS: ".SW",
  SWX: ".SW",
  AEB: ".AS",
  SBF: ".PA",
  BVME: ".MI",
};

export type Quote = { price: number; previousClose: number; currency: string; at: string };

export const yahooSymbol = (
  position: Pick<FlexPosition, "symbol" | "listingExchange">,
  overrides: ReadonlyMap<string, string>,
): string =>
  overrides.get(position.symbol) ??
  `${position.symbol.replace(/[ .]/g, "-")}${EXCHANGE_SUFFIX[position.listingExchange] ?? ""}`;

type ChartMeta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  regularMarketTime?: number;
};

type ChartResult = { meta?: ChartMeta; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } };

const fetchChart = async (symbol: string, range: string, fetchFn: typeof fetch): Promise<ChartResult | undefined> => {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Mozilla/5.0 Jarvis" } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} answered ${res.status}`);
  const body = (await res.json()) as { chart?: { result?: ChartResult[] } };
  return body.chart?.result?.[0];
};

// Some London listings quote in pence: everything Jarvis shows is in pounds.
const unit = (currency: string | undefined): { factor: number; currency: string } =>
  currency === "GBp" ? { factor: 0.01, currency: "GBP" } : { factor: 1, currency: currency ?? "USD" };

const fetchQuote = async (symbol: string, fetchFn: typeof fetch): Promise<Quote> => {
  const meta = (await fetchChart(symbol, "1d", fetchFn))?.meta;
  const price = meta?.regularMarketPrice;
  const previousClose = meta?.chartPreviousClose ?? meta?.previousClose;
  if (price === undefined || previousClose === undefined || !meta?.regularMarketTime) {
    throw new Error(`Yahoo ${symbol} has no price`);
  }
  const { factor, currency } = unit(meta.currency);
  return {
    price: price * factor,
    previousClose: previousClose * factor,
    currency,
    at: new Date(meta.regularMarketTime * 1000).toISOString(),
  };
};

// A symbol Yahoo does not know or throttles is left out and named: its position falls back to IBKR's close.
export const fetchQuotes = async (
  symbols: string[],
  fetchFn: typeof fetch,
): Promise<{ quotes: Map<string, Quote>; missing: string[] }> => {
  const quotes = new Map<string, Quote>();
  const missing: string[] = [];
  for (let i = 0; i < symbols.length; i += 4) {
    const batch = symbols.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((s) => fetchQuote(s, fetchFn)));
    results.forEach((result, j) => {
      const symbol = batch[j] ?? "";
      if (result.status === "fulfilled") quotes.set(symbol, result.value);
      else missing.push(symbol);
    });
  }
  return { quotes, missing };
};

const YAHOO_RANGE: Record<HistoryRange, string> = { "1m": "1mo", "3m": "3mo", "1y": "1y" };

// Daily closes, oldest first. A day Yahoo has no close for (a halt, a holiday on that exchange) is skipped.
export const fetchHistory = async (
  symbol: string,
  range: HistoryRange,
  fetchFn: typeof fetch,
): Promise<{ currency: string; points: PricePoint[] }> => {
  const chart = await fetchChart(symbol, YAHOO_RANGE[range], fetchFn);
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];
  const { factor, currency } = unit(chart?.meta?.currency);
  const points = (chart?.timestamp ?? []).flatMap((t, i) => {
    const close = closes[i];
    if (close === null || close === undefined) return [];
    return [{ date: new Date(t * 1000).toISOString().slice(0, 10), close: close * factor }];
  });
  if (points.length === 0) throw new Error(`Yahoo ${symbol} has no history`);
  return { currency, points };
};
