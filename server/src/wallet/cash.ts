import type { FlexSnapshot } from "../../../shared/wallet.js";

// All cash in USD: IBKR's own total when the statement has it, otherwise each currency at the given rate.
export const cashInUsd = (snapshot: FlexSnapshot, rateOf: (currency: string) => number): number =>
  snapshot.cashBaseUsd ?? snapshot.cash.reduce((sum, c) => sum + c.amount * rateOf(c.currency), 0);
