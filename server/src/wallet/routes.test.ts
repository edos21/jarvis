import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { PositionHistory, WalletResponse } from "../../../shared/wallet.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createLevelStore } from "./levels.js";
import { walletRoutes } from "./routes.js";
import { createWalletSource } from "./source.js";
import { parseFlexPositions } from "./flex.js";
import { createWalletStore } from "./store.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";

const setup = () => {
  const db = openDb(":memory:");
  const levels = createLevelStore(db);
  const source = createWalletSource({ store: createWalletStore(db), levels, config: null, fetchFn: fetch, symbolsFile: null });
  const app = createApp({ tailnetHost: TAILNET, routes: [walletRoutes(source, levels)] });
  const send = (method: string, path: string, body?: unknown, base = LOCAL) =>
    app.request(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { send };
};

describe("wallet level routes", () => {
  it("creates and deletes a level from the Mac", async () => {
    const { send } = setup();
    const created = (await (await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "below", price: 148, note: "stop" })).json()) as WalletResponse;
    expect(created.levels).toEqual([
      { id: 1, symbol: "CRDO", direction: "below", price: 148, kind: "alert", note: "stop", researchId: null },
    ]);
    expect((await send("DELETE", "/wallet/levels/1")).status).toBe(200);
    expect((await send("DELETE", "/wallet/levels/1")).status).toBe(404);
  });

  it("keeps the kind and the analysis a level came from", async () => {
    const { send } = setup();
    const body = { symbol: "crdo", direction: "above", price: 260, kind: "take_profit", note: "objetivo", researchId: 4 };
    const created = (await (await send("POST", "/wallet/levels", body)).json()) as WalletResponse;
    expect(created.levels[0]).toMatchObject({ symbol: "CRDO", kind: "take_profit", researchId: 4 });
  });

  it("refuses a level without a valid price or direction", async () => {
    const { send } = setup();
    expect((await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "below", price: -1 })).status).toBe(400);
    expect((await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "sideways", price: 10 })).status).toBe(400);
    expect((await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "below", price: 10, kind: "sell" })).status).toBe(400);
    expect((await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "below", price: 10, researchId: "x" })).status).toBe(400);
  });

  it("levels are edited only from the Mac", async () => {
    const { send } = setup();
    const res = await send("POST", "/wallet/levels", { symbol: "CRDO", direction: "below", price: 148 }, `https://${TAILNET}`);
    expect(res.status).toBe(403);
  });
});

describe("wallet history routes", () => {
  const historySetup = () => {
    const db = openDb(":memory:");
    const store = createWalletStore(db);
    store.saveSnapshot(parseFlexPositions(readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8")));
    store.saveNav([{ date: "2099-01-01", totalUsd: 1 }], "ibkr");
    const levels = createLevelStore(db);
    levels.create({ symbol: "CSPX", direction: "below", price: 700, kind: "stop", note: null, researchId: null });
    let yahooCalls = 0;
    const fetchFn = (async () => {
      yahooCalls += 1;
      return Response.json({
        chart: { result: [{ meta: { currency: "USD" }, timestamp: [1793030400], indicators: { quote: [{ close: [801] }] } }] },
      });
    }) as typeof fetch;
    const source = createWalletSource({ store, levels, config: null, fetchFn, symbolsFile: null });
    const app = createApp({ tailnetHost: TAILNET, routes: [walletRoutes(source, levels)] });
    const get = (path: string) => app.request(`${LOCAL}/api${path}`, { headers: { origin: LOCAL } });
    return { get, calls: () => yahooCalls };
  };

  it("draws a position with its cost and my levels, asking Yahoo once", async () => {
    const { get, calls } = historySetup();
    const history = (await (await get("/wallet/history/CSPX?range=3m")).json()) as PositionHistory;
    expect(history).toMatchObject({ symbol: "CSPX", currency: "USD", costBasisPrice: 700.25, points: [{ date: "2026-10-26", close: 801 }] });
    expect(history.levels.map((l) => l.kind)).toEqual(["stop"]);
    await get("/wallet/history/CSPX?range=3m");
    expect(calls()).toBe(1);
  });

  it("two charts asking at once share one request to Yahoo", async () => {
    const { get, calls } = historySetup();
    const [a, b] = await Promise.all([get("/wallet/history/CSPX?range=1y"), get("/wallet/history/CSPX?range=1y")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(calls()).toBe(1);
  });

  it("only charts my positions and known ranges", async () => {
    const { get } = historySetup();
    expect((await get("/wallet/history/NOPE")).status).toBe(404);
    expect((await get("/wallet/history/CSPX?range=5y")).status).toBe(400);
    expect((await get("/wallet/history?range=1y")).status).toBe(200);
  });
});
