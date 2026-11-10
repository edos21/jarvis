import { describe, expect, it } from "vitest";

import { openDb } from "../db.js";
import { createAccountStore } from "../google/accounts.js";
import { UnknownTaskAccount } from "../google/tasks.js";
import { TASKS_SCOPE } from "../google/oauth.js";
import { fakeAuth } from "../google/testing.js";
import { createTaskSource } from "./source.js";

type FakeTask = { id: string; title: string; notes?: string; due?: string; status: string };

// Google Tasks with one list, kept in memory: just what the source calls.
const fakeGoogle = () => {
  const tasks = new Map<string, FakeTask>();
  let next = 1;
  let calls = 0;
  let failCreate: (title: string) => boolean = () => false;
  const fetchFn = (async (input: string, init?: RequestInit) => {
    calls += 1;
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body as string) as Partial<FakeTask> & { due?: string | null }) : {};
    if (url.pathname.endsWith("/users/@me/lists")) return Response.json({ items: [{ id: "L1", title: "Mis tareas" }] });
    const [, taskId] = url.pathname.split("/lists/L1/tasks");
    const id = taskId ? decodeURIComponent(taskId.slice(1)) : null;
    if (!id && method === "GET") {
      return Response.json({ items: [...tasks.values()].filter((t) => t.status === "needsAction") });
    }
    if (!id && method === "POST") {
      if (failCreate(body.title ?? "")) return new Response("{}", { status: 503 });
      const task: FakeTask = { id: `t${next++}`, status: "needsAction", title: body.title ?? "", notes: body.notes, due: body.due ?? undefined };
      tasks.set(task.id, task);
      return Response.json(task);
    }
    const task = id ? tasks.get(id) : undefined;
    if (!task) return new Response("{}", { status: 404 });
    if (method === "DELETE") {
      tasks.delete(task.id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      Object.assign(task, body, body.due === null ? { due: undefined } : {});
      return Response.json(task);
    }
    return Response.json(task);
  }) as typeof fetch;
  return {
    tasks,
    fetchFn,
    calls: () => calls,
    complete: (id: string) => {
      const task = tasks.get(id);
      if (task) task.status = "completed";
    },
    failCreates: (fail: (title: string) => boolean) => {
      failCreate = fail;
    },
  };
};

const setup = (day = "2026-11-02") => {
  process.env.TZ = "America/Montevideo";
  const db = openDb(":memory:");
  const accounts = createAccountStore(db);
  accounts.save({ email: "me@gmail.com", kind: "personal", refreshToken: "r", scopes: `email ${TASKS_SCOPE}` });
  const google = fakeGoogle();
  let clock = new Date(`${day}T12:00:00`);
  const source = createTaskSource({ db, auth: fakeAuth(), accounts, fetchFn: google.fetchFn, now: () => clock });
  return {
    source,
    google,
    accounts,
    setDay: (next: string) => {
      clock = new Date(`${next}T12:00:00`);
    },
    // Past the read cache: a task done in Google shows up as done.
    later: () => {
      clock = new Date(clock.getTime() + 6 * 60_000);
    },
  };
};

const due = (day: string) => `${day}T00:00:00.000Z`;
const base = { account: "me@gmail.com", listId: "L1" };

describe("one-off tasks", () => {
  it("creates, renames, postpones from today and deletes", async () => {
    const { source, google } = setup();
    let res = await source.create({ ...base, title: "Pagar UTE", due: "2026-10-20", repeat: null });
    expect(res.tasks).toEqual([expect.objectContaining({ id: "t1", title: "Pagar UTE", due: "2026-10-20", ruleId: null })]);
    await source.update("me@gmail.com", "L1", "t1", { title: "Pagar UTE y OSE" });
    // From today, not from the date it was due: a task late since October lands next week.
    res = await source.postpone("me@gmail.com", "L1", "t1", 7);
    expect(res.tasks[0]).toMatchObject({ title: "Pagar UTE y OSE", due: "2026-11-09" });
    res = await source.remove("me@gmail.com", "L1", "t1", false);
    expect(res.tasks).toEqual([]);
    expect(google.tasks.size).toBe(0);
  });

  it("postponing a future task counts from its own day, never bringing it closer", async () => {
    const { source } = setup();
    await source.create({ ...base, title: "Renovar pasaporte", due: "2026-11-20", repeat: null });
    const res = await source.postpone("me@gmail.com", "L1", "t1", 1);
    expect(res.tasks[0]?.due).toBe("2026-11-21");
  });

  it("an account that is not connected is refused", async () => {
    const { source } = setup();
    await expect(source.create({ ...base, account: "other@gmail.com", title: "x", due: null, repeat: null })).rejects.toBeInstanceOf(
      UnknownTaskAccount,
    );
  });
});

