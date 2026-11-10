import { localDate } from "../../../shared/dates.js";
import type { FlexSnapshot, WalletPosition, WalletView } from "../../../shared/wallet.js";
import { cashInUsd } from "./cash.js";
import type { Quote } from "./prices.js";

// quotes are keyed by the IBKR symbol; fx is USD per unit of each currency.
export const valuate = (
  snapshot: FlexSnapshot,
  quotes: ReadonlyMap<string, Quote>,
  fx: ReadonlyMap<string, number>,
  now: Date,
): WalletView => {
  // IBKR's own close rate for each currency it holds, for when no live rate came back.
  const ibkrRates = new Map(snapshot.positions.map((p) => [p.currency, p.fxRateToBase]));
  const rateOf = (currency: string): number => (currency === "USD" ? 1 : (fx.get(currency) ?? ibkrRates.get(currency) ?? 1));
  const today = localDate(now);

  let dayChangeUsd = 0;
  let anyLive = false;
  const valued = snapshot.positions.map((p) => {
    // A quote in another currency than IBKR's (a wrong symbol mapping) would mix prices with the cost basis: skip it.
    const listed = quotes.get(p.symbol);
    const quote = listed?.currency === p.currency ? listed : undefined;
    const live = quote !== undefined;
    const currency = p.currency;
    const rate = rateOf(currency);
    const price = quote?.price ?? p.markPrice;
    const fresh = quote !== undefined && localDate(new Date(quote.at)) === today && quote.previousClose > 0;
    if (fresh) {
      anyLive = true;
      dayChangeUsd += p.quantity * (quote.price - quote.previousClose) * rate;
    }
    return {
      symbol: p.symbol,
      description: p.description,
      currency,
      quantity: p.quantity,
      price,
      priceSource: live ? ("live" as const) : ("ibkr-close" as const),
      dayChangePct: fresh ? (quote.price / quote.previousClose - 1) * 100 : null,
      valueUsd: p.quantity * price * rate,
      pnlUsd: p.quantity * (price - p.costBasisPrice) * rate,
    };
  });

  const cashUsd = cashInUsd(snapshot, rateOf);
  const positionsUsd = valued.reduce((sum, p) => sum + p.valueUsd, 0);
  const totalIbkrUsd = positionsUsd + cashUsd;
  const positions: WalletPosition[] = valued.map((p) => ({
    ...p,
    weightPct: totalIbkrUsd > 0 ? (p.valueUsd / totalIbkrUsd) * 100 : 0,
  }));
  const quoteTimes = [...quotes.values()].map((q) => q.at).sort();
  return {
    positions,
    cashUsd,
    totalIbkrUsd,
    dayChangeUsd,
    dayChangePct: anyLive && positionsUsd - dayChangeUsd > 0 ? (dayChangeUsd / (positionsUsd - dayChangeUsd)) * 100 : null,
    pricesAt: quoteTimes.at(-1) ?? null,
    flexReportDate: snapshot.reportDate,
  };
};
