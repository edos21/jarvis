import { describe, expect, it } from "vitest";

import type { TasksResponse } from "../../../shared/tasks.js";
import { createApp } from "../app.js";
import { UnknownTaskAccount } from "../google/tasks.js";
import { GoogleAuthExpired } from "../google/oauth.js";
import { parseTaskCreate, parseTaskUpdate, taskRoutes } from "./routes.js";
import type { TaskSource } from "./source.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";
const empty: TasksResponse = { lists: [], tasks: [], rules: [], reconnect: [] };

const setup = (fail?: Error) => {
  const calls: string[] = [];
  const done = (call: string) => async () => {
    calls.push(call);
    if (fail) throw fail;
    return empty;
  };
  const source: TaskSource = {
    read: done("read"),
    create: async (input) => done(`create ${JSON.stringify(input)}`)(),
    update: async (_a, _l, id, change) => done(`update ${id} ${JSON.stringify(change)}`)(),
    postpone: async (_a, _l, id, days) => done(`postpone ${id} ${days}`)(),
    remove: async (_a, _l, id, series) => done(`remove ${id} ${series}`)(),
    stopRule: async (id) => (id === 1 ? done("stop 1")() : null),
    complete: async () => undefined,
    tick: async () => undefined,
    invalidate: () => undefined,
  };
  const app = createApp({ tailnetHost: TAILNET, routes: [taskRoutes(source)] });
  const call = (host: string, method: string, path: string, body?: unknown) =>
    app.request(`${host}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { calls, call };
};

describe("parseTaskCreate", () => {
  const base = { account: "me@gmail.com", listId: "L1", title: "  Pagar UTE  " };

  it("trims the title and takes a date and a repetition", () => {
    expect(parseTaskCreate({ ...base, due: "2026-11-05", repeat: { every: 2, unit: "week" } })).toEqual({
      account: "me@gmail.com",
      listId: "L1",
      title: "Pagar UTE",
      due: "2026-11-05",
      repeat: { every: 2, unit: "week" },
    });
    expect(parseTaskCreate(base)).toMatchObject({ due: null, repeat: null });
  });

  it("refuses an empty title, an impossible day and a bad repetition", () => {
    expect(parseTaskCreate({ ...base, title: "   " })).toBeNull();
    expect(parseTaskCreate({ ...base, due: "2026-02-30" })).toBeNull();
    expect(parseTaskCreate({ ...base, due: "mañana" })).toBeNull();
    expect(parseTaskCreate({ ...base, repeat: { every: 0, unit: "day" } })).toBeNull();
    expect(parseTaskCreate({ ...base, repeat: { every: 1, unit: "hour" } })).toBeNull();
    expect(parseTaskCreate({ ...base, title: "x".repeat(201) })).toBeNull();
  });
});

describe("parseTaskUpdate", () => {
  it("takes a title, a date or a cleared date, and refuses nothing to change", () => {
    expect(parseTaskUpdate({ title: "Nuevo" })).toEqual({ title: "Nuevo" });
    expect(parseTaskUpdate({ due: null })).toEqual({ due: null });
    expect(parseTaskUpdate({})).toBeNull();
    expect(parseTaskUpdate({ title: "" })).toBeNull();
  });
});

describe("task routes", () => {
  it("creating and postponing work from the phone; deleting does not", async () => {
    const { calls, call } = setup();
    const phone = `https://${TAILNET}`;
    expect((await call(phone, "POST", "/tasks", { account: "a", listId: "L1", title: "x" })).status).toBe(200);
    expect((await call(phone, "POST", "/tasks/a/L1/t1/postpone", { days: 3 })).status).toBe(200);
    expect((await call(phone, "DELETE", "/tasks/a/L1/t1")).status).toBe(403);
    expect((await call(phone, "DELETE", "/tasks/rules/1")).status).toBe(403);
    expect(calls).toEqual([expect.stringMatching(/^create /), "postpone t1 3"]);
  });

  it("deleting from the Mac, the series only when asked", async () => {
    const { calls, call } = setup();
    await call(LOCAL, "DELETE", "/tasks/a/L1/t1");
    await call(LOCAL, "DELETE", "/tasks/a/L1/t2?series=true");
    expect(calls).toEqual(["remove t1 false", "remove t2 true"]);
    expect((await call(LOCAL, "DELETE", "/tasks/rules/1")).status).toBe(200);
    expect((await call(LOCAL, "DELETE", "/tasks/rules/9")).status).toBe(404);
  });

  it("refuses a bad body before reaching Google", async () => {
    const { calls, call } = setup();
    expect((await call(LOCAL, "POST", "/tasks", { account: "a", listId: "L1", title: "" })).status).toBe(400);
    expect((await call(LOCAL, "POST", "/tasks/a/L1/t1/postpone", { days: 2 })).status).toBe(400);
    expect((await call(LOCAL, "PATCH", "/tasks/a/L1/t1", { due: "2026-13-01" })).status).toBe(400);
    // A date field mid-typing passes through year 0002 before reaching 2027.
    expect((await call(LOCAL, "PATCH", "/tasks/a/L1/t1", { due: "0002-11-05" })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("an unknown account is a 404 and lost access a 409", async () => {
    expect((await setup(new UnknownTaskAccount()).call(LOCAL, "GET", "/tasks")).status).toBe(404);
    expect((await setup(new GoogleAuthExpired("me@gmail.com")).call(LOCAL, "GET", "/tasks")).status).toBe(409);
  });
});
