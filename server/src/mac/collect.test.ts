import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createMacCollector,
  parseBoottime,
  parseCpuPct,
  parseDisk,
  parseMemPct,
  parseProcesses,
  parseUpdates,
} from "./collect.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parsers", () => {
  it("parses vm_stat into memPct", () => {
    // (active 231363 + wired 249300 + compressor 422445) pages * 16 KiB over 18 GiB
    expect(parseMemPct(fixture("vm_stat.txt"), Number(fixture("memsize.txt")))).toBeCloseTo(76.6, 1);
  });

  it("reads disk from the Data volume", () => {
    expect(parseDisk(fixture("df.txt"))).toEqual({ diskPct: 95, diskFreeGb: 23.4 });
  });

  it("uptimeDays from kern.boottime", () => {
    const now = new Date("2026-10-30T20:49:00Z");
    expect(parseBoottime(fixture("boottime.txt"), now)).toBe(68);
  });

  it("cpu from the second top sample", () => {
    expect(parseCpuPct(fixture("top.txt"))).toBeCloseTo(56.6, 1);
  });

  it("lists pending update titles", () => {
    expect(parseUpdates(fixture("softwareupdate.txt"))).toEqual(["Safari 27.2", "macOS Tahoe 26.7.2", "macOS 27.2"]);
    expect(parseUpdates(fixture("softwareupdate-none.txt"))).toEqual([]);
  });

  it("parses uid and keeps names with spaces", () => {
    const rows = parseProcesses(fixture("ps-stuck.txt"));
    expect(rows.find((r) => r.pid === 700)?.uid).toBe(0);
    expect(rows.find((r) => r.pid === 1024)?.name).toBe(
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer)",
    );
    expect(rows.find((r) => r.pid === 812)?.stat).toBe("U");
  });
});

const runner =
  (outputs: Record<string, string | Error>) =>
  async (cmd: string, args: string[]): Promise<string> => {
    const key = [cmd, ...args].join(" ");
    const match = Object.entries(outputs).find(([prefix]) => key.startsWith(prefix));
    if (!match) throw new Error(`unexpected command ${key}`);
    if (match[1] instanceof Error) throw match[1];
    return match[1];
  };

const baseOutputs = (ps: string, updates: string | Error) => ({
  "sysctl -n kern.boottime": fixture("boottime.txt"),
  "sysctl -n hw.memsize": fixture("memsize.txt"),
  vm_stat: fixture("vm_stat.txt"),
  top: fixture("top.txt"),
  df: fixture("df.txt"),
  ps,
  softwareupdate: updates,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createMacCollector", () => {
  const now = () => new Date("2026-10-30T20:49:00Z");

  it("updates is null when softwareupdate fails", async () => {
    const collector = createMacCollector(runner(baseOutputs(fixture("ps-healthy.txt"), new Error("offline"))), now);
    await collector.collect();
    await flush();
    expect((await collector.collect()).updates).toBeNull();
  });

  it("does not wait for softwareupdate: updates arrive on a later reading", async () => {
    const collector = createMacCollector(runner(baseOutputs(fixture("ps-healthy.txt"), fixture("softwareupdate.txt"))), now);
    expect((await collector.collect()).updates).toBeNull();
    await flush();
    expect((await collector.collect()).updates).toHaveLength(3);
  });

  it("flags Z at once, U and runaway CPU only on the second reading", async () => {
    const collector = createMacCollector(runner(baseOutputs(fixture("ps-stuck.txt"), "")), now, 501);
    const first = await collector.collect();
    expect(first.stuck.map((s) => [s.pid, s.reason])).toEqual([[913, "zombie"]]);
    const second = await collector.collect();
    expect(second.stuck.map((s) => [s.pid, s.reason])).toEqual([
      [812, "uninterruptible"],
      [913, "zombie"],
      [1024, "runaway_cpu"],
    ]);
  });

  it("reads softwareupdate once per 6 hours", async () => {
    let calls = 0;
    const outputs = baseOutputs(fixture("ps-healthy.txt"), "");
    const run = async (cmd: string, args: string[]) => {
      if (cmd === "softwareupdate") calls += 1;
      return runner(outputs)(cmd, args);
    };
    const collector = createMacCollector(run, now);
    await collector.collect();
    await collector.collect();
    expect(calls).toBe(1);
  });
});
