import { and, desc, eq } from "drizzle-orm";

import type { ResearchDetail, ResearchKind, ResearchRun, ResearchSubject } from "../../../shared/research.js";
import type { SuggestedLevel } from "../../../shared/wallet.js";
import type { Db } from "../db.js";
import { research } from "../schema.js";

type Row = typeof research.$inferSelect;

const toRun = (row: Row): ResearchRun => ({
  id: row.id,
  kind: row.kind,
  subject: JSON.parse(row.subject) as ResearchSubject,
  title: row.title,
  status: row.status,
  error: row.error,
  costUsd: row.costUsd,
  createdAt: row.createdAt,
  finishedAt: row.finishedAt,
  savedPath: row.savedPath,
});

const toDetail = (row: Row): ResearchDetail => ({
  ...toRun(row),
  markdown: row.markdown,
  jarvisNote: row.jarvisNote,
  // Runs from before levels were suggested have none.
  suggestedLevels: row.suggestedLevels ? (JSON.parse(row.suggestedLevels) as SuggestedLevel[]) : [],
});

export type ResearchStore = {
  create(run: { kind: ResearchKind; subject: ResearchSubject; title: string; createdAt: string }): ResearchRun;
  finish(
    id: number,
    result: {
      markdown: string;
      jarvisNote: string | null;
      suggestedLevels: SuggestedLevel[];
      costUsd: number | null;
      finishedAt: string;
    },
  ): void;
  fail(id: number, error: string, finishedAt: string): void;
  markSaved(id: number, savedPath: string): void;
  get(id: number): ResearchDetail | null;
  list(limit: number): ResearchRun[];
  running(kind: ResearchKind): boolean;
  // Runs left "running" by a restart can never finish.
  failInterrupted(finishedAt: string): void;
};

export const createResearchStore = (db: Db): ResearchStore => ({
  create: ({ kind, subject, title, createdAt }) => {
    const row = db
      .insert(research)
      .values({ kind, subject: JSON.stringify(subject), title, status: "running", createdAt })
      .returning()
      .get();
    return toRun(row);
  },
  finish: (id, { markdown, jarvisNote, suggestedLevels, costUsd, finishedAt }) => {
    db.update(research)
      .set({
        status: "done",
        markdown,
        jarvisNote,
        suggestedLevels: JSON.stringify(suggestedLevels),
        costUsd,
        finishedAt,
      })
      .where(eq(research.id, id))
      .run();
  },
  fail: (id, error, finishedAt) => {
    db.update(research).set({ status: "failed", error, finishedAt }).where(eq(research.id, id)).run();
  },
  markSaved: (id, savedPath) => {
    db.update(research).set({ savedPath }).where(eq(research.id, id)).run();
  },
  get: (id) => {
    const row = db.select().from(research).where(eq(research.id, id)).get();
    return row ? toDetail(row) : null;
  },
  list: (limit) =>
    db
      .select()
      .from(research)
      .orderBy(desc(research.id))
      .limit(limit)
      .all()
      .map(toRun),
  running: (kind) =>
    db
      .select({ id: research.id })
      .from(research)
      .where(and(eq(research.status, "running"), eq(research.kind, kind)))
      .get() !== undefined,
  failInterrupted: (finishedAt) => {
    db.update(research)
      .set({ status: "failed", error: "Jarvis se reinició antes de que terminara.", finishedAt })
      .where(eq(research.status, "running"))
      .run();
  },
});
