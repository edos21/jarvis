import { describe, expect, it } from "vitest";

import type { AgendaResponse } from "../../../shared/calendar.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createAccountStore } from "./accounts.js";
import { createTaskSource } from "../tasks/source.js";
import { agendaRoutes, createAgendaSource } from "./agendaSource.js";
import { TASKS_SCOPE } from "./oauth.js";
import { fakeAuth } from "./testing.js";

const LOCAL = "http://127.0.0.1:4417";

const auth = fakeAuth();

// One overdue task that disappears from the list once Google gets the PATCH.
const setup = (tasksFail = false, extra: unknown[] = []) => {
  let done = false;
  const patches: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(url);
      done = true;
      return Response.json({});
    }
    if (url.includes("tasks.googleapis.com") && tasksFail) return new Response("API disabled", { status: 403 });
    if (url.includes("/users/@me/lists")) return Response.json({ items: [{ id: "L1" }] });
    if (url.includes("/lists/L1/tasks")) {
      return Response.json({ items: [...(done ? [] : [{ id: "t1", title: "Pagar UTE", due: "2026-10-29T00:00:00.000Z" }]), ...extra] });
    }
    return Response.json({ items: [] });
  }) as typeof fetch;
  const db = openDb(":memory:");
  const accounts = createAccountStore(db);
  accounts.save({ email: "me@gmail.com", kind: "personal", refreshToken: "r", scopes: `email ${TASKS_SCOPE}` });
  // Late evening in Uruguay is already the next day in UTC: a due date must still read as the calendar day.
  process.env.TZ = "America/Montevideo";
  const now = () => new Date(2026, 9, 31, 22, 30);
  const tasks = createTaskSource({ db, auth, accounts, fetchFn, now });
  const source = createAgendaSource({ auth, accounts, fetchFn, tasks, now });
  const app = createApp({ tailnetHost: null, routes: [agendaRoutes(source)] });
  return { app, patches };
};

describe("agenda source and task routes", () => {
  it("lists the tasks due by today, oldest first, and leaves future and undated ones out", async () => {
    const day = (d: string) => `${d}T00:00:00.000Z`;
    const { app } = setup(false, [
      { id: "today", title: "Llamar al banco", due: day("2026-10-31") },
      { id: "next", title: "Renovar pasaporte", due: day("2026-11-01") },
      { id: "nodue", title: "Leer libro" },
    ]);
    const agenda = (await (await app.request(`${LOCAL}/api/agenda`)).json()) as AgendaResponse;
    expect(agenda.tasks.map((t) => [t.id, t.due, t.overdue])).toEqual([
      ["t1", "2026-10-29", true],
      ["today", "2026-10-31", false],
    ]);
  });

  it("completing a task patches Google and returns the agenda read again, not the cached one", async () => {
    const { app, patches } = setup();
    const before = (await (await app.request(`${LOCAL}/api/agenda`)).json()) as AgendaResponse;
    expect(before.tasks.map((t) => t.id)).toEqual(["t1"]);
    const res = await app.request(`${LOCAL}/api/tasks/me@gmail.com/L1/t1/complete`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(patches).toEqual(["https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t1"]);
    expect(((await res.json()) as AgendaResponse).tasks).toEqual([]);
  });

  it("an unknown account is a 404", async () => {
    const { app } = setup();
    const res = await app.request(`${LOCAL}/api/tasks/other@gmail.com/L1/t1/complete`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("a failing Tasks API leaves the events working", async () => {
    const { app } = setup(true);
    const res = await app.request(`${LOCAL}/api/agenda`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgendaResponse).tasks).toEqual([]);
  });
});
