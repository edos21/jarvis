import { describe, expect, it } from "vitest";

import { TASKS_SCOPE } from "./oauth.js";
import { fakeAuth } from "./testing.js";
import { completeTask, createTask, deleteTask, getTask, readAllTasks, updateTask } from "./tasks.js";

const auth = fakeAuth();

const due = (date: string) => `${date}T00:00:00.000Z`;

const calls: { url: string; method: string; body: string | null }[] = [];
const fetchFn = (async (url: string, init?: RequestInit) => {
  calls.push({ url, method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null });
  if (url.endsWith("/users/@me/lists?maxResults=100")) {
    return Response.json({ items: [{ id: "L1", title: "Mis tareas" }] });
  }
  if (url.includes("/lists/L1/tasks?") && !url.includes("pageToken")) {
    return Response.json({
      nextPageToken: "p2",
      items: [
        { id: "late", title: "Pagar UTE", status: "needsAction", due: due("2026-10-29"), webViewLink: "https://tasks.google.com/task/late" },
        { id: "today", title: "Llamar al banco", status: "needsAction", due: due("2026-10-31") },
        { id: "next", title: "Renovar pasaporte", status: "needsAction", due: due("2026-11-02") },
        { id: "nodue", title: "Leer libro", status: "needsAction" },
      ],
    });
  }
  if (url.includes("pageToken=p2")) {
    return Response.json({ items: [{ id: "page2", title: "Renovar cédula", status: "needsAction", due: due("2026-10-30") }] });
  }
  return Response.json({ id: "late", status: "completed" });
}) as typeof fetch;

const account = { email: "me@gmail.com", refreshToken: "r", scopes: `email ${TASKS_SCOPE}` };

describe("reading tasks", () => {
  it("an account connected before Tasks asks to reconnect without calling Google", async () => {
    calls.length = 0;
    const { tasks, reconnect } = await readAllTasks([{ ...account, scopes: "email" }], auth, fetchFn);
    expect(tasks).toEqual([]);
    expect(reconnect).toEqual(["me@gmail.com"]);
    expect(calls).toEqual([]);
  });
});

describe("completeTask", () => {
  it("patches only the status to completed", async () => {
    calls.length = 0;
    await completeTask(account, auth, fetchFn, "L1", "late");
    expect(calls).toEqual([
      {
        url: "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/late",
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      },
    ]);
  });
});

describe("readAllTasks", () => {
  it("returns every pending task, future and undated included, with its list", async () => {
    calls.length = 0;
    const { lists, tasks } = await readAllTasks([account], auth, fetchFn);
    expect(lists).toEqual([{ account: "me@gmail.com", id: "L1", title: "Mis tareas" }]);
    expect(tasks.map((t) => [t.id, t.due])).toEqual([
      ["late", "2026-10-29"],
      ["today", "2026-10-31"],
      ["next", "2026-11-02"],
      ["nodue", null],
      ["page2", "2026-10-30"],
    ]);
    expect(tasks[0]).toMatchObject({ listId: "L1", account: "me@gmail.com", url: "https://tasks.google.com/task/late" });
    const listCall = new URL(calls.find((c) => c.url.includes("/lists/L1/tasks?"))?.url ?? "");
    expect(listCall.searchParams.get("showCompleted")).toBe("false");
  });
});

describe("task writes", () => {
  const record = (answer: Response) => {
    const seen: { url: string; method: string; body: string | null }[] = [];
    const fn = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null });
      return answer.clone();
    }) as typeof fetch;
    return { seen, fn };
  };

  it("creates a task with the due day at midnight UTC", async () => {
    const { seen, fn } = record(Response.json({ id: "new" }));
    expect(await createTask(account, auth, fn, "L1", { title: "Pagar UTE", due: "2026-11-05", notes: "nota" })).toEqual({ id: "new" });
    expect(seen.map((c) => [c.url, c.method])).toEqual([["https://tasks.googleapis.com/tasks/v1/lists/L1/tasks", "POST"]]);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ title: "Pagar UTE", notes: "nota", due: "2026-11-05T00:00:00.000Z" });
  });

  it("patches only the fields given, and null clears the date", async () => {
    const { seen, fn } = record(Response.json({}));
    await updateTask(account, auth, fn, "L1", "t 1", { due: null });
    expect(seen[0]).toEqual({
      url: "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t%201",
      method: "PATCH",
      body: JSON.stringify({ due: null }),
    });
  });

  it("deletes with no body", async () => {
    const { seen, fn } = record(new Response(null, { status: 204 }));
    await deleteTask(account, auth, fn, "L1", "late");
    expect(seen).toEqual([{ url: "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/late", method: "DELETE", body: null }]);
  });

  it("reads a task's state, and null once Google no longer has it", async () => {
    const done = record(Response.json({ id: "a", status: "completed", due: due("2026-11-01") }));
    expect(await getTask(account, auth, done.fn, "L1", "a")).toEqual({ done: true, deleted: false, due: "2026-11-01" });
    const gone = record(new Response("{}", { status: 404 }));
    expect(await getTask(account, auth, gone.fn, "L1", "a")).toBeNull();
    const failing = record(new Response("{}", { status: 500 }));
    await expect(getTask(account, auth, failing.fn, "L1", "a")).rejects.toThrow("500");
  });
});
