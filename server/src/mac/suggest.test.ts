import { describe, expect, it } from "vitest";

import type { MacStatus } from "../../../shared/mac.js";
import { suggestForMac } from "./suggest.js";

const healthy: MacStatus = {
  cpuPct: 20,
  memPct: 60,
  diskPct: 50,
  diskFreeGb: 200,
  uptimeDays: 2,
  updates: [],
  stuck: [],
  collectedAt: "2026-10-30T12:00:00Z",
};

const severityOf = (status: Partial<MacStatus>, key: string) =>
  suggestForMac({ ...healthy, ...status }).find((s) => s.key === key)?.severity;

describe("suggestForMac", () => {
  it("no suggestions for a healthy mac", () => {
    expect(suggestForMac(healthy)).toEqual([]);
  });

  it("uptime 7 → warning, 21 → critical", () => {
    expect(severityOf({ uptimeDays: 6 }, "uptime")).toBeUndefined();
    expect(severityOf({ uptimeDays: 7 }, "uptime")).toBe("warning");
    expect(severityOf({ uptimeDays: 21 }, "uptime")).toBe("critical");
  });

  it("disk 85 → warning, 95 → critical", () => {
    expect(severityOf({ diskPct: 84 }, "disk")).toBeUndefined();
    expect(severityOf({ diskPct: 85 }, "disk")).toBe("warning");
    expect(severityOf({ diskPct: 95 }, "disk")).toBe("critical");
  });

  it("memory 90 → warning with Activity Monitor", () => {
    const [memory] = suggestForMac({ ...healthy, memPct: 92 });
    expect(memory).toMatchObject({ key: "memory", severity: "warning", cta: { kind: "open_app" } });
  });

  it("pending updates open Software Update", () => {
    const [update] = suggestForMac({ ...healthy, updates: ["macOS 27.2"] });
    expect(update).toMatchObject({ key: "updates", severity: "info", cta: { kind: "open_url" } });
  });

  it("a stuck process offers to kill it", () => {
    const [stuck] = suggestForMac({
      ...healthy,
      stuck: [{ pid: 812, name: "/usr/libexec/backupd", reason: "uninterruptible", cpuPct: 0 }],
    });
    expect(stuck).toMatchObject({ key: "stuck:812", severity: "warning", cta: { kind: "kill", pid: 812 } });
    expect(stuck?.title).toContain("backupd");
  });

  it("orders critical first", () => {
    const keys = suggestForMac({ ...healthy, updates: ["x"], diskPct: 96 }).map((s) => s.key);
    expect(keys).toEqual(["disk", "updates"]);
  });
});

describe("zombies", () => {
  it("are not suggested", () => {
    const zombie = { pid: 9, name: "<defunct>", reason: "zombie" as const, cpuPct: 0 };
    expect(suggestForMac({ ...healthy, stuck: [zombie] })).toEqual([]);
  });
});
