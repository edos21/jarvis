import { and, eq } from "drizzle-orm";

import { addDays, localDate } from "../../../shared/dates.js";
import {
  type PostponeDays,
  type Repeat,
  type TaskCreate,
  type TaskRule,
  type TaskUpdate,
  type TasksResponse,
  repeatLabel,
} from "../../../shared/tasks.js";
import type { Db } from "../db.js";
import type { AccountStore, StoredAccount } from "../google/accounts.js";
import type { GoogleAuth } from "../google/oauth.js";
import {
  UnknownTaskAccount,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  readAllTasks,
  updateTask,
} from "../google/tasks.js";
import { taskRules } from "../schema.js";
import { nextDue } from "./schedule.js";

const CACHE_MS = 5 * 60_000;

type RuleRow = typeof taskRules.$inferSelect;

const repeatOf = (rule: Pick<RuleRow, "every" | "unit">): Repeat => ({ every: rule.every, unit: rule.unit });

export type TaskSource = {
  read(): Promise<TasksResponse>;
  create(input: TaskCreate): Promise<TasksResponse>;
  update(account: string, listId: string, taskId: string, change: TaskUpdate): Promise<TasksResponse>;
  postpone(account: string, listId: string, taskId: string, days: PostponeDays): Promise<TasksResponse>;
  // series: the repetition stops too; otherwise only this one goes and the next is created.
  remove(account: string, listId: string, taskId: string, series: boolean): Promise<TasksResponse>;
  // Stops repeating and leaves the current task in Google; null when there is no such rule.
  stopRule(id: number): Promise<TasksResponse | null>;
  // Marks it done; a task of a series gets its next one now instead of on the next tick.
  complete(account: string, listId: string, taskId: string): Promise<void>;
  // The server's periodic tick: every series whose current task is done (or gone) gets its next one.
  tick(): Promise<void>;
  // A Google account was connected or removed: the tasks are read again.
  invalidate(): void;
};