describe("repeating tasks", () => {
  const monthly = { every: 1, unit: "month" } as const;

  it("the first task carries the repetition in its note and the series is listed", async () => {
    const { source, google } = setup();
    const res = await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    expect(google.tasks.get("t1")).toMatchObject({ due: due("2026-11-05"), notes: "↻ Se repite cada mes · Jarvis" });
    expect(res.rules).toEqual([expect.objectContaining({ title: "Pagar alquiler", repeat: monthly, currentDue: "2026-11-05" })]);
    expect(res.tasks[0]?.ruleId).toBe(res.rules[0]?.id);
  });

  it("the tick does nothing while the current task is open", async () => {
    const { source, google } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    await source.tick();
    await source.tick();
    expect(google.tasks.size).toBe(1);
  });

  it("done in Google: the tick creates the next period's task", async () => {
    const { source, google, later } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    google.complete("t1");
    later();
    await source.tick();
    expect(google.tasks.get("t2")).toMatchObject({ title: "Pagar alquiler", due: due("2026-12-05"), status: "needsAction" });
    expect((await source.read()).rules[0]?.currentDue).toBe("2026-12-05");
  });

  it("done late, a postponed one still keeps the series on its days", async () => {
    const { source, google, setDay } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    await source.postpone("me@gmail.com", "L1", "t1", 3);
    setDay("2027-01-10");
    await source.complete("me@gmail.com", "L1", "t1");
    expect(google.tasks.get("t2")?.due).toBe(due("2027-02-05"));
  });

  it("a series started on a past 31st keeps the month's end", async () => {
    const { source, google, later } = setup();
    await source.create({ ...base, title: "Cerrar el mes", due: "2026-10-31", repeat: monthly });
    expect(google.tasks.get("t1")?.due).toBe(due("2026-11-30"));
    google.complete("t1");
    later();
    await source.tick();
    expect(google.tasks.get("t2")?.due).toBe(due("2026-12-31"));
  });

  it("a task postponed past its day: the next one comes after it, and the series shows its real day", async () => {
    const { source, google, setDay } = setup();
    await source.create({ ...base, title: "Regar plantas", due: "2026-11-02", repeat: { every: 1, unit: "week" } });
    await source.update("me@gmail.com", "L1", "t1", { due: "2026-11-17" });
    expect((await source.read()).rules[0]?.currentDue).toBe("2026-11-17");
    setDay("2026-11-05");
    await source.complete("me@gmail.com", "L1", "t1");
    expect(google.tasks.get("t2")?.due).toBe(due("2026-11-23"));
  });

  it("the tick asks Google nothing about a series whose task it already knows is pending", async () => {
    const { source, google } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    await source.read();
    const before = google.calls();
    await source.tick();
    expect(google.calls()).toBe(before);
  });

  it("a series whose account was disconnected waits quietly", async () => {
    const { source, google, accounts } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    google.complete("t1");
    accounts.remove("me@gmail.com");
    source.invalidate();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await source.tick();
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
    expect(google.tasks.size).toBe(1);
  });

  it("deleted in Google: the next one is created, as a skipped period", async () => {
    const { source, google, later } = setup();
    await source.create({ ...base, title: "Regar plantas", due: "2026-11-02", repeat: { every: 3, unit: "day" } });
    google.tasks.delete("t1");
    later();
    await source.tick();
    expect(google.tasks.get("t2")?.due).toBe(due("2026-11-05"));
  });

  it("deleting only this one creates the next; deleting the series stops it", async () => {
    const { source, google } = setup();
    await source.create({ ...base, title: "Regar plantas", due: "2026-11-02", repeat: { every: 1, unit: "day" } });
    let res = await source.remove("me@gmail.com", "L1", "t1", false);
    expect(res.tasks.map((t) => [t.id, t.due])).toEqual([["t2", "2026-11-03"]]);
    res = await source.remove("me@gmail.com", "L1", "t2", true);
    expect(res.rules).toEqual([]);
    await source.tick();
    expect(google.tasks.size).toBe(0);
  });

  it("renaming the current task renames the series", async () => {
    const { source, google, later } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    await source.update("me@gmail.com", "L1", "t1", { title: "Pagar alquiler y gastos comunes" });
    google.complete("t1");
    later();
    await source.tick();
    expect(google.tasks.get("t2")?.title).toBe("Pagar alquiler y gastos comunes");
  });

  it("stopping a series leaves its current task and creates no more", async () => {
    const { source, google, later } = setup();
    const created = await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    const res = await source.stopRule(created.rules[0]?.id ?? 0);
    expect(res?.rules).toEqual([]);
    expect(res?.tasks.map((t) => [t.id, t.ruleId])).toEqual([["t1", null]]);
    google.complete("t1");
    later();
    await source.tick();
    expect(google.tasks.size).toBe(1);
    expect(await source.stopRule(999)).toBeNull();
  });

  it("a series is not saved when its first task could not be created", async () => {
    const { source, google } = setup();
    google.failCreates(() => true);
    await expect(source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly })).rejects.toThrow();
    google.failCreates(() => false);
    expect((await source.read()).rules).toEqual([]);
  });

  it("one series failing does not stop the others", async () => {
    const { source, google, later } = setup();
    await source.create({ ...base, title: "A", due: "2026-11-02", repeat: { every: 1, unit: "day" } });
    await source.create({ ...base, title: "B", due: "2026-11-02", repeat: { every: 1, unit: "day" } });
    google.complete("t1");
    google.complete("t2");
    google.failCreates((title) => title === "A");
    later();
    await source.tick();
    expect([...google.tasks.values()].filter((t) => t.status === "needsAction").map((t) => t.title)).toEqual(["B"]);
    // A's next one is created on a later tick, once Google answers again.
    google.failCreates(() => false);
    await source.tick();
    expect([...google.tasks.values()].filter((t) => t.status === "needsAction").map((t) => t.title).sort()).toEqual(["A", "B"]);
  });

  it("a tick and a click at the same time create the next task once", async () => {
    const { source, google } = setup();
    await source.create({ ...base, title: "Pagar alquiler", due: "2026-11-05", repeat: monthly });
    google.complete("t1");
    await Promise.all([source.tick(), source.complete("me@gmail.com", "L1", "t1"), source.tick()]);
    expect([...google.tasks.values()].filter((t) => t.status === "needsAction")).toHaveLength(1);
  });
});
