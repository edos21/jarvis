import type { Hono } from "hono";

import type { AgendaItem, AgendaResponse, TaskItem } from "../../../shared/calendar.js";
import { localDate } from "../../../shared/dates.js";
import type { ApiError } from "../app.js";
import type { TaskSource } from "../tasks/source.js";
import type { AccountStore } from "./accounts.js";
import { readAgenda } from "./calendar.js";
import { GoogleAuthExpired, type GoogleAuth } from "./oauth.js";
import { UnknownTaskAccount } from "./tasks.js";

const CACHE_MS = 5 * 60_000;

export type AgendaSource = {
  read(): Promise<AgendaResponse>;
  completeTask(account: string, listId: string, taskId: string): Promise<AgendaResponse>;
  invalidate(): void;
};

export const createAgendaSource = (deps: {
  auth: GoogleAuth | null;
  accounts: AccountStore;
  fetchFn: typeof fetch;
  // The tasks have one owner, which also keeps their series: Today shows the ones due by today.
  tasks: Pick<TaskSource, "read" | "complete">;
  now?: () => Date;
}): AgendaSource => {
  const now = deps.now ?? (() => new Date());
  let cached: { value: { items: AgendaItem[]; reconnect: string[] }; at: number; day: number } | null = null;
  // Bumped by every write: a read that started before it must not put the old agenda back in the cache.
  let generation = 0;
  const invalidate = (): void => {
    generation += 1;
    cached = null;
  };

  const readEvents = async (at: Date): Promise<{ items: AgendaItem[]; reconnect: string[] }> => {
    // A cached agenda is only good for the day it was read.
    if (cached && at.getTime() - cached.at < CACHE_MS && cached.day === at.getDate()) return cached.value;
    const accounts = deps.accounts.list().filter((a) => a.kind === "personal");
    if (!deps.auth || accounts.length === 0) return { items: [], reconnect: [] };
    const started = generation;
    const value = await readAgenda(accounts, deps.auth, deps.fetchFn, at);
    if (started === generation) cached = { value, at: at.getTime(), day: at.getDate() };
    return value;
  };

  // Tasks ride along with the events: if Tasks fails (API off, a hiccup) the day's events still show.
  const readDueTasks = async (at: Date): Promise<{ tasks: TaskItem[]; reconnect: string[] }> => {
    const today = localDate(at);
    try {
      const { tasks, reconnect } = await deps.tasks.read();
      const due = tasks.flatMap((t): TaskItem[] => (t.due && t.due <= today ? [{ ...t, due: t.due, overdue: t.due < today }] : []));
      return { tasks: due.sort((a, b) => a.due.localeCompare(b.due)), reconnect };
    } catch (error) {
      console.error(`google tasks failed: ${error instanceof Error ? error.message : String(error)}`);
      return { tasks: [], reconnect: [] };
    }
  };

  const read = async (): Promise<AgendaResponse> => {
    const at = now();
    const [events, tasks] = await Promise.all([readEvents(at), readDueTasks(at)]);
    return { items: events.items, tasks: tasks.tasks, reconnect: [...new Set([...events.reconnect, ...tasks.reconnect])] };
  };

  return {
    read,
    completeTask: async (email, listId, taskId) => {
      await deps.tasks.complete(email, listId, taskId);
      return read();
    },
    invalidate,
  };
};

export const agendaRoutes =
  (source: AgendaSource) =>
  (app: Hono): void => {
    app.get("/agenda", async (c) => c.json<AgendaResponse>(await source.read()));

    // Allowed from the phone too: completing a task is undone from Google Tasks in one click.
    app.post("/tasks/:account/:listId/:taskId/complete", async (c) => {
      try {
        const { account, listId, taskId } = c.req.param();
        return c.json<AgendaResponse>(await source.completeTask(account, listId, taskId));
      } catch (error) {
        if (error instanceof UnknownTaskAccount) return c.json<ApiError>({ error: "Esa cuenta no está conectada." }, 404);
        if (error instanceof GoogleAuthExpired) {
          return c.json<ApiError>({ error: "Jarvis perdió el acceso. Reconecta tu Google." }, 409);
        }
        throw error;
      }
    });
  };
