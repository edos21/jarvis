import type { Context, Hono } from "hono";

import {
  type ClaudeSessionsResponse,
  type CleanupReport,
  type MacCta,
  type MacResponse,
  type MacSample,
  type MacStatus,
  type MoleReport,
  isMacRange,
} from "../../../shared/mac.js";
import { type ApiError, isRemote, macOnly } from "../app.js";
import { type Cleanup, CleanupConflict } from "./cleanup.js";
import { type CommandRunner, type MacCollector, parseProcesses } from "./collect.js";
import type { MacHistory } from "./history.js";
import type { Mole } from "./mole.js";
import type { ClaudeSessions } from "./sessions.js";
import { SOFTWARE_UPDATE_URL, suggestForMac } from "./suggest.js";

const CACHE_MS = 60_000;

export type MacSource = { read(): Promise<MacResponse>; invalidate(): void };

export const createMacSource = (
  collector: MacCollector,
  opts: { now?: () => Date; onCollect?: (status: MacStatus) => void } = {},
): MacSource => {
  const now = opts.now ?? (() => new Date());
  let cached: { value: MacResponse; at: number } | null = null;
  let inFlight: Promise<MacResponse> | null = null;
  // Bumped by invalidate(): a reading that started before a cleanup must not be cached as the new one.
  let generation = 0;
  return {
    read: async () => {
      if (cached && now().getTime() - cached.at < CACHE_MS) return cached.value;
      const started = generation;
      inFlight ??= collector
        .collect()
        .then((status) => {
          // The history is a side record: a failed write never costs Today its Mac block.
          try {
            opts.onCollect?.(status);
          } catch (error) {
            console.error(`mac history: ${error instanceof Error ? error.message : String(error)}`);
          }
          const value = { status, suggestions: suggestForMac(status) };
          if (started === generation) cached = { value, at: now().getTime() };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    invalidate: () => {
      generation += 1;
      cached = null;
      inFlight = null;
    },
  };
};

// The page only names what to open; the command and its target are fixed here.
const openArgs = (cta: MacCta): string[] | null => {
  if (cta.kind === "open_url" && cta.url === SOFTWARE_UPDATE_URL) return [SOFTWARE_UPDATE_URL];
  if (cta.kind === "open_app" && cta.app === "Activity Monitor") return ["-a", "Activity Monitor"];
  return null;
};

// A refusal the page should show (a stale preview, a missing tool) is a 409 with its message.
const conflictReply = async <T extends CleanupReport | MoleReport>(c: Context, work: () => Promise<T>) => {
  try {
    return c.json<T>(await work());
  } catch (error) {
    if (error instanceof CleanupConflict) return c.json<ApiError>({ error: error.message }, 409);
    throw error;
  }
};

// A deletion names what it acts on and says it was confirmed.
const confirmedId = async (c: Context, field: "id" | "previewId"): Promise<string | null> => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const id = body[field];
  return body.confirm === true && typeof id === "string" ? id : null;
};

export const macRoutes =
  (source: MacSource, run: CommandRunner, history: MacHistory, sessions: ClaudeSessions, cleanup: Cleanup, mole: Mole) =>
  (app: Hono): void => {
    app.get("/mac", async (c) => c.json<MacResponse>(await source.read()));

    // Folder names and terminal tabs: only from the Mac itself.
    macOnly(app, "/mac/sessions", "Solo desde la Mac.");
    app.get("/mac/sessions", async (c) => c.json<ClaudeSessionsResponse>(await sessions.read()));
    app.post("/mac/sessions/prepare", async (c) => c.json<ClaudeSessionsResponse>(await sessions.prepare()));
    app.post("/mac/sessions/resume", async (c) => c.json<ClaudeSessionsResponse>(await sessions.resume()));

    // Deleting volumes and quitting apps: only from the Mac itself.
    macOnly(app, "/mac/cleanup", "Solo desde la Mac.");
    app.get("/mac/cleanup", (c) => c.json<CleanupReport | null>(cleanup.latest()));
    app.post("/mac/cleanup/analyze", async (c) => c.json<CleanupReport>(await cleanup.analyze()));
    app.post("/mac/cleanup/apply", async (c) => {
      const id = await confirmedId(c, "id");
      if (!id) return c.json<ApiError>({ error: "Falta confirmar." }, 400);
      return conflictReply(c, async () => {
        const report = await cleanup.apply(id);
        source.invalidate();
        return report;
      });
    });

    // Mole reads and deletes on the Mac: only from the Mac itself. Every deletion names the preview it acts on.
    macOnly(app, "/mac/mole", "Solo desde la Mac.");
    app.get("/mac/mole", async (c) => c.json<MoleReport>(await mole.read()));
    app.post("/mac/mole/analyze", async (c) => {
      const body = await c.req.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown });
      const path = typeof body.path === "string" ? body.path : null;
      return conflictReply(c, () => mole.analyze(path));
    });
    const moleSteps = {
      clean: { preview: mole.previewClean, apply: mole.applyClean },
      installers: { preview: mole.previewInstallers, apply: mole.applyInstallers },
    };
    for (const [what, step] of Object.entries(moleSteps)) {
      app.post(`/mac/mole/${what}/preview`, (c) => conflictReply(c, step.preview));
      app.post(`/mac/mole/${what}/apply`, async (c) => {
        const previewId = await confirmedId(c, "previewId");
        if (!previewId) return c.json<ApiError>({ error: "Falta confirmar." }, 400);
        // Even a run that failed halfway may have freed space.
        return conflictReply(c, () => step.apply(previewId).finally(() => source.invalidate()));
      });
    }

    app.get("/mac/history", (c) => {
      const range = c.req.query("range") ?? "24h";
      if (!isMacRange(range)) return c.json<ApiError>({ error: "Rango inválido." }, 400);
      return c.json<MacSample[]>(history.read(range));
    });

    app.post("/mac/open", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Solo desde la Mac." }, 403);
      const body = await c.req.json<{ cta?: MacCta }>().catch(() => ({ cta: undefined }));
      const args = body.cta ? openArgs(body.cta) : null;
      if (!args) return c.json<ApiError>({ error: "No se puede abrir eso." }, 400);
      await run("open", args);
      return c.json({ ok: true });
    });

    app.post("/mac/processes/:pid/kill", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Solo desde la Mac." }, 403);
      const body = await c.req.json<{ confirm?: boolean }>().catch(() => ({ confirm: false }));
      if (body.confirm !== true) return c.json<ApiError>({ error: "Falta confirmar." }, 400);
      const pid = Number(c.req.param("pid"));
      // Only a process Jarvis itself flagged as stuck, never an arbitrary pid.
      const { status } = await source.read();
      const flagged = status.stuck.find((p) => p.pid === pid && p.reason !== "zombie");
      if (!flagged) return c.json<ApiError>({ error: "Ese proceso ya no aparece como colgado." }, 409);
      // The reading can be a minute old: the pid must still be the same program before it gets a signal.
      const now = await run("ps", ["-o", "pid,uid,stat,%cpu,comm", "-p", String(pid)])
        .then((text) => parseProcesses(text)[0])
        .catch(() => undefined);
      if (!now || now.name !== flagged.name) return c.json<ApiError>({ error: "Ese proceso ya terminó." }, 409);
      try {
        await run("kill", ["-9", String(pid)]);
      } catch {
        return c.json<ApiError>({ error: `No pude cerrar ${flagged.name.split("/").at(-1)}.` }, 409);
      }
      return c.json({ ok: true });
    });
  };