export const createTaskSource = (deps: {
  db: Db;
  auth: GoogleAuth | null;
  accounts: AccountStore;
  fetchFn: typeof fetch;
  now?: () => Date;
}): TaskSource => {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  let cached: { value: TasksResponse; at: number } | null = null;
  // Bumped by every write: a read that started before it must not put the old tasks back in the cache.
  let generation = 0;
  const changed = (): void => {
    generation += 1;
    cached = null;
  };

  const today = (): string => localDate(now());

  const personal = (email: string): { account: StoredAccount; auth: GoogleAuth } => {
    const account = deps.accounts.get(email);
    if (!deps.auth || account?.kind !== "personal") throw new UnknownTaskAccount();
    return { account, auth: deps.auth };
  };

  const activeRules = (only?: number): RuleRow[] =>
    db
      .select()
      .from(taskRules)
      .where(only === undefined ? eq(taskRules.active, true) : and(eq(taskRules.active, true), eq(taskRules.id, only)))
      .all();
  const ruleByTask = (taskId: string): RuleRow | undefined =>
    db
      .select()
      .from(taskRules)
      .where(and(eq(taskRules.active, true), eq(taskRules.currentTaskId, taskId)))
      .get();

  const deactivate = (id: number): boolean =>
    db.update(taskRules).set({ active: false }).where(eq(taskRules.id, id)).run().changes > 0;

  const noteFor = (repeat: Repeat): string => `↻ Se repite ${repeatLabel(repeat)} · Jarvis`;

  // Creating a series' next task is never done twice at once: the tick and a click could both find it done.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  // open: task ids known to be pending, so their series need no question to Google.
  const advance = async (rule: RuleRow, open: Set<string> | null): Promise<boolean> => {
    if (rule.currentTaskId && open?.has(rule.currentTaskId)) return false;
    const { account, auth } = personal(rule.account);
    // A task postponed past its planned day: the next one comes after the day it really had, not before.
    let after = rule.currentDue;
    if (rule.currentTaskId) {
      const state = await getTask(account, auth, deps.fetchFn, rule.listId, rule.currentTaskId);
      if (state && !state.done && !state.deleted) return false;
      if (state?.due && (!after || state.due > after)) after = state.due;
    }
    const repeat = repeatOf(rule);
    const due = nextDue(rule.anchorDue, repeat, after, today());
    const { id } = await createTask(account, auth, deps.fetchFn, rule.listId, { title: rule.title, due, notes: noteFor(repeat) });
    db.update(taskRules).set({ currentTaskId: id, currentDue: due }).where(eq(taskRules.id, rule.id)).run();
    return true;
  };

  // One series failing (its account lost access, Google hiccuped) never holds up the others. The rules are read
  // inside the queue: a run waiting behind another must see the task that one just created.
  const advanceAll = (only?: number, open: Set<string> | null = null): Promise<void> =>
    serial(async () => {
      let created = false;
      for (const rule of activeRules(only)) {
        try {
          created = (await advance(rule, open)) || created;
        } catch (error) {
          // A series whose account was disconnected waits, quietly, until it is connected again or stopped.
          if (error instanceof UnknownTaskAccount) continue;
          console.error(`task rule ${rule.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (created) changed();
    });

  const read = async (): Promise<TasksResponse> => {
    if (cached && now().getTime() - cached.at < CACHE_MS) return cached.value;
    const rules = activeRules();
    const ruleIds = new Map(rules.flatMap((r) => (r.currentTaskId ? [[r.currentTaskId, r.id] as const] : [])));
    const accounts = deps.accounts.list().filter((a) => a.kind === "personal");
    const started = generation;
    const found =
      deps.auth && accounts.length > 0
        ? await readAllTasks(accounts, deps.auth, deps.fetchFn)
        : { lists: [], tasks: [], reconnect: [] };
    // A postponed task is due on its own day, not the series' planned one.
    const dueOf = new Map(found.tasks.map((t) => [t.id, t.due]));
    const value: TasksResponse = {
      ...found,
      tasks: found.tasks.map((t) => ({ ...t, ruleId: ruleIds.get(t.id) ?? null })),
      rules: rules.map(
        (r): TaskRule => ({
          id: r.id,
          account: r.account,
          listId: r.listId,
          title: r.title,
          repeat: repeatOf(r),
          currentDue: (r.currentTaskId ? dueOf.get(r.currentTaskId) : undefined) ?? r.currentDue,
        }),
      ),
    };
    if (started === generation) cached = { value, at: now().getTime() };
    return value;
  };

  // Every write ends with the tasks read again, so the page shows what Google has now.
  const write = async (work: () => Promise<void>): Promise<TasksResponse> => {
    try {
      await work();
    } finally {
      changed();
    }
    return read();
  };

  return {
    read,

    create: (input) =>
      write(async () => {
        const { account, auth } = personal(input.account);
        if (!input.repeat) {
          await createTask(account, auth, deps.fetchFn, input.listId, { title: input.title, due: input.due });
          return;
        }
        const repeat = input.repeat;
        // The task goes to Google first: a series is saved only once its first task exists.
        await serial(async () => {
          // The day I chose anchors the series, even when it is past: a series on the 31st keeps the month's end.
          const anchor = input.due ?? today();
          const due = nextDue(anchor, repeat, null, today());
          const { id } = await createTask(account, auth, deps.fetchFn, input.listId, {
            title: input.title,
            due,
            notes: noteFor(repeat),
          });
          db.insert(taskRules)
            .values({
              account: input.account,
              listId: input.listId,
              title: input.title,
              every: repeat.every,
              unit: repeat.unit,
              anchorDue: anchor,
              currentTaskId: id,
              currentDue: due,
            })
            .run();
        });
      }),

    update: (email, listId, taskId, change) =>
      write(async () => {
        const { account, auth } = personal(email);
        await updateTask(account, auth, deps.fetchFn, listId, taskId, change);
        // A new name is the series' name from now on; a new date moves only this one.
        const rule = ruleByTask(taskId);
        if (rule && change.title !== undefined) {
          db.update(taskRules).set({ title: change.title }).where(eq(taskRules.id, rule.id)).run();
        }
      }),

    // Counted from today for a late task, from its own day for a future one: postponing never brings it closer.
    postpone: (email, listId, taskId, days) =>
      write(async () => {
        const { account, auth } = personal(email);
        const current = (await getTask(account, auth, deps.fetchFn, listId, taskId))?.due ?? null;
        const from = current && current > today() ? new Date(`${current}T12:00:00`) : now();
        await updateTask(account, auth, deps.fetchFn, listId, taskId, { due: addDays(from, days) });
      }),

    remove: (email, listId, taskId, series) =>
      write(async () => {
        const { account, auth } = personal(email);
        const rule = ruleByTask(taskId);
        await deleteTask(account, auth, deps.fetchFn, listId, taskId);
        if (!rule) return;
        if (series) deactivate(rule.id);
        else await advanceAll(rule.id);
      }),

    stopRule: async (id) => {
      if (!deactivate(id)) return null;
      changed();
      return read();
    },

    complete: async (email, listId, taskId) => {
      const { account, auth } = personal(email);
      try {
        await completeTask(account, auth, deps.fetchFn, listId, taskId);
      } finally {
        changed();
      }
      // advanceAll logs its own failures: a series that could not get its next one now gets it on the next tick.
      const rule = ruleByTask(taskId);
      if (rule) await advanceAll(rule.id);
    },

    // A series whose task the cached read still lists as pending needs no question to Google; a fresh read would
    // cost more than the questions it saves, so an empty cache means every series asks about its own.
    tick: () => {
      const fresh = cached && now().getTime() - cached.at < CACHE_MS ? cached.value : null;
      return advanceAll(undefined, fresh ? new Set(fresh.tasks.map((t) => t.id)) : null);
    },

    invalidate: changed,
  };
};
