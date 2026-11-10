import { oneOf } from "./choices.js";

// One open position as IBKR reported it at the last close (Flex Web Service).
export type FlexPosition = {
  symbol: string;
  description: string;
  assetCategory: string;
  subCategory: string;
  currency: string;
  listingExchange: string;
  quantity: number;
  markPrice: number;
  costBasisPrice: number;
  positionValue: number;
  unrealizedPnl: number;
  // IBKR's rate to the account's base currency (USD) at the close: the fallback when no live rate is available.
  fxRateToBase: number;
};

export type CashBalance = { currency: string; amount: number };

// reportDate: the close the snapshot reflects (YYYY-MM-DD). cashBaseUsd: IBKR's own total of all cash in USD (its
// BASE_SUMMARY row), null when the statement does not carry it.
export type FlexSnapshot = { reportDate: string; positions: FlexPosition[]; cash: CashBalance[]; cashBaseUsd: number | null };

// live: a quote from Yahoo; ibkr-close: no quote, so the price IBKR marked at the last close.
export type PriceSource = "live" | "ibkr-close";

export type WalletPosition = {
  symbol: string;
  description: string;
  currency: string;
  quantity: number;
  price: number;
  priceSource: PriceSource;
  // Null when the quote is not from today (weekend, holiday, no live price): no move to report.
  dayChangePct: number | null;
  valueUsd: number;
  pnlUsd: number;
  weightPct: number;
};

export type WalletView = {
  positions: WalletPosition[];
  cashUsd: number;
  totalIbkrUsd: number;
  dayChangeUsd: number;
  dayChangePct: number | null;
  pricesAt: string | null;
  flexReportDate: string;
};

// The other custodians (banks, funds, exchanges) are kept by hand in cartera.md; Jarvis only reads their total.
export type OtherCustodians = { totalUsd: number; asOf: string | null };

// What the wallet answers before IBKR is set up.
export const EMPTY_WALLET: WalletResponse = {
  configured: false,
  view: null,
  others: null,
  lastFlexAt: null,
  flexError: null,
  carteraError: null,
  levels: [],
  alerts: [],
};

export type WalletResponse = {
  configured: boolean;
  view: WalletView | null;
  others: OtherCustodians | null;
  lastFlexAt: string | null;
  flexError: FlexFailure | null;
  carteraError: string | null;
  levels: WalletLevel[];
  alerts: WalletAlert[];
};

// token: only a new Flex token fixes it; format: the Flex Query has to be changed; other: IBKR or the network failed.
export type FlexFailure = { kind: "token" | "format" | "other"; message: string };

export type LevelDirection = "below" | "above";

// Only names what the price means to me: Jarvis never places an order, a stop included.
export const LEVEL_KINDS = ["stop", "take_profit", "alert"] as const;

export type LevelKind = (typeof LEVEL_KINDS)[number];

// A price I set for a ticker, in the ticker's own currency. researchId: the analysis that suggested it.
export type WalletLevel = {
  id: number;
  symbol: string;
  direction: LevelDirection;
  price: number;
  kind: LevelKind;
  note: string | null;
  researchId: number | null;
};

export type LevelInput = Omit<WalletLevel, "id">;

// A level an analysis recommends; it becomes a WalletLevel only when I create it.
export type SuggestedLevel = Omit<LevelInput, "note" | "researchId"> & { why: string };

const NOTE_MAX = 300;

export const cleanNote = (value: unknown): string | null =>
  typeof value === "string" ? value.trim().slice(0, NOTE_MAX) || null : null;

// The one validator for a level, whether it comes from my form or from an agent's answer.
export const parseLevelInput = (body: unknown): LevelInput | null => {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  const price = Number(raw.price);
  if (!symbol || symbol.length > 20 || !Number.isFinite(price) || price <= 0) return null;
  if (raw.direction !== "below" && raw.direction !== "above") return null;
  const kind = raw.kind === undefined ? "alert" : raw.kind;
  if (!LEVEL_KINDS.includes(kind as LevelKind)) return null;
  const researchId = raw.researchId === undefined || raw.researchId === null ? null : Number(raw.researchId);
  if (researchId !== null && !(Number.isInteger(researchId) && researchId > 0)) return null;
  return { symbol, direction: raw.direction, price, kind: kind as LevelKind, note: cleanNote(raw.note), researchId };
};

// IBKR writes "BRK B", my notes "BRK.B" (struck through as "~~BRK.B~~") and Yahoo "BRK-B": all the same ticker.
export const tickerKey = (ticker: string): string => ticker.replace(/[\s.\-~*]/g, "").toUpperCase();

export const sameTicker = (a: string, b: string): boolean => tickerKey(a) === tickerKey(b);

// move: |day change| ≥ 5%; level: a price of mine was crossed; sync: Flex or cartera.md could not be updated.
// key is stable per day, so the same alert is pushed once.
export type WalletAlert = {
  key: string;
  kind: "move" | "level" | "sync";
  severity: "critical" | "warning";
  symbol: string | null;
  title: string;
  detail: string;
  // The analysis behind a level, so its card can link back to it.
  researchId: number | null;
};

export type NavPoint = { date: string; totalUsd: number };

export const HISTORY_RANGES = ["1m", "3m", "1y"] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];

export const isHistoryRange = oneOf(HISTORY_RANGES);

// navConfigured: whether the NAV Flex Query is set up, so the page can say how to get the year behind today.
export type WalletHistory = { points: NavPoint[]; navConfigured: boolean; navError: string | null };

export type PricePoint = { date: string; close: number };

// A position's chart: its prices in its own currency, with what I paid and my levels drawn over them.
export type PositionHistory = { symbol: string; currency: string; points: PricePoint[]; costBasisPrice: number; levels: WalletLevel[] };
