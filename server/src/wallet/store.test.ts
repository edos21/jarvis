import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { openDb } from "../db.js";
import { parseFlexPositions } from "./flex.js";
import { createWalletStore } from "./store.js";

const snapshot = parseFlexPositions(readFileSync(new URL("./fixtures/flex-statement.xml", import.meta.url), "utf8"));

describe("wallet store", () => {
  it("has no snapshot until the first Flex read", () => {
    expect(createWalletStore(openDb(":memory:")).latestSnapshot()).toBeNull();
  });

  it("a new snapshot replaces the previous one, so a sold position is gone", () => {
    const store = createWalletStore(openDb(":memory:"));
    store.saveSnapshot(snapshot);
    store.saveSnapshot({ ...snapshot, reportDate: "2026-10-31", positions: snapshot.positions.slice(0, 1) });
    const latest = store.latestSnapshot();
    expect(latest?.reportDate).toBe("2026-10-31");
    expect(latest?.positions.map((p) => p.symbol)).toEqual(["CSPX"]);
    expect(latest?.cash).toHaveLength(2);
  });

  it("meta values can be set and cleared", () => {
    const store = createWalletStore(openDb(":memory:"));
    store.setMeta("lastFlexError", "token");
    expect(store.meta("lastFlexError")).toBe("token");
    store.setMeta("lastFlexError", null);
    expect(store.meta("lastFlexError")).toBeNull();
  });

  it("keeps IBKR's close over my own value of the same day, never the other way around", () => {
    const store = createWalletStore(openDb(":memory:"));
    store.saveNav([{ date: "2026-10-30", totalUsd: 100 }, { date: "2026-10-31", totalUsd: 110 }], "live");
    store.saveNav([{ date: "2026-10-30", totalUsd: 101 }], "ibkr");
    store.saveNav([{ date: "2026-10-30", totalUsd: 999 }, { date: "2026-10-31", totalUsd: 111 }], "live");
    expect(store.nav("2026-10-01")).toEqual([
      { date: "2026-10-30", totalUsd: 101 },
      { date: "2026-10-31", totalUsd: 111 },
    ]);
    expect(store.nav("2026-10-31")).toEqual([{ date: "2026-10-31", totalUsd: 111 }]);
  });

  it("drops my value of a day IBKR has no close for, once a later close arrives", () => {
    const store = createWalletStore(openDb(":memory:"));
    store.saveNav([{ date: "2026-11-26", totalUsd: 100 }, { date: "2026-11-28", totalUsd: 102 }], "live");
    store.saveNav([{ date: "2026-11-25", totalUsd: 99 }, { date: "2026-11-27", totalUsd: 101 }], "ibkr");
    expect(store.nav("2026-11-01").map((p) => p.date)).toEqual(["2026-11-25", "2026-11-27", "2026-11-28"]);
  });
});
