import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createClaudeSessions, warpResumeConfig } from "./sessions.js";

const ID_A = "0b6f1c2e-1111-4a5b-9c3d-000000000001";
const ID_B = "0b6f1c2e-2222-4a5b-9c3d-000000000002";

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sessions-"));
  const sessionsDir = join(root, "sessions");
  const tabConfigDir = join(root, "tab_configs");
  mkdirSync(sessionsDir);
  const alive = new Set<number>();
  const opened: string[] = [];
  let bootedAt = new Date("2026-09-01T00:00:00Z");
  const record = (pid: number, fields: Record<string, unknown>) => {
    alive.add(pid);
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({ pid, kind: "interactive", entrypoint: "cli", cwd: "/Users/me/dev/api", name: null, ...fields }),
    );
  };
  const sessions = createClaudeSessions({
    sessionsDir,
    tabConfigDir,
    planFile: join(root, "claude-sessions.json"),
    run: async (cmd, args) => {
      opened.push([cmd, ...args].join(" "));
      return "";
    },
    isAlive: (pid) => alive.has(pid),
    sleep: async () => undefined,
    now: () => new Date("2026-11-01T22:00:00Z"),
    bootedAt: () => bootedAt,
  });
  // The restart: every process is gone and the Mac booted after the plan was saved.
  const restart = () => {
    alive.clear();
    bootedAt = new Date("2026-11-01T22:10:00Z");
  };
  return { root, sessionsDir, tabConfigDir, sessions, record, restart, opened };
};

describe("claude sessions", () => {
  it("lists only interactive CLI sessions whose process is alive", async () => {
    const { sessions, record, sessionsDir, root } = setup();
    record(100, { sessionId: ID_A, name: "Jarvis gráficas" });
    record(101, { sessionId: ID_B, kind: "bg" });
    record(102, { sessionId: "0b6f1c2e-3333-4a5b-9c3d-000000000003", entrypoint: "sdk-ts" });
    writeFileSync(join(sessionsDir, "103.json"), JSON.stringify({ pid: 103, sessionId: ID_B, kind: "interactive", entrypoint: "cli", cwd: "/x" }));
    writeFileSync(join(sessionsDir, "104.json"), "{ not json");
    writeFileSync(join(sessionsDir, "100.abc.key"), "secret");
    expect((await sessions.read()).open).toEqual([{ sessionId: ID_A, cwd: "/Users/me/dev/api", name: "Jarvis gráficas" }]);
    expect(existsSync(join(root, "claude-sessions.json"))).toBe(false);
  });

  it("refuses a session id or folder that could carry another command", async () => {
    const { sessions, record } = setup();
    record(100, { sessionId: `${ID_A}; rm -rf ~` });
    record(101, { sessionId: ID_B, cwd: "relative/path" });
    expect((await sessions.read()).open).toEqual([]);
  });

  it("prepare saves the open sessions; nothing to resume while they run", async () => {
    const { sessions, record } = setup();
    record(100, { sessionId: ID_A });
    const res = await sessions.prepare();
    expect(res.preparedAt).toBe("2026-11-01T22:00:00.000Z");
    expect(res.toResume).toEqual([]);
  });

  it("after the restart, resume opens one Warp tab per saved session and forgets the plan", async () => {
    const { sessions, record, restart, opened, tabConfigDir } = setup();
    record(100, { sessionId: ID_A, name: "Jarvis gráficas" });
    record(101, { sessionId: ID_B, cwd: "/Users/me/dev/web" });
    await sessions.prepare();
    restart();
    expect((await sessions.read()).toResume.map((s) => s.sessionId)).toEqual([ID_A, ID_B]);
    const res = await sessions.resume();
    expect(opened).toEqual(["open warp://tab_config/jarvis-resume-1", "open warp://tab_config/jarvis-resume-2"]);
    expect(readFileSync(join(tabConfigDir, "jarvis-resume-1.toml"), "utf8")).toContain(`commands = ["claude --resume ${ID_A}"]`);
    expect(res).toMatchObject({ preparedAt: null, toResume: [] });
  });

  it("a session closed by hand, without a restart, is not offered again", async () => {
    const { sessions, record, sessionsDir } = setup();
    record(100, { sessionId: ID_A });
    record(101, { sessionId: ID_B });
    await sessions.prepare();
    rmSync(join(sessionsDir, "101.json"));
    expect((await sessions.read()).toResume).toEqual([]);
  });

  it("resume skips a saved session that is running again", async () => {
    const { sessions, record, restart, opened } = setup();
    record(100, { sessionId: ID_A });
    record(101, { sessionId: ID_B });
    await sessions.prepare();
    restart();
    record(200, { sessionId: ID_A });
    await sessions.resume();
    expect(opened).toEqual(["open warp://tab_config/jarvis-resume-1"]);
  });

  it("resume clears its own older tab configs and leaves the others", async () => {
    const { sessions, record, restart, tabConfigDir } = setup();
    mkdirSync(tabConfigDir);
    writeFileSync(join(tabConfigDir, "jarvis-resume-7.toml"), "old");
    writeFileSync(join(tabConfigDir, "other-project.toml"), "mine");
    record(100, { sessionId: ID_A });
    await sessions.prepare();
    restart();
    await sessions.resume();
    expect(readdirSync(tabConfigDir).sort()).toEqual(["jarvis-resume-1.toml", "other-project.toml"]);
  });
});

describe("warpResumeConfig", () => {
  it("quotes the title and folder as TOML strings", () => {
    const toml = warpResumeConfig({ sessionId: ID_A, cwd: '/Users/me/dev/my "app"', name: null });
    expect(toml).toContain('name = "Retomar: my \\"app\\""');
    expect(toml).toContain('directory = "/Users/me/dev/my \\"app\\""');
  });
});
