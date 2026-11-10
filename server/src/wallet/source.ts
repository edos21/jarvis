import { existsSync, readFileSync } from "node:fs";

import { localDate } from "../../../shared/dates.js";
import {
  type FlexFailure,
  type FlexSnapshot,
  type HistoryRange,
  type OtherCustodians,
  type PositionHistory,
  type PricePoint,
  type WalletHistory,
  type WalletResponse,
  sameTicker,
} from "../../../shared/wallet.js";
import type { IbkrConfig } from "../env.js";
import { readKeyValues } from "../files.js";
import { walletAlerts } from "./alerts.js";
import { FlexError, FlexTokenInvalid, fetchFlexStatement, parseFlexNav, parseFlexPositions } from "./flex.js";
import type { LevelStore } from "./levels.js";
import { type Quote, fetchHistory, fetchQuotes, yahooSymbol } from "./prices.js";
import type { WalletStore } from "./store.js";
import { valuate } from "./valuation.js";

const flexFailure = (error: unknown): FlexFailure => {
  if (error instanceof FlexTokenInvalid) return { kind: "token", message: error.detail };
  if (error instanceof FlexError) return { kind: error.code === "format" ? "format" : "other", message: error.detail };
  return { kind: "other", message: error instanceof Error ? error.message : String(error) };
};

const LEGACY_FORMAT_PREFIX = "IBKR Flex format: ";

// Stored as JSON; a value from before that is "token" or the error's full message.
export const readFlexFailure = (stored: string | null): FlexFailure | null => {
  if (stored === null) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<FlexFailure>;
    if ((parsed.kind === "token" || parsed.kind === "format" || parsed.kind === "other") && typeof parsed.message === "string") {
      return { kind: parsed.kind, message: parsed.message };
    }
  } catch {
    // Not JSON: a value stored before failures had a kind.
  }
  if (stored === "token") return { kind: "token", message: stored };
  if (stored.startsWith(LEGACY_FORMAT_PREFIX)) return { kind: "format", message: stored.slice(LEGACY_FORMAT_PREFIX.length) };
  return { kind: "other", message: stored };
};

// Flex reflects the previous close: once a day is enough, after the morning and again if the last one is old.
const FLEX_AFTER_HOUR = 7;
const FLEX_STALE_MS = 20 * 60 * 60_000;
const FLEX_RETRY_MS = 60 * 60_000;
// An expired token stays expired until I put a new one in and restart: no point asking IBKR every hour.
const FLEX_TOKEN_RETRY_MS = 24 * 60 * 60_000;
// Minutes after midnight: around the European close, mid US session, after the US close.
const PRICE_SLOTS = [11 * 60, 14 * 60 + 30, 18 * 60 + 30];

const RANGE_DAYS: Record<HistoryRange, number> = { "1m": 31, "3m": 92, "1y": 366 };
const NAV_AFTER_FLEX_MS = 5_000;
// Past closes do not change: a position's chart asks Yahoo again only a few times a day.
const HISTORY_CACHE_MS = 6 * 60 * 60_000;

export type WalletSource = {
  read(): Promise<WalletResponse>;
  refreshFlex(): Promise<void>;
  refreshPrices(): Promise<void>;
  history(range: HistoryRange): WalletHistory;
  // Null when the symbol is not one of my positions.
  positionHistory(symbol: string, range: HistoryRange): Promise<PositionHistory | null>;
  // Called by the server's periodic tick: runs whatever is due.
  tick(now: Date): Promise<void>;
};

