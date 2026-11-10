import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { openDb } from "../db.js";
import { createLevelStore } from "./levels.js";
import { createWalletSource, readFlexFailure } from "./source.js";
import { createWalletStore } from "./store.js";

const statement = readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8");
const navStatement = readFileSync(new URL("./fixtures/flex-nav.xml", import.meta.url), "utf8");
const sendOk = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>1</ReferenceCode><Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`;
const expired = `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>`;

process.env.TZ = "America/Montevideo";

const setup = (opts: { tokenExpired?: boolean; statement?: string; nav?: string; navGate?: Promise<void> } = {}) => {
  const calls = { flex: 0, nav: 0, quotes: 0 };
  const fetchFn = (async (url: string) => {
    if (url.includes("SendRequest") && url.includes("q=nav")) {
      calls.nav += 1;
      return new Response(sendOk.replace("<ReferenceCode>1<", "<ReferenceCode>2<"));
    }
    if (url.includes("SendRequest")) {
      calls.flex += 1;
      return new Response(opts.tokenExpired ? expired : sendOk);
    }
    if (url.includes("GetStatement") && url.includes("q=2")) {
      await opts.navGate;
      return new Response(opts.nav ?? navStatement);
    }
    if (url.includes("GetStatement")) return new Response(opts.statement ?? statement);
    calls.quotes += 1;
    return Response.json({
      chart: { result: [{ meta: { regularMarketPrice: 1.1, chartPreviousClose: 1.1, currency: "USD", regularMarketTime: 1793462400 } }] },
    });
  }) as typeof fetch;
  let clock = new Date(2026, 9, 30, 6, 0);
  const db = openDb(":memory:");
  const store = createWalletStore(db);
  const snapshots: string[] = [];
  const source = createWalletSource({
    store,
    levels: createLevelStore(db),
    config: opts.nav === undefined ? { token: "t", queryId: "q" } : { token: "t", queryId: "q", navQueryId: "nav" },
    fetchFn,
    symbolsFile: null,
    sleep: async () => undefined,
    now: () => clock,
    onSnapshot: (s) => snapshots.push(s.reportDate),
  });
  const at = (h: number, m = 0, day = 30) => {
    clock = new Date(2026, 9, day, h, m);
    return clock;
  };
  return { source, store, calls, at, snapshots };
};

describe("wallet source schedule", () => {
  it("Flex runs once after 07:00 and not again the same day", async () => {
    const { source, calls, at, snapshots } = setup();
    await source.tick(at(6, 50));
    expect(calls.flex).toBe(0);
    await source.tick(at(7, 5));
    await source.tick(at(15, 0));
    expect(calls.flex).toBe(1);
    expect(snapshots).toEqual(["2026-10-30"]);
  });

  it("prices are read at the 11:00, 14:30 and 18:30 slots on weekdays only", async () => {
    const { source, calls, at } = setup();
    await source.tick(at(7, 5));
    const afterFlex = calls.quotes;
    await source.tick(at(10, 50));
    expect(calls.quotes).toBe(afterFlex);
    await source.tick(at(11, 5));
    const afterFirstSlot = calls.quotes;
    expect(afterFirstSlot).toBeGreaterThan(afterFlex);
    await source.tick(at(12, 0));
    expect(calls.quotes).toBe(afterFirstSlot);
    await source.tick(at(14, 35));
    expect(calls.quotes).toBeGreaterThan(afterFirstSlot);
    const friday = calls.quotes;
    await source.tick(at(11, 5, 31));
    expect(calls.quotes).toBe(friday);
  });

  it("an expired token is recorded as 'token' and not asked again the same day", async () => {
    const { source, store, calls, at } = setup({ tokenExpired: true });
    await source.tick(at(7, 5));
    expect(readFlexFailure(store.meta("lastFlexError"))?.kind).toBe("token");
    await source.tick(at(8, 10));
    await source.tick(at(20, 0));
    expect(calls.flex).toBe(1);
    expect((await source.read()).flexError?.kind).toBe("token");
  });

  it("a statement the query cannot produce is a format failure with IBKR's own words", async () => {
    const { source, at } = setup({ statement: "<FlexQueryResponse><FlexStatements count=\"1\"><FlexStatement accountId=\"U1\"><CashReport/></FlexStatement></FlexStatements></FlexQueryResponse>" });
    await source.tick(at(7, 5));
    expect((await source.read()).flexError).toEqual({
      kind: "format",
      message: "la Flex Query no tiene la sección Open Positions; agrégala con todos sus campos",
    });
  });

  it("a failure stored before failures had a kind is still read with the right kind", () => {
    expect(readFlexFailure("token")).toEqual({ kind: "token", message: "token" });
    expect(readFlexFailure("IBKR Flex format: falta Open Positions")).toEqual({ kind: "format", message: "falta Open Positions" });
    expect(readFlexFailure("IBKR Flex 500: down")).toEqual({ kind: "other", message: "IBKR Flex 500: down" });
    expect(readFlexFailure(null)).toBeNull();
  });

  it("a cartera.md failure is its own error, not IBKR's", async () => {
    const { store, at } = setup();
    const db = openDb(":memory:");
    const failing = createWalletSource({
      store,
      levels: createLevelStore(db),
      config: { token: "t", queryId: "q" },
      fetchFn: (async (url: string) =>
        new Response(url.includes("SendRequest") ? sendOk : statement)) as typeof fetch,
      symbolsFile: null,
      sleep: async () => undefined,
      now: () => at(7, 5),
      onSnapshot: () => {
        throw new Error("EACCES");
      },
    });
    await failing.refreshFlex();
    expect(store.meta("lastFlexError")).toBeNull();
    expect(store.meta("carteraError")).toBe("EACCES");
  });

  it("read values the snapshot; without config it says not configured", async () => {
    const { source, at } = setup();
    await source.tick(at(7, 5));
    const wallet = await source.read();
    expect(wallet.configured).toBe(true);
    expect(wallet.view?.positions.map((p) => p.symbol)).toEqual(["CSPX", "VWCE", "BRK B"]);
    const bareDb = openDb(":memory:");
    const bare = createWalletSource({
      store: createWalletStore(bareDb),
      levels: createLevelStore(bareDb),
      config: null,
      fetchFn: fetch,
      symbolsFile: null,
    });
    expect(await bare.read()).toMatchObject({ configured: false, view: null });
  });

});

describe("wallet history", () => {
  it("without the NAV query it is only my own daily values, starting with the first prices", async () => {
    const { source, calls, at } = setup();
    await source.tick(at(7, 5));
    await source.tick(at(11, 5));
    expect(calls.nav).toBe(0);
    const history = source.history("1m");
    expect(history.navConfigured).toBe(false);
    expect(history.points.map((p) => p.date)).toEqual(["2026-10-30"]);
    expect(history.points[0]?.totalUsd).toBeGreaterThan(0);
  });

  it("the NAV query brings IBKR's past after each Flex read", async () => {
    const { source, store, at } = setup({ nav: navStatement });
    await source.tick(at(7, 5));
    expect(source.history("1m").points.map((p) => p.date)).toEqual(["2026-10-27", "2026-10-28", "2026-10-30"]);
    expect(store.meta("lastNavError")).toBeNull();
  });

  it("a NAV failure is kept apart: the positions still count as read", async () => {
    const { source, store, at } = setup({ nav: "<FlexQueryResponse><FlexStatements><FlexStatement/></FlexStatements></FlexQueryResponse>" });
    await source.tick(at(7, 5));
    expect(store.meta("lastFlexError")).toBeNull();
    expect(source.history("1y").navError).toContain("sin cuentas");
  });

  it("a manual IBKR refresh answers without waiting for the NAV, which lands in the background", async () => {
    let releaseNav = () => {};
    const navGate = new Promise<void>((resolve) => (releaseNav = resolve));
    const { source, at } = setup({ nav: navStatement, navGate });
    at(7, 5);
    await source.refreshFlex();
    expect(source.history("1m").points).toEqual([]);
    releaseNav();
    await source.tick(at(7, 6));
    expect(source.history("1m").points.map((p) => p.date)).toEqual(["2026-10-27", "2026-10-28", "2026-10-30"]);
  });

  it("a weekend price read leaves no point: there is no close to replace it", async () => {
    const { source, at } = setup();
    await source.tick(at(7, 5));
    at(12, 0, 31);
    await source.refreshPrices();
    expect(source.history("1m").points.map((p) => p.date)).toEqual([]);
  });
});
