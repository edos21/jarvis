import { eq } from "drizzle-orm";

import type { Db } from "../db.js";
import { appMeta } from "../schema.js";

// Kept by day, not by text: the briefing is rewritten whenever the day's data changes, and a rewrite is not a reason
// to put it back in front of me.
const KEY = "briefing_seen_on";

export type BriefingSeenStore = {
  seenOn(): string | null;
  markSeen(day: string): void;
};

export const createBriefingSeenStore = (db: Db): BriefingSeenStore => ({
  seenOn: () => db.select().from(appMeta).where(eq(appMeta.key, KEY)).get()?.value ?? null,
  markSeen: (day) => {
    db.insert(appMeta).values({ key: KEY, value: day }).onConflictDoUpdate({ target: appMeta.key, set: { value: day } }).run();
  },
});