export const createWalletSource = (deps: {
  store: WalletStore;
  levels: LevelStore;
  config: IbkrConfig | null;
  fetchFn: typeof fetch;
  symbolsFile: string | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  // Called with each new snapshot (keeps cartera.md in step) and read for the other custodians' total.
  onSnapshot?: (snapshot: FlexSnapshot) => void;
  readOthers?: () => OtherCustodians | null;
}): WalletSource => {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let prices: { quotes: Map<string, Quote>; fx: Map<string, number>; at: Date } | null = null;
  let lastFlexAttempt = 0;
  let flexRunning: Promise<void> | null = null;
  let pricesRunning: Promise<void> | null = null;
  let navRunning: Promise<void> | null = null;
  // The request itself is kept, so a second chart asking while the first is loading joins it.
  const priceHistory = new Map<string, { at: number; result: Promise<{ currency: string; points: PricePoint[] }> }>();

  const overrides = (): Map<string, string> =>
    deps.symbolsFile && existsSync(deps.symbolsFile) ? readKeyValues(readFileSync(deps.symbolsFile, "utf8")) : new Map();

  const doRefreshFlex = async (): Promise<void> => {
    if (!deps.config) return;
    lastFlexAttempt = now().getTime();
    let snapshot;
    try {
      snapshot = parseFlexPositions(await fetchFlexStatement(deps.config, deps.fetchFn, sleep));
      deps.store.saveSnapshot(snapshot);
      deps.store.setMeta("lastFlexAt", now().toISOString());
      deps.store.setMeta("lastFlexError", null);
    } catch (error) {
      deps.store.setMeta("lastFlexError", JSON.stringify(flexFailure(error)));
      throw error;
    }
    // Keeping cartera.md in step is a separate concern: its failure is reported as its own, never as IBKR's.
    try {
      deps.onSnapshot?.(snapshot);
    } catch (error) {
      deps.store.setMeta("carteraError", (error as Error).message);
    }
    // In the background: the positions are already saved, and the NAV statement can take minutes to be generated.
    if (deps.config.navQueryId) {
      navRunning ??= doRefreshNav().finally(() => {
        navRunning = null;
      });
    }
  };

  // The whole period every time: the upsert makes it idempotent and it is one request a day. A failure only costs the
  // chart its past, so it is kept apart from the positions' error.
  const doRefreshNav = async (): Promise<void> => {
    if (!deps.config?.navQueryId) return;
    // IBKR limits Flex requests per token; the positions' request was just made.
    await sleep(NAV_AFTER_FLEX_MS);
    try {
      const xml = await fetchFlexStatement({ ...deps.config, queryId: deps.config.navQueryId }, deps.fetchFn, sleep);
      deps.store.saveNav(parseFlexNav(xml), "ibkr");
      deps.store.setMeta("lastNavError", null);
    } catch (error) {
      deps.store.setMeta("lastNavError", flexFailure(error).message);
    }
  };

  const doRefreshPrices = async (): Promise<void> => {
    const snapshot = deps.store.latestSnapshot();
    if (!snapshot) return;
    const map = overrides();
    const bySymbol = new Map(snapshot.positions.map((p) => [yahooSymbol(p, map), p.symbol]));
    const currencies = [...new Set([...snapshot.positions.map((p) => p.currency), ...snapshot.cash.map((c) => c.currency)])].filter(
      (c) => c !== "USD",
    );
    const fxSymbols = currencies.map((c) => `${c}USD=X`);
    const { quotes } = await fetchQuotes([...bySymbol.keys(), ...fxSymbols], deps.fetchFn);
    const byIbkr = new Map<string, Quote>();
    for (const [yahoo, quote] of quotes) {
      const ibkr = bySymbol.get(yahoo);
      if (ibkr) byIbkr.set(ibkr, quote);
    }
    const fx = new Map<string, number>();
    for (const currency of currencies) {
      const rate = quotes.get(`${currency}USD=X`)?.price;
      if (rate) fx.set(currency, rate);
    }
    prices = { quotes: byIbkr, fx, at: now() };
    // Today's point of the history, until IBKR's close for the day replaces it. A weekend has no close: no point.
    const at = now();
    if (at.getDay() !== 0 && at.getDay() !== 6) {
      deps.store.saveNav([{ date: localDate(at), totalUsd: valuate(snapshot, byIbkr, fx, at).totalIbkrUsd }], "live");
    }
  };

  // One run at a time: a click while the tick is already refreshing joins it instead of doubling the calls.
  const refreshFlex = (): Promise<void> => {
    flexRunning ??= doRefreshFlex().finally(() => {
      flexRunning = null;
    });
    return flexRunning;
  };
  const refreshPrices = (): Promise<void> => {
    pricesRunning ??= doRefreshPrices().finally(() => {
      pricesRunning = null;
    });
    return pricesRunning;
  };

  const flexDue = (at: Date): boolean => {
    if (!deps.config || at.getHours() < FLEX_AFTER_HOUR) return false;
    const wait = readFlexFailure(deps.store.meta("lastFlexError"))?.kind === "token" ? FLEX_TOKEN_RETRY_MS : FLEX_RETRY_MS;
    if (at.getTime() - lastFlexAttempt < wait) return false;
    const last = deps.store.meta("lastFlexAt");
    return !last || at.getTime() - Date.parse(last) > FLEX_STALE_MS;
  };

  const pricesDue = (at: Date): boolean => {
    const weekday = at.getDay() >= 1 && at.getDay() <= 5;
    const minutes = at.getHours() * 60 + at.getMinutes();
    const slot = PRICE_SLOTS.filter((s) => s <= minutes).at(-1);
    if (!weekday || slot === undefined) return false;
    const slotTime = new Date(at.getFullYear(), at.getMonth(), at.getDate(), Math.floor(slot / 60), slot % 60);
    return !prices || prices.at < slotTime;
  };

  return {
    read: async () => {
      const snapshot = deps.store.latestSnapshot();
      // After a restart there are no prices in memory: read them once, whatever the day.
      if (snapshot && !prices) await refreshPrices().catch(() => undefined);
      const at = now();
      const view = snapshot ? valuate(snapshot, prices?.quotes ?? new Map(), prices?.fx ?? new Map(), at) : null;
      const levels = deps.levels.list();
      const errors = { flexError: readFlexFailure(deps.store.meta("lastFlexError")), carteraError: deps.store.meta("carteraError") };
      return {
        configured: deps.config !== null,
        view,
        others: deps.readOthers?.() ?? null,
        lastFlexAt: deps.store.meta("lastFlexAt"),
        ...errors,
        levels,
        alerts: walletAlerts(view, levels, errors, at),
      };
    },
    refreshFlex,
    refreshPrices,
    history: (range) => {
      const from = new Date(now().getTime() - RANGE_DAYS[range] * 24 * 60 * 60_000);
      return {
        points: deps.store.nav(localDate(from)),
        navConfigured: Boolean(deps.config?.navQueryId),
        navError: deps.store.meta("lastNavError"),
      };
    },
    positionHistory: async (symbol, range) => {
      const position = deps.store.latestSnapshot()?.positions.find((p) => p.symbol === symbol);
      if (!position) return null;
      const yahoo = yahooSymbol(position, overrides());
      const key = `${yahoo} ${range}`;
      let cached = priceHistory.get(key);
      if (!cached || now().getTime() - cached.at > HISTORY_CACHE_MS) {
        const result = fetchHistory(yahoo, range, deps.fetchFn);
        cached = { at: now().getTime(), result };
        priceHistory.set(key, cached);
        // A failure is not kept: the next chart asks Yahoo again.
        result.catch(() => priceHistory.delete(key));
      }
      const { currency, points } = await cached.result;
      return {
        symbol,
        currency,
        points,
        costBasisPrice: position.costBasisPrice,
        levels: deps.levels.list().filter((l) => sameTicker(l.symbol, symbol)),
      };
    },
    tick: async (at) => {
      if (flexDue(at)) await refreshFlex().catch(() => undefined);
      await navRunning;
      if (pricesDue(at)) await refreshPrices().catch(() => undefined);
    },
  };
};
