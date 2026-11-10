import { describe, expect, it } from "vitest";

import type { MacStatus } from "../../../shared/mac.js";
import { openDb } from "../db.js";
import { createMacHistory } from "./history.js";

const status = (at: string, cpuPct: number): MacStatus => ({
  cpuPct,
  memPct: 50,
  diskPct: 70,
  diskFreeGb: 100,
  uptimeDays: 1,
  updates: [],
  stuck: [],
  collectedAt: at,
});

describe("mac history", () => {
  it("keeps every sample of the last day and forgets those older than 30 days", () => {
    let clock = new Date("2026-10-01T10:00:00.000Z");
    const history = createMacHistory(openDb(":memory:"), () => clock);
    history.record(status("2026-10-01T10:00:00.000Z", 5));
    clock = new Date("2026-11-01T10:00:00.000Z");
    history.record(status("2026-11-01T09:50:00.000Z", 20));
    history.record(status("2026-11-01T09:50:00.000Z", 99));
    history.record(status("2026-11-01T10:00:00.000Z", 40));
    expect(history.read("24h").map((s) => [s.at, s.cpuPct])).toEqual([
      ["2026-11-01T09:50:00.000Z", 20],
      ["2026-11-01T10:00:00.000Z", 40],
    ]);
    expect(history.read("30d").map((s) => s.at)).not.toContain("2026-10-01T10:00:00.000Z");
  });

  it("a week or a month is one averaged point per hour", () => {
    const clock = new Date("2026-11-01T12:00:00.000Z");
    const history = createMacHistory(openDb(":memory:"), () => clock);
    history.record(status("2026-11-01T10:10:00.000Z", 10));
    history.record(status("2026-11-01T10:20:00.000Z", 21));
    history.record(status("2026-11-01T11:00:00.000Z", 50));
    expect(history.read("7d")).toEqual([
      { at: "2026-11-01T10:00:00.000Z", cpuPct: 15.5, memPct: 50, diskPct: 70 },
      { at: "2026-11-01T11:00:00.000Z", cpuPct: 50, memPct: 50, diskPct: 70 },
    ]);
  });

  it("keeps one reading per interval, however often the Mac is read", () => {
    const history = createMacHistory(openDb(":memory:"), () => new Date("2026-11-01T12:00:00.000Z"));
    for (const at of ["2026-11-01T10:00:00.000Z", "2026-11-01T10:01:00.000Z", "2026-11-01T10:05:00.000Z", "2026-11-01T10:10:00.000Z"]) {
      history.record(status(at, 10));
    }
    expect(history.read("24h").map((s) => s.at)).toEqual(["2026-11-01T10:00:00.000Z", "2026-11-01T10:10:00.000Z"]);
  });
});
