import { describe, expect, it } from "vitest";

import type { ClaudeSessionsResponse, MacResponse } from "../../../shared/mac.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createCleanup } from "./cleanup.js";
import { createMacHistory } from "./history.js";
import { createMole } from "./mole.js";
import { createMacSource, macRoutes } from "./routes.js";
import { SOFTWARE_UPDATE_URL } from "./suggest.js";

const TAILNET = "mac.tail1234.ts.net";

const response: MacResponse = {
  status: {
    cpuPct: 10,
    memPct: 50,
    diskPct: 50,
    diskFreeGb: 100,
    uptimeDays: 1,
    updates: [],
    stuck: [{ pid: 812, name: "/usr/libexec/backupd", reason: "uninterruptible", cpuPct: 0 }],
    collectedAt: "2026-10-30T12:00:00Z",
  },
  suggestions: [],
};

const noSessions: ClaudeSessionsResponse = { open: [], preparedAt: null, toResume: [] };

const setup = () => {
  const calls: string[] = [];
  const sessions = {
    read: async () => noSessions,
    prepare: async () => {
      calls.push("prepare");
      return noSessions;
    },
    resume: async () => {
      calls.push("resume");
      return noSessions;
    },
  };
  let psOutput = "  PID   UID STAT  %CPU COMM\n  812   501 U      0.0 /usr/libexec/backupd\n";
  let killFails = false;
  const run = async (cmd: string, args: string[]) => {
    if (cmd === "ps") return psOutput;
    calls.push([cmd, ...args].join(" "));
    if (cmd === "kill" && killFails) throw new Error("Operation not permitted");
    return "";
  };
  const app = createApp({ tailnetHost: TAILNET, routes: [
      macRoutes(
        { read: async () => response, invalidate: () => undefined },
        run,
        createMacHistory(openDb(":memory:")),
        sessions,
        createCleanup({ run, home: "/Users/me", uid: 501, isExecutable: async () => false }),
        createMole({ run, home: "/Users/me", trashDir: "/Users/me/.Trash", isExecutable: async () => false, installerDirs: [] }),
      ),
    ],
  });
  const post = (host: string, path: string, body: unknown) =>
    app.request(`${host}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    calls,
    post,
    get: (host: string, path: string) => app.request(`${host}/api${path}`),
    setPs: (text: string) => {
      psOutput = text;
    },
    failKill: () => {
      killFails = true;
    },
  };
};

describe("mac routes", () => {
  it("claude sessions are Mac-only, reading included", async () => {
    const { calls, get, post } = setup();
    expect((await get(`https://${TAILNET}`, "/mac/sessions")).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/sessions/resume", {})).status).toBe(403);
    expect(calls).toEqual([]);
    expect((await get("http://127.0.0.1:4417", "/mac/sessions")).status).toBe(200);
    expect((await post("http://127.0.0.1:4417", "/mac/sessions/prepare", {})).status).toBe(200);
    expect(calls).toEqual(["prepare"]);
  });

  it("kill from tailnet host → 403", async () => {
    const { calls, post } = setup();
    const res = await post(`https://${TAILNET}`, "/mac/processes/812/kill", { confirm: true });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("kill without confirm → 400", async () => {
    const { calls, post } = setup();
    const res = await post("http://127.0.0.1:4417", "/mac/processes/812/kill", {});
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("kill only a process flagged as stuck", async () => {
    const { calls, post } = setup();
    expect((await post("http://127.0.0.1:4417", "/mac/processes/1/kill", { confirm: true })).status).toBe(409);
    expect((await post("http://127.0.0.1:4417", "/mac/processes/812/kill", { confirm: true })).status).toBe(200);
    expect(calls).toEqual(["kill -9 812"]);
  });

  it("open accepts only the fixed targets", async () => {
    const { calls, post } = setup();
    const evil = await post("http://127.0.0.1:4417", "/mac/open", { cta: { kind: "open_url", url: "file:///etc" } });
    expect(evil.status).toBe(400);
    await post("http://127.0.0.1:4417", "/mac/open", { cta: { kind: "open_url", url: SOFTWARE_UPDATE_URL } });
    expect(calls).toEqual([`open ${SOFTWARE_UPDATE_URL}`]);
  });
});

describe("cleanup routes", () => {
  it("are Mac-only, reading included", async () => {
    const { calls, get, post } = setup();
    expect((await get(`https://${TAILNET}`, "/mac/cleanup")).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/cleanup/analyze", {})).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/cleanup/apply", { id: "docker", confirm: true })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("apply needs a confirmation and a finding from the last analysis", async () => {
    const { post } = setup();
    expect((await post("http://127.0.0.1:4417", "/mac/cleanup/apply", { id: "docker" })).status).toBe(400);
    const res = await post("http://127.0.0.1:4417", "/mac/cleanup/apply", { id: "docker", confirm: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Eso ya no aparece en el análisis. Vuelve a analizar." });
  });

  it("an analysis with Docker down still answers", async () => {
    const { post } = setup();
    const res = await post("http://127.0.0.1:4417", "/mac/cleanup/analyze", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ docker: { available: false } });
  });
});

describe("mole routes", () => {
  it("are Mac-only, reading included", async () => {
    const { calls, get, post } = setup();
    expect((await get(`https://${TAILNET}`, "/mac/mole")).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/mole/analyze", {})).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/mole/clean/preview", {})).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/mole/clean/apply", { previewId: "x", confirm: true })).status).toBe(403);
    expect((await post(`https://${TAILNET}`, "/mac/mole/installers/apply", { previewId: "x", confirm: true })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("deleting needs a confirmation and the preview it acts on", async () => {
    const { post } = setup();
    expect((await post("http://127.0.0.1:4417", "/mac/mole/clean/apply", { previewId: "x" })).status).toBe(400);
    expect((await post("http://127.0.0.1:4417", "/mac/mole/clean/apply", { confirm: true })).status).toBe(400);
    expect((await post("http://127.0.0.1:4417", "/mac/mole/installers/apply", { previewId: "x" })).status).toBe(400);
    const res = await post("http://127.0.0.1:4417", "/mac/mole/installers/apply", { previewId: "x", confirm: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Eso ya no es la última búsqueda. Vuelve a buscar." });
  });

  it("without Mole installed, a preview answers 409 with how to install it", async () => {
    const { get, post } = setup();
    expect(await (await get("http://127.0.0.1:4417", "/mac/mole")).json()).toMatchObject({ mole: { available: false } });
    const res = await post("http://127.0.0.1:4417", "/mac/mole/clean/preview", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Mole no está instalado. Instálalo con: brew install mole" });
  });
});

describe("mac source", () => {
  it("a reading that started before a cleanup is not cached as the new one", async () => {
    let finish: (status: MacResponse["status"]) => void = () => undefined;
    let collects = 0;
    const source = createMacSource({
      collect: () => {
        collects += 1;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const stale = source.read();
    source.invalidate();
    finish(response.status);
    await stale;
    const fresh = source.read();
    finish({ ...response.status, diskPct: 40 });
    expect((await fresh).status.diskPct).toBe(40);
    expect(collects).toBe(2);
  });

  it("a failing history write never fails the reading", async () => {
    const source = createMacSource(
      { collect: async () => response.status },
      {
        onCollect: () => {
          throw new Error("database is locked");
        },
      },
    );
    await expect(source.read()).resolves.toMatchObject({ status: { cpuPct: 10 } });
  });
});

describe("mac history route", () => {
  it("answers the known ranges, also to the phone, and refuses others", async () => {
    const { get } = setup();
    expect(await (await get(`https://${TAILNET}`, "/mac/history?range=7d")).json()).toEqual([]);
    expect((await get("http://127.0.0.1:4417", "/mac/history?range=1y")).status).toBe(400);
  });
});

describe("kill safety", () => {
  it("refuses when the pid now belongs to another program", async () => {
    const { calls, post, setPs } = setup();
    setPs("  PID   UID STAT  %CPU COMM\n  812   501 S      0.0 /usr/bin/other\n");
    const res = await post("http://127.0.0.1:4417", "/mac/processes/812/kill", { confirm: true });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("a failing kill answers a JSON 409 with the name", async () => {
    const { post, failKill } = setup();
    failKill();
    const res = await post("http://127.0.0.1:4417", "/mac/processes/812/kill", { confirm: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "No pude cerrar backupd." });
  });

  it("open with a broken body is a 400, not a 500", async () => {
    const { post } = setup();
    expect((await post("http://127.0.0.1:4417", "/mac/open", "not json")).status).toBe(400);
  });
});
