import { describe, expect, it } from "vitest";

import { readKeyValues } from "../files.js";
import { fetchHistory, fetchQuotes, yahooSymbol } from "./prices.js";

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }] } });

describe("yahooSymbol", () => {
  it("LSE, Xetra and SIX listings map to Yahoo suffixes, overrides win", () => {
    const none = new Map<string, string>();
    expect(yahooSymbol({ symbol: "CSPX", listingExchange: "LSEETF" }, none)).toBe("CSPX.L");
    expect(yahooSymbol({ symbol: "VWCE", listingExchange: "IBIS2" }, none)).toBe("VWCE.DE");
    expect(yahooSymbol({ symbol: "EQAC", listingExchange: "EBS" }, none)).toBe("EQAC.SW");
    expect(yahooSymbol({ symbol: "QQQM", listingExchange: "NASDAQ" }, none)).toBe("QQQM");
    expect(yahooSymbol({ symbol: "BRK B", listingExchange: "NYSE" }, none)).toBe("BRK-B");
    expect(yahooSymbol({ symbol: "VWCE", listingExchange: "IBIS2" }, new Map([["VWCE", "VWRA.L"]]))).toBe("VWRA.L");
  });

  it("reads TICKER=SYMBOL overrides, ignoring comments and blank lines", () => {
    expect(readKeyValues("# mine\nVWCE = VWRA.L\n\nbad line\n")).toEqual(new Map([["VWCE", "VWRA.L"]]));
  });
});

describe("fetchQuotes", () => {
  const fetchFn = (async (url: string) => {
    const symbol = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
    if (symbol === "GONE") return new Response("", { status: 404 });
    if (symbol === "BUSY") return new Response("", { status: 429 });
    if (symbol === "VOD.L") {
      return Response.json(chart({ regularMarketPrice: 7250, chartPreviousClose: 7100, currency: "GBp", regularMarketTime: 1793462400 }));
    }
    return Response.json(chart({ regularMarketPrice: 101, chartPreviousClose: 100, currency: "USD", regularMarketTime: 1793462400 }));
  }) as typeof fetch;

  it("GBp quote is divided by 100 and reported in GBP", async () => {
    const { quotes } = await fetchQuotes(["VOD.L"], fetchFn);
    expect(quotes.get("VOD.L")).toEqual({ price: 72.5, previousClose: 71, currency: "GBP", at: new Date(1793462400 * 1000).toISOString() });
  });

  it("a missing or throttled symbol is left out and named, the rest load", async () => {
    const { quotes, missing } = await fetchQuotes(["QQQM", "GONE", "BUSY"], fetchFn);
    expect([...quotes.keys()]).toEqual(["QQQM"]);
    expect(missing).toEqual(["GONE", "BUSY"]);
  });
});

describe("fetchHistory", () => {
  const fetchFn = (async (url: string) => {
    if (url.includes("GONE")) return new Response("", { status: 404 });
    expect(url).toContain("range=3mo&interval=1d");
    return Response.json({
      chart: {
        result: [
          {
            meta: { currency: url.includes(".L") ? "GBp" : "USD" },
            timestamp: [1793030400, 1793116800, 1793203200],
            indicators: { quote: [{ close: [7200, null, 7300] }] },
          },
        ],
      },
    });
  }) as typeof fetch;

  it("reads daily closes, skips days without one and turns pence into pounds", async () => {
    expect(await fetchHistory("VOD.L", "3m", fetchFn)).toEqual({
      currency: "GBP",
      points: [
        { date: "2026-10-26", close: 72 },
        { date: "2026-10-28", close: 73 },
      ],
    });
    expect((await fetchHistory("CRDO", "3m", fetchFn)).points[0]?.close).toBe(7200);
  });

  it("fails when Yahoo does not know the symbol", async () => {
    await expect(fetchHistory("GONE", "3m", fetchFn)).rejects.toThrow("404");
  });
});
