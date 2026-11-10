import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readIbkrConfig } from "../env.js";
import { FlexError, FlexTokenInvalid, fetchFlexStatement, parseFlexNav, parseFlexPositions } from "./flex.js";

const statement = readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8");
const config = { token: "t0k3n", queryId: "123" };
const noSleep = async () => undefined;

const sendOk = `<FlexStatementResponse timestamp="31 October, 2026 07:15 AM EST"><Status>Success</Status><ReferenceCode>987</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`;
const fail = (code: number, message: string) =>
  `<FlexStatementResponse><Status>Fail</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>${message}</ErrorMessage></FlexStatementResponse>`;
const inProgress = `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`;

const fakeFetch = (answers: string[]) => {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    return new Response(answers.shift() ?? "", { status: 200 });
  }) as typeof fetch;
  return { fetchFn, urls };
};

describe("parseFlexPositions", () => {
  it("parses positions and cash from a statement", () => {
    const snapshot = parseFlexPositions(statement);
    expect(snapshot.reportDate).toBe("2026-10-30");
    expect(snapshot.positions.map((p) => [p.symbol, p.currency, p.listingExchange, p.quantity])).toEqual([
      ["CSPX", "USD", "LSEETF", 10],
      ["VWCE", "EUR", "IBIS2", 20],
      ["BRK B", "USD", "NYSE", 3],
    ]);
    expect(snapshot.positions[0]).toMatchObject({
      description: "ISHARES CORE S&P 500",
      subCategory: "ETF",
      markPrice: 800.5,
      costBasisPrice: 700.25,
      positionValue: 8005,
      unrealizedPnl: 1002.5,
      fxRateToBase: 1,
    });
    expect(snapshot.positions[1]?.fxRateToBase).toBe(1.08);
    expect(snapshot.cash).toEqual([
      { currency: "USD", amount: 1250.75 },
      { currency: "EUR", amount: 40 },
    ]);
  });
});

describe("parseFlexPositions refuses a statement it cannot trust", () => {
  const without = (pattern: RegExp) => statement.replace(pattern, "");

  it("a query without the Open Positions section", () => {
    expect(() => parseFlexPositions(without(/<OpenPositions>[\s\S]*<\/OpenPositions>/))).toThrow(/Open Positions/);
  });

  it("an empty Open Positions section is an account with no positions, not an error", () => {
    const empty = statement.replace(/<OpenPositions>[\s\S]*<\/OpenPositions>/, "<OpenPositions />");
    expect(parseFlexPositions(empty).positions).toEqual([]);
  });

  it("more than one account in the statement", () => {
    const two = statement.replace(/<FlexStatements count="1">([\s\S]*)<\/FlexStatements>/, (_, s: string) => `<FlexStatements count="2">${s}${s}</FlexStatements>`);
    expect(() => parseFlexPositions(two)).toThrow(/una sola cuenta/);
  });

  it("a non-USD position without fxRateToBase", () => {
    expect(() => parseFlexPositions(statement.replace(' fxRateToBase="1.08"', ""))).toThrow(/fxRateToBase/);
  });

  it("keeps IBKR's own cash total in USD", () => {
    expect(parseFlexPositions(statement).cashBaseUsd).toBe(1300);
  });
});

describe("fetchFlexStatement", () => {
  it("asks for the statement, then fetches it by reference", async () => {
    const { fetchFn, urls } = fakeFetch([sendOk, statement]);
    expect(await fetchFlexStatement(config, fetchFn, noSleep)).toBe(statement);
    expect(new URL(urls[0]!).searchParams.get("q")).toBe("123");
    expect(new URL(urls[1]!).searchParams.get("q")).toBe("987");
  });

  it("1019 is retried and then succeeds", async () => {
    const waits: number[] = [];
    const { fetchFn } = fakeFetch([sendOk, inProgress, inProgress, statement]);
    const xml = await fetchFlexStatement(config, fetchFn, async (ms) => {
      waits.push(ms);
    });
    expect(xml).toBe(statement);
    expect(waits).toEqual([5_000, 10_000]);
  });

  it("an invalid or expired token is FlexTokenInvalid, not a crash", async () => {
    await expect(fetchFlexStatement(config, fakeFetch([fail(1012, "Token has expired.")]).fetchFn, noSleep)).rejects.toBeInstanceOf(
      FlexTokenInvalid,
    );
    await expect(fetchFlexStatement(config, fakeFetch([fail(1015, "Token is invalid.")]).fetchFn, noSleep)).rejects.toBeInstanceOf(
      FlexTokenInvalid,
    );
  });

  it("other errors say what IBKR said, and never carry the token", async () => {
    const error = await fetchFlexStatement(config, fakeFetch([fail(1014, "Query is invalid.")]).fetchFn, noSleep).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FlexError);
    expect(String(error)).toContain("Query is invalid.");
    expect(String(error)).not.toContain("t0k3n");
  });
});

describe("readIbkrConfig", () => {
  it("missing config → wallet not configured", () => {
    expect(readIbkrConfig({})).toBeNull();
    expect(readIbkrConfig({ JARVIS_IBKR_FLEX_TOKEN: "x" })).toBeNull();
    expect(readIbkrConfig({ JARVIS_IBKR_FLEX_TOKEN: " x ", JARVIS_IBKR_FLEX_QUERY_ID: "9" })).toEqual({ token: "x", queryId: "9" });
    expect(readIbkrConfig({ JARVIS_IBKR_FLEX_TOKEN: "x", JARVIS_IBKR_FLEX_QUERY_ID: "9", JARVIS_IBKR_FLEX_NAV_QUERY_ID: " 10 " })).toEqual({
      token: "x",
      queryId: "9",
      navQueryId: "10",
    });
  });
});

describe("parseFlexNav", () => {
  it("reads one value per day, oldest first, skipping days without a total", () => {
    const nav = parseFlexNav(readFileSync(new URL("./fixtures/flex-nav.xml", import.meta.url), "utf8"));
    expect(nav).toEqual([
      { date: "2026-10-27", totalUsd: 21500 },
      { date: "2026-10-28", totalUsd: 21600 },
      { date: "2026-10-30", totalUsd: 22000.5 },
    ]);
  });

  it("refuses a query without the NAV section or without days", () => {
    expect(() => parseFlexNav(statement)).toThrow(FlexError);
    const empty = '<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><EquitySummaryInBase/></FlexStatement></FlexStatements></FlexQueryResponse>';
    expect(() => parseFlexNav(empty)).toThrow("sin días");
  });
});
