import type { Context, Hono } from "hono";

import {
  type Repeat,
  type TaskCreate,
  type TaskUpdate,
  type TasksResponse,
  isPostponeDays,
  isRepeatUnit,
} from "../../../shared/tasks.js";
import { type ApiError, isRemote } from "../app.js";
import { UnknownTaskAccount } from "../google/tasks.js";
import { GoogleAuthExpired } from "../google/oauth.js";
import type { TaskSource } from "./source.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;
// Google Tasks has no trash: deleting stays with the Mac, like closing a process.
const MAC_ONLY = "Borrar tareas solo desde la Mac.";

type Body = Record<string, unknown>;

const title = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TITLE ? trimmed : null;
};

// undefined: not given; null: no date. A day that is not a real calendar day is refused.
const due = (value: unknown): string | null | undefined | false => {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !DAY.test(value)) return false;
  // A real calendar day in a plausible range: a date field mid-typing can send year 0002.
  const date = new Date(`${value}T00:00:00Z`);
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100 && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : false;
};

const repeat = (value: unknown): Repeat | null | false => {
  if (value === undefined || value === null) return null;
  const { every, unit } = value as Body;
  if (!Number.isInteger(every) || (every as number) < 1 || (every as number) > 365 || !isRepeatUnit(unit)) return false;
  return { every: every as number, unit };
};

export const parseTaskCreate = (body: Body | null): TaskCreate | null => {
  if (!body || typeof body.account !== "string" || typeof body.listId !== "string") return null;
  const name = title(body.title);
  const day = due(body.due);
  const rule = repeat(body.repeat);
  if (!name || day === false || rule === false) return null;
  return { account: body.account, listId: body.listId, title: name, due: day ?? null, repeat: rule };
};

export const parseTaskUpdate = (body: Body | null): TaskUpdate | null => {
  if (!body) return null;
  const day = due(body.due);
  const name = body.title === undefined ? undefined : title(body.title);
  if (name === null || day === false || (name === undefined && day === undefined)) return null;
  return { ...(name !== undefined ? { title: name } : {}), ...(day !== undefined ? { due: day } : {}) };
};

const body = async (c: Context): Promise<Body | null> => c.req.json<Body>().catch(() => null);

// Google's own failures become an answer the page can show; anything else is a real error.
const guarded = async (c: Context, work: () => Promise<TasksResponse>) => {
  try {
    return c.json<TasksResponse>(await work());
  } catch (error) {
    if (error instanceof UnknownTaskAccount) return c.json<ApiError>({ error: "Esa cuenta no está conectada." }, 404);
    if (error instanceof GoogleAuthExpired) {
      return c.json<ApiError>({ error: "Jarvis perdió el acceso. Reconecta tu Google." }, 409);
    }
    throw error;
  }
};

export const taskRoutes =
  (source: TaskSource) =>
  (app: Hono): void => {
    app.get("/tasks", (c) => guarded(c, () => source.read()));

    app.post("/tasks", async (c) => {
      const input = parseTaskCreate(await body(c));
      if (!input) return c.json<ApiError>({ error: "Falta el título, o la fecha o la repetición no son válidas." }, 400);
      return guarded(c, () => source.create(input));
    });

    app.delete("/tasks/rules/:id", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      const res = await source.stopRule(Number(c.req.param("id")));
      return res ? c.json<TasksResponse>(res) : c.json<ApiError>({ error: "Esa repetición ya no existe." }, 404);
    });

    app.patch("/tasks/:account/:listId/:taskId", async (c) => {
      const change = parseTaskUpdate(await body(c));
      if (!change) return c.json<ApiError>({ error: "El título o la fecha no son válidos." }, 400);
      const { account, listId, taskId } = c.req.param();
      return guarded(c, () => source.update(account, listId, taskId, change));
    });

    app.post("/tasks/:account/:listId/:taskId/postpone", async (c) => {
      const days = (await body(c))?.days;
      if (!isPostponeDays(days)) return c.json<ApiError>({ error: "Solo se pospone 1, 3, 7 o 15 días." }, 400);
      const { account, listId, taskId } = c.req.param();
      return guarded(c, () => source.postpone(account, listId, taskId, days));
    });

    app.delete("/tasks/:account/:listId/:taskId", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      const { account, listId, taskId } = c.req.param();
      return guarded(c, () => source.remove(account, listId, taskId, c.req.query("series") === "true"));
    });
  };
