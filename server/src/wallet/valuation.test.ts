import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseFlexPositions } from "./flex.js";
import type { Quote } from "./prices.js";
import { valuate } from "./valuation.js";

const snapshot = parseFlexPositions(readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8"));

process.env.TZ = "America/Montevideo";
const now = new Date(2026, 9, 30, 15, 0);
const today = new Date(2026, 9, 30, 14, 0).toISOString();
const yesterday = new Date(2026, 9, 29, 17, 0).toISOString();

const quotes = new Map<string, Quote>([
  ["CSPX", { price: 810, previousClose: 800, currency: "USD", at: today }],
  ["VWCE", { price: 160, previousClose: 150, currency: "EUR", at: today }],
]);

describe("valuate", () => {
  it("EUR position is converted with EURUSD", () => {
    const view = valuate(snapshot, quotes, new Map([["EUR", 1.1]]), now);
    const vwce = view.positions.find((p) => p.symbol === "VWCE");
    expect(vwce).toMatchObject({ price: 160, priceSource: "live", valueUsd: 20 * 160 * 1.1 });
    expect(vwce?.pnlUsd).toBeCloseTo(20 * (160 - 130) * 1.1);
    expect(vwce?.dayChangePct).toBeCloseTo(6.6667, 3);
  });

  it("a missing quote falls back to the IBKR close and is marked", () => {
    const view = valuate(snapshot, quotes, new Map([["EUR", 1.1]]), now);
    expect(view.positions.find((p) => p.symbol === "BRK B")).toMatchObject({
      price: 500,
      priceSource: "ibkr-close",
      dayChangePct: null,
      valueUsd: 1500,
    });
  });

  it("without a live rate, IBKR's own rate converts the position", () => {
    const view = valuate(snapshot, quotes, new Map(), now);
    expect(view.positions.find((p) => p.symbol === "VWCE")?.valueUsd).toBeCloseTo(20 * 160 * 1.08);
  });

  it("a quote in another currency than the IBKR position is not used", () => {
    const pence = new Map<string, Quote>([["CSPX", { price: 6.5, previousClose: 6.4, currency: "GBP", at: today }]]);
    expect(valuate(snapshot, pence, new Map(), now).positions.find((p) => p.symbol === "CSPX")).toMatchObject({
      price: 800.5,
      priceSource: "ibkr-close",
      currency: "USD",
    });
  });

  it("cash uses IBKR's own USD total when the statement has it", () => {
    expect(valuate({ ...snapshot, cashBaseUsd: 1300 }, quotes, new Map([["EUR", 1.1]]), now).cashUsd).toBe(1300);
  });

  it("a quote from a previous day gives no day change", () => {
    const stale = new Map<string, Quote>([["CSPX", { price: 810, previousClose: 800, currency: "USD", at: yesterday }]]);
    const view = valuate(snapshot, stale, new Map(), now);
    expect(view.positions.find((p) => p.symbol === "CSPX")?.dayChangePct).toBeNull();
    expect(view.dayChangePct).toBeNull();
  });

  it("totals add positions and cash, weights add to 100 with cash", () => {
    const view = valuate(snapshot, quotes, new Map([["EUR", 1.1]]), now);
    const positionsUsd = 10 * 810 + 20 * 160 * 1.1 + 1500;
    // IBKR's own USD total of all cash (the statement's BASE_SUMMARY row).
    expect(view.cashUsd).toBe(1300);
    expect(view.totalIbkrUsd).toBeCloseTo(positionsUsd + view.cashUsd);
    expect(view.dayChangeUsd).toBeCloseTo(10 * 10 + 20 * 10 * 1.1);
    const weights = view.positions.reduce((sum, p) => sum + p.weightPct, 0) + (view.cashUsd / view.totalIbkrUsd) * 100;
    expect(weights).toBeCloseTo(100);
  });
});
