import { asc, avg, desc, gte, lt, sql } from "drizzle-orm";

import { MAC_SAMPLE_MINUTES, type MacRange, type MacSample, type MacStatus } from "../../../shared/mac.js";
import type { Db } from "../db.js";
import { macSamples } from "../schema.js";

const KEEP_MS = 30 * 24 * 60 * 60_000;
// Every reading of the Mac is offered (the tick's, and one a minute while its page is open): one is kept per
// interval, so the history has the same density whether or not I was looking. A minute of slack lets the tick's
// reading count even when it lands a little early.
const SAMPLE_EVERY_MS = (MAC_SAMPLE_MINUTES - 1) * 60_000;
const RANGE_MS: Record<MacRange, number> = { "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, "30d": KEEP_MS };

export type MacHistory = {
  // Keeps the reading unless the last one kept is more recent than the interval.
  record(status: MacStatus): void;
  read(range: MacRange): MacSample[];
};

const round = (n: number | string | null): number => Math.round(Number(n ?? 0) * 10) / 10;

export const createMacHistory = (db: Db, now: () => Date = () => new Date()): MacHistory => ({
  record: (status) => {
    const last = db.select({ at: macSamples.at }).from(macSamples).orderBy(desc(macSamples.at)).limit(1).get();
    if (last && Date.parse(status.collectedAt) - Date.parse(last.at) < SAMPLE_EVERY_MS) return;
    db.insert(macSamples)
      .values({ at: status.collectedAt, cpuPct: status.cpuPct, memPct: status.memPct, diskPct: status.diskPct })
      .onConflictDoNothing()
      .run();
    db.delete(macSamples).where(lt(macSamples.at, new Date(now().getTime() - KEEP_MS).toISOString())).run();
  },
  // A day is every sample; a week or a month is one point per hour, so the chart never gets thousands of points.
  read: (range) => {
    const from = new Date(now().getTime() - RANGE_MS[range]).toISOString();
    if (range === "24h") {
      return db
        .select({ at: macSamples.at, cpuPct: macSamples.cpuPct, memPct: macSamples.memPct, diskPct: macSamples.diskPct })
        .from(macSamples)
        .where(gte(macSamples.at, from))
        .orderBy(asc(macSamples.at))
        .all();
    }
    const hour = sql<string>`substr(${macSamples.at}, 1, 13) || ':00:00.000Z'`;
    return db
      .select({ at: hour, cpuPct: avg(macSamples.cpuPct), memPct: avg(macSamples.memPct), diskPct: avg(macSamples.diskPct) })
      .from(macSamples)
      .where(gte(macSamples.at, from))
      .groupBy(hour)
      .orderBy(asc(hour))
      .all()
      .map((r) => ({ at: r.at, cpuPct: round(r.cpuPct), memPct: round(r.memPct), diskPct: round(r.diskPct) }));
  },
});
