import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { basename, isAbsolute, join } from "node:path";

import type { ClaudeSession, ClaudeSessionsResponse } from "../../../shared/mac.js";
import type { CommandRunner } from "./collect.js";

// Claude Code keeps one <pid>.json per running session in ~/.claude/sessions. Restarting the Mac ends the processes,
// not the conversations: `claude --resume <id>` picks each one up again in its folder.

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAB_PREFIX = "jarvis-resume-";
// Warp handles one URI at a time; a short gap keeps the tabs from racing each other.
const OPEN_GAP_MS = 400;

type Plan = { preparedAt: string; sessions: ClaudeSession[] };

const isAliveDefault = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

// The id and the folder end up in a command Warp runs: anything but a plain session id and an absolute path is left out.
const parseSession = (text: string, isAlive: (pid: number) => boolean): ClaudeSession | null => {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { pid, sessionId, cwd, name, kind, entrypoint } = raw;
  if (kind !== "interactive" || entrypoint !== "cli") return null;
  if (typeof pid !== "number" || typeof sessionId !== "string" || typeof cwd !== "string") return null;
  if (!SESSION_ID.test(sessionId) || !isAbsolute(cwd) || !isAlive(pid)) return null;
  return { sessionId, cwd, name: typeof name === "string" && name.trim() ? name.trim() : null };
};

// JSON string escaping is valid TOML basic string escaping, the same way Pepper writes its tab configs.
export const warpResumeConfig = (session: ClaudeSession): string => {
  const title = `Retomar: ${session.name ?? basename(session.cwd)}`;
  return [
    `name = ${JSON.stringify(title)}`,
    `title = ${JSON.stringify(title)}`,
    "",
    "[[panes]]",
    'id = "main"',
    'type = "terminal"',
    `directory = ${JSON.stringify(session.cwd)}`,
    `commands = [${JSON.stringify(`claude --resume ${session.sessionId}`)}]`,
    "",
  ].join("\n");
};

export type ClaudeSessions = {
  read(): Promise<ClaudeSessionsResponse>;
  // Saves the open sessions, to bring back after the restart.
  prepare(): Promise<ClaudeSessionsResponse>;
  // Opens a Warp tab per saved session that is not running, then forgets the plan.
  resume(): Promise<ClaudeSessionsResponse>;
};

export const createClaudeSessions = (deps: {
  sessionsDir: string;
  tabConfigDir: string;
  planFile: string;
  run: CommandRunner;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  bootedAt?: () => Date;
}): ClaudeSessions => {
  const isAlive = deps.isAlive ?? isAliveDefault;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const bootedAt = deps.bootedAt ?? (() => new Date(Date.now() - uptime() * 1000));

  const open = (): ClaudeSession[] => {
    if (!existsSync(deps.sessionsDir)) return [];
    const byId = new Map<string, ClaudeSession>();
    for (const file of readdirSync(deps.sessionsDir).filter((f) => /^\d+\.json$/.test(f))) {
      const session = parseSession(readFileSync(join(deps.sessionsDir, file), "utf8"), isAlive);
      if (session) byId.set(session.sessionId, session);
    }
    return [...byId.values()].sort((a, b) => a.cwd.localeCompare(b.cwd));
  };

  const plan = (): Plan | null => {
    if (!existsSync(deps.planFile)) return null;
    try {
      return JSON.parse(readFileSync(deps.planFile, "utf8")) as Plan;
    } catch {
      return null;
    }
  };

  const view = (): ClaudeSessionsResponse => {
    const running = open();
    // Only a restart after saving brings sessions back: one I closed by hand is not offered again.
    const saved = plan();
    const restarted = saved !== null && Date.parse(saved.preparedAt) < bootedAt().getTime();
    const runningIds = new Set(running.map((s) => s.sessionId));
    return {
      open: running,
      preparedAt: saved?.preparedAt ?? null,
      toResume: saved && restarted ? saved.sessions.filter((s) => !runningIds.has(s.sessionId)) : [],
    };
  };

  return {
    read: async () => view(),
    prepare: async () => {
      writeFileSync(deps.planFile, JSON.stringify({ preparedAt: now().toISOString(), sessions: open() } satisfies Plan));
      return view();
    },
    resume: async () => {
      const { toResume } = view();
      mkdirSync(deps.tabConfigDir, { recursive: true });
      // Only Jarvis's own configs: the ones from the last restart would pile up in Warp's menu.
      for (const file of readdirSync(deps.tabConfigDir).filter((f) => f.startsWith(TAB_PREFIX))) {
        rmSync(join(deps.tabConfigDir, file), { force: true });
      }
      for (const [i, session] of toResume.entries()) {
        const stem = `${TAB_PREFIX}${i + 1}`;
        writeFileSync(join(deps.tabConfigDir, `${stem}.toml`), warpResumeConfig(session));
        if (i > 0) await sleep(OPEN_GAP_MS);
        await deps.run("open", [`warp://tab_config/${stem}`]);
      }
      rmSync(deps.planFile, { force: true });
      return view();
    },
  };
};
