import { basename, join } from "node:path";

import type { CacheTool, CleanupAction, CleanupFinding, CleanupReport } from "../../../shared/mac.js";
import { type IsExecutable, resolveBin as findBin } from "./bin.js";
import { type CommandRunner, readFreeBytes } from "./collect.js";
import { type SerialQueue, serialQueue } from "./queue.js";

const HOUR_MS = 3_600_000;
// A stopped container younger than this may be one I am about to start again.
const STOPPED_KEEP_MS = 24 * HOUR_MS;
// Unused tagged images and build cache younger than this keep the next build fast.
const BUILD_KEEP_MS = 7 * 24 * HOUR_MS;
const DOCKER_MIN_BYTES = 50e6;
const VOLUME_MIN_BYTES = 1e6;
const CACHE_MIN_BYTES = 200e6;
const APP_MEM_MIN_BYTES = 1e9;
const APP_CPU_MIN_PCT = 20;
const TOP_APPS = 5;
const QUIT_WAIT_TRIES = 10;
// Names that reach a command as an argument: never one that could read as a flag.
const DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

// The finding changed between the analysis and the click: the page shows the message and offers to analyze again.
export class CleanupConflict extends Error {}

// Docker prints decimal units in df ("485.2MB", "92B") and binary ones in stats ("15.78MiB").
const UNITS: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };

export const dockerBytes = (text: string | undefined): number => {
  const m = /^([\d.]+)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB)\b/.exec(text?.trim() ?? "");
  return m ? Math.round(Number(m[1]) * (UNITS[m[2] ?? ""] ?? 0)) : 0;
};

// "2026-11-03 11:11:22 -0300 -03" or "2026-10-13 19:54:15.680495836 +0000 UTC".
export const dockerDate = (text: string | undefined): number => {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})/.exec(text ?? "");
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : Number.NaN;
};

// Label values can hold commas (compose lists its config files), so the project is matched, not split out.
const composeProject = (labels: string | undefined): string | null =>
  /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(labels ?? "")?.[1] ?? null;

type DfImage = { ID: string; Repository: string; Tag: string; CreatedAt: string; UniqueSize: string };
type DfContainer = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  CreatedAt: string;
  Size: string;
  Labels: string;
};
type DfVolume = { Name: string; Links: string; Size: string; Labels: string };
type DfCache = { ID: string; Parent?: string; Parents?: string; InUse: string | boolean; LastUsedAt: string; Size: string };
export type DockerDf = { Images: DfImage[]; Containers: DfContainer[]; Volumes: DfVolume[]; BuildCache: DfCache[] };

export const parseDockerDf = (text: string): DockerDf => {
  const raw = JSON.parse(text) as Partial<DockerDf>;
  return { Images: raw.Images ?? [], Containers: raw.Containers ?? [], Volumes: raw.Volumes ?? [], BuildCache: raw.BuildCache ?? [] };
};

// One JSON object per line, as `docker stats --format json` prints them.
export const parseDockerStats = (text: string): Map<string, { cpuPct: number; memBytes: number }> =>
  new Map(
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const s = JSON.parse(line) as { Name: string; CPUPerc: string; MemUsage: string };
        return [s.Name, { cpuPct: Number.parseFloat(s.CPUPerc) || 0, memBytes: dockerBytes(s.MemUsage.split("/")[0]) }];
      }),
  );

const STOPPED = new Set(["exited", "created", "dead"]);

// A container names its image by full or short id, or by reference; a bare name means its :latest tag.
const SHORT_ID = /^[0-9a-f]{12,64}$/;
const imageRef = (ref: string): string => (ref.startsWith("sha256:") || SHORT_ID.test(ref) || /:[^/]+$/.test(ref) ? ref : `${ref}:latest`);

const usedBy = (used: Set<string>, i: DfImage): boolean =>
  used.has(i.ID) || used.has(`${i.Repository}:${i.Tag}`) || [...used].some((ref) => SHORT_ID.test(ref) && i.ID.startsWith(`sha256:${ref}`));

const parentsOf = (b: DfCache): string[] => `${b.Parent ?? ""},${b.Parents ?? ""}`.split(",").filter(Boolean);

// Build cache is a chain of layers: an old layer under a recent one stays, so it is not counted as freed.
const prunableCache = (cache: DfCache[], at: number): DfCache[] => {
  const byId = new Map(cache.map((b) => [b.ID, b]));
  const kept = new Set<string>();
  const keep = (b: DfCache): void => {
    if (kept.has(b.ID)) return;
    kept.add(b.ID);
    for (const id of parentsOf(b)) {
      const parent = byId.get(id);
      if (parent) keep(parent);
    }
  };
  for (const b of cache) if (String(b.InUse) === "true" || !(at - dockerDate(b.LastUsedAt) > BUILD_KEEP_MS)) keep(b);
  return cache.filter((b) => !kept.has(b.ID));
};

// What the four prunes in applyDockerPrune would remove, measured from the same rules they apply.
export const dockerReclaim = (
  df: DockerDf,
  at: number,
): { containers: number; images: number; cacheBytes: number; bytes: number } => {
  const removed = df.Containers.filter((c) => STOPPED.has(c.State) && at - dockerDate(c.CreatedAt) > STOPPED_KEEP_MS);
  const gone = new Set(removed.map((c) => c.ID));
  const used = new Set(df.Containers.filter((c) => !gone.has(c.ID)).map((c) => imageRef(c.Image)));
  // One row per tag: an image with several tags is still one image, and every tag must be unused for it to go.
  const byId = new Map<string, DfImage[]>();
  for (const i of df.Images) byId.set(i.ID, [...(byId.get(i.ID) ?? []), i]);
  const images = [...byId.values()].filter(
    (tags) =>
      tags.every((i) => !usedBy(used, i)) &&
      tags.every((i) => i.Repository === "<none>" || at - dockerDate(i.CreatedAt) > BUILD_KEEP_MS),
  );
  const cacheBytes = prunableCache(df.BuildCache, at).reduce((n, b) => n + dockerBytes(b.Size), 0);
  const bytes =
    removed.reduce((n, c) => n + dockerBytes(c.Size), 0) +
    images.reduce((n, tags) => n + dockerBytes(tags[0]?.UniqueSize), 0) +
    cacheBytes;
  return { containers: removed.length, images: images.length, cacheBytes, bytes };
};

const UP_UNITS: Record<string, number> = {
  second: 1e3,
  minute: 60e3,
  hour: HOUR_MS,
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
  month: 30 * 24 * HOUR_MS,
  year: 365 * 24 * HOUR_MS,
};

// How long a container has been running, from Docker's "Up 24 hours (healthy)": its creation date says nothing
// about a container started again.
export const upForMs = (status: string): number | null => {
  const m = /^Up (?:(\d+)|About an?|Less than an?) (second|minute|hour|day|week|month|year)s?\b/.exec(status);
  return m ? (m[1] ? Number(m[1]) : 1) * (UP_UNITS[m[2] ?? ""] ?? 0) : null;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const ago = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return plural(minutes, "minuto", "minutos");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, "hora", "horas");
  return plural(Math.round(hours / 24), "día", "días");
};

export const dockerFindings = (
  df: DockerDf,
  stats: Map<string, { cpuPct: number; memBytes: number }>,
  vmMemBytes: number | null,
  at: number,
): CleanupFinding[] => {
  const out: CleanupFinding[] = [];
  const reclaim = dockerReclaim(df, at);
  if (reclaim.bytes >= DOCKER_MIN_BYTES) {
    const parts = [
      reclaim.containers > 0 ? plural(reclaim.containers, "contenedor detenido", "contenedores detenidos") : null,
      reclaim.images > 0 ? plural(reclaim.images, "imagen sin uso", "imágenes sin uso") : null,
      reclaim.cacheBytes > 0 ? "build cache sin usar hace más de una semana" : null,
    ].filter(Boolean);
    out.push({
      id: "docker",
      area: "disk",
      title: "Limpiar Docker",
      detail:
        `${parts.join(", ")}. No toca lo que está corriendo ni lo que construiste esta semana; ` +
        "una imagen descargada sin contenedor puede irse, y se vuelve a bajar sola.",
      bytes: reclaim.bytes,
      action: { kind: "docker_prune" },
      risk: "safe",
    });
  }

  for (const v of df.Volumes) {
    const bytes = dockerBytes(v.Size);
    if (v.Links !== "0" || bytes < VOLUME_MIN_BYTES || !DOCKER_NAME.test(v.Name)) continue;
    const project = composeProject(v.Labels);
    out.push({
      id: `volume:${v.Name}`,
      area: "disk",
      title: project ? `Volumen ${v.Name}` : `Volumen anónimo ${v.Name.slice(0, 12)}`,
      detail: "Ningún contenedor lo usa, pero guarda datos (por ejemplo, una base de datos): si lo borras no vuelve.",
      bytes,
      action: { kind: "docker_volume", name: v.Name },
      risk: "data",
    });
  }

  const running = new Map<string, DfContainer[]>();
  for (const c of df.Containers) {
    const project = composeProject(c.Labels);
    if (c.State !== "running" || !project || !DOCKER_NAME.test(project)) continue;
    running.set(project, [...(running.get(project) ?? []), c]);
  }
  for (const [project, containers] of running) {
    const use = containers.map((c) => stats.get(c.Names) ?? { cpuPct: 0, memBytes: 0 });
    const cpu = use.reduce((n, u) => n + u.cpuPct, 0);
    const ups = containers.map((c) => upForMs(c.Status)).filter((ms): ms is number => ms !== null);
    out.push({
      id: `compose:${project}`,
      area: "memory",
      title: `Proyecto ${project} corriendo`,
      detail:
        `${plural(containers.length, "contenedor", "contenedores")}, CPU ${cpu.toFixed(1)}% ahora` +
        `${ups.length > 0 ? `, levantado hace ${ago(Math.min(...ups))}` : ""}. Detenerlo no borra nada.`,
      bytes: use.reduce((n, u) => n + u.memBytes, 0),
      action: { kind: "compose_stop", project },
      risk: "safe",
    });
  }

  if (vmMemBytes !== null) {
    const idle = !df.Containers.some((c) => c.State === "running");
    out.push({
      id: "docker-vm",
      area: "memory",
      title: "Memoria reservada por Docker",
      detail: idle
        ? "No hay contenedores corriendo: cerrar Docker Desktop le devuelve esa memoria a la Mac."
        : "Es la memoria de su máquina virtual. Detener proyectos la libera dentro de Docker; a la Mac vuelve al cerrar Docker Desktop.",
      bytes: vmMemBytes,
      action: idle ? { kind: "quit_app", app: "Docker" } : null,
      risk: "safe",
    });
  }
  return out;
};

export type AppUsage = { app: string; memBytes: number; cpuPct: number };

// Every process inside an app bundle counts for that app: Chrome's helpers are Chrome.
const APP_PATH = /^(?:\/System\/Applications|\/Applications|\/Users\/[^/]+\/Applications)\/(?:[^/]+\/)*?([^/]+)\.app\//;

export const PS_APP_ARGS = ["-Ao", "pid,uid,rss,%cpu,comm"];

export const groupApps = (ps: string, uid: number): AppUsage[] => {
  const apps = new Map<string, AppUsage>();
  for (const line of ps.trim().split("\n").slice(1)) {
    const m = /^\s*\d+\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
    if (!m || Number(m[1]) !== uid) continue;
    const app = APP_PATH.exec(m[4] ?? "")?.[1];
    if (!app) continue;
    const prev = apps.get(app) ?? { app, memBytes: 0, cpuPct: 0 };
    apps.set(app, { app, memBytes: prev.memBytes + Number(m[2]) * 1024, cpuPct: prev.cpuPct + Number(m[3]) });
  }
  return [...apps.values()];
};

// My own processes whose executable is named `name`, wherever it lives.
export const countProcesses = (ps: string, uid: number, name: string): number =>
  ps
    .trim()
    .split("\n")
    .slice(1)
    .filter((line) => {
      const m = /^\s*\d+\s+(\d+)\s+\d+\s+[\d.]+\s+(.+)$/.exec(line);
      return m !== null && Number(m[1]) === uid && basename(m[2] ?? "") === name;
    }).length;

const inUse = (spec: CacheSpec, running: number): string =>
  running === 1
    ? `${spec.label} está corriendo en 1 proceso y no deja limpiar su caché hasta que termine.`
    : `${spec.label} está corriendo en ${running} procesos (por ejemplo, servidores MCP) y no deja limpiar su caché hasta que terminen.`;

const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

export const appFindings = (apps: AppUsage[]): CleanupFinding[] => {
  const quittable = apps.filter((a) => APP_NAME.test(a.app));
  const memory = quittable
    .filter((a) => a.memBytes >= APP_MEM_MIN_BYTES)
    .sort((a, b) => b.memBytes - a.memBytes)
    .slice(0, TOP_APPS)
    .map(
      (a): CleanupFinding => ({
        id: `mem:${a.app}`,
        area: "memory",
        title: a.app,
        detail: `Usa ${gb(a.memBytes)} de memoria. Al cerrarla te pide guardar lo que tengas abierto.`,
        bytes: a.memBytes,
        action: { kind: "quit_app", app: a.app },
        risk: "safe",
      }),
    );
  const cpu = quittable
    .filter((a) => a.cpuPct >= APP_CPU_MIN_PCT)
    .sort((a, b) => b.cpuPct - a.cpuPct)
    .slice(0, TOP_APPS)
    .map(
      (a): CleanupFinding => ({
        id: `cpu:${a.app}`,
        area: "cpu",
        title: a.app,
        detail: `Usa ${Math.round(a.cpuPct)}% de CPU ahora (100% es un núcleo entero).`,
        bytes: null,
        action: { kind: "quit_app", app: a.app },
        risk: "safe",
      }),
    );
  return [...memory, ...cpu];
};

// lockedBy: a process that holds the cache while it runs. Its clean waits for every one to finish, so with a
// long-lived one (an MCP server under `uv run`) it would hang instead of failing.
type CacheSpec = { label: string; dir: string; bins: string[]; args: string[]; lockedBy?: string };

// Each cache is cleaned by its own tool, never by deleting its folder: the tool knows what is safe to drop.
export const cacheSpecs = (home: string): Record<CacheTool, CacheSpec> => ({
  npm: { label: "npm", dir: join(home, ".npm", "_cacache"), bins: ["npm"], args: ["cache", "clean", "--force"] },
  pip: {
    label: "pip",
    dir: join(home, "Library", "Caches", "pip"),
    bins: [join(home, ".pyenv", "shims", "pip3"), "pip3"],
    args: ["cache", "purge"],
  },
  uv: {
    label: "uv",
    dir: join(home, ".cache", "uv"),
    bins: [join(home, ".local", "bin", "uv"), "uv"],
    args: ["cache", "clean"],
    lockedBy: "uv",
  },
  brew: {
    label: "Homebrew",
    dir: join(home, "Library", "Caches", "Homebrew"),
    bins: ["brew"],
    args: ["cleanup", "-s", "--prune=all"],
  },
});

export const createCleanup = (deps: {
  run: CommandRunner;
  home: string;
  uid: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  // launchd's PATH: a bare tool name is looked up in it.
  path?: string;
  isExecutable?: IsExecutable;
  // Shared with Mole: two cleanups deleting the same caches at once would also measure each other's df.
  serial?: SerialQueue;
}) => {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const specs = cacheSpecs(deps.home);
  let last: CleanupReport | null = null;

  // A cleanup acts on the report the click came from.
  const serial = deps.serial ?? serialQueue();

  const resolveBin = (bins: string[]): Promise<string | null> => findBin(bins, deps.path, deps.isExecutable);

  const readDocker = async (at: number): Promise<{ vmMemBytes: number | null; findings: CleanupFinding[] }> => {
    const [dfText, info] = await Promise.all([
      deps.run("docker", ["system", "df", "-v", "--format", "json"]),
      deps.run("docker", ["info", "--format", "{{.MemTotal}}"]).catch(() => ""),
    ]);
    const df = parseDockerDf(dfText);
    const vmMemBytes = Number(info.trim()) || null;
    const stats = df.Containers.some((c) => c.State === "running")
      ? parseDockerStats(await deps.run("docker", ["stats", "--no-stream", "--format", "json"]).catch(() => ""))
      : new Map();
    return { vmMemBytes, findings: dockerFindings(df, stats, vmMemBytes, at) };
  };

  const readPs = (): Promise<string> => deps.run("ps", PS_APP_ARGS);
  const lockHolders = (spec: CacheSpec, ps: string): number => (spec.lockedBy ? countProcesses(ps, deps.uid, spec.lockedBy) : 0);

  const readCaches = async (ps: Promise<string>): Promise<CleanupFinding[]> => {
    const found = await Promise.all(
      (Object.entries(specs) as [CacheTool, CacheSpec][]).map(async ([tool, spec]): Promise<CleanupFinding | null> => {
        const kb = await deps
          .run("du", ["-sk", spec.dir])
          .then((text) => Number(text.trim().split(/\s+/)[0]))
          .catch(() => 0);
        const bytes = kb * 1024;
        if (bytes < CACHE_MIN_BYTES || !(await resolveBin(spec.bins))) return null;
        const running = lockHolders(spec, await ps.catch(() => ""));
        return {
          id: `cache:${tool}`,
          area: "disk",
          title: `Caché de ${spec.label}`,
          detail:
            running > 0 ? inUse(spec, running) : "Lo que se descargó para instalar paquetes. Se vuelve a bajar solo cuando haga falta.",
          bytes,
          action: running > 0 ? null : { kind: "cache", tool },
          risk: "safe",
        };
      }),
    );
    return found.filter((f): f is CleanupFinding => f !== null);
  };

  const readApps = async (ps: Promise<string> = readPs()): Promise<AppUsage[]> => groupApps(await ps, deps.uid);

  const build = async (freedBytes: number | null): Promise<CleanupReport> => {
    const at = now();
    const ps = readPs();
    const [docker, caches, apps] = await Promise.allSettled([readDocker(at.getTime()), readCaches(ps), readApps(ps)]);
    const ok = <T>(r: PromiseSettledResult<T>, fallback: T): T => (r.status === "fulfilled" ? r.value : fallback);
    const dockerValue = ok(docker, null);
    return {
      analyzedAt: at.toISOString(),
      docker: { available: dockerValue !== null, vmMemBytes: dockerValue?.vmMemBytes ?? null },
      findings: [...(dockerValue?.findings ?? []), ...ok(caches, []), ...appFindings(ok(apps, []))],
      freedBytes,
    };
  };


  const perform = async (action: CleanupAction): Promise<void> => {
    switch (action.kind) {
      case "docker_prune":
        await deps.run("docker", ["container", "prune", "-f", "--filter", "until=24h"]);
        await deps.run("docker", ["image", "prune", "-f"]);
        await deps.run("docker", ["image", "prune", "-a", "-f", "--filter", "until=168h"]);
        // Without --all only dangling cache goes; until keeps what was used this week.
        await deps.run("docker", ["builder", "prune", "-a", "-f", "--filter", "until=168h"]);
        return;
      case "docker_volume": {
        if (!DOCKER_NAME.test(action.name)) throw new CleanupConflict("Ese volumen tiene un nombre inesperado.");
        const users = await deps.run("docker", ["ps", "-a", "-q", "--filter", `volume=${action.name}`]);
        if (users.trim()) throw new CleanupConflict("Un contenedor empezó a usar ese volumen: no lo borré.");
        await deps.run("docker", ["volume", "rm", action.name]);
        return;
      }
      case "cache": {
        const spec = specs[action.tool];
        const bin = await resolveBin(spec.bins);
        if (!bin) throw new CleanupConflict(`No encontré ${spec.label} en esta Mac.`);
        const running = lockHolders(spec, await readPs());
        if (running > 0) throw new CleanupConflict(inUse(spec, running));
        await deps.run(bin, spec.args);
        return;
      }
      case "quit_app": {
        if (!APP_NAME.test(action.app)) throw new CleanupConflict("Esa app tiene un nombre inesperado.");
        if (!(await readApps()).some((a) => a.app === action.app)) throw new CleanupConflict(`${action.app} ya está cerrada.`);
        // The name goes in as an argument, never into the script. Not waiting for the reply: the app may stop to ask
        // whether to save, and that question is mine to answer.
        await deps.run("osascript", [
          "-e",
          "on run argv",
          "-e",
          "ignoring application responses",
          "-e",
          "tell application (item 1 of argv) to quit",
          "-e",
          "end ignoring",
          "-e",
          "end run",
          action.app,
        ]);
        // Give it a few seconds to close, so the new report does not list it again.
        for (let i = 0; i < QUIT_WAIT_TRIES; i += 1) {
          await sleep(500);
          if (!(await readApps()).some((a) => a.app === action.app)) break;
        }
        return;
      }
      case "compose_stop":
        if (!DOCKER_NAME.test(action.project)) throw new CleanupConflict("Ese proyecto tiene un nombre inesperado.");
        await deps.run("docker", ["compose", "-p", action.project, "stop"]);
        return;
    }
  };

  const FAILED: Record<CleanupAction["kind"], string> = {
    docker_prune: "Docker no pudo terminar la limpieza.",
    docker_volume: "Docker no pudo borrar ese volumen.",
    cache: "No se pudo limpiar esa caché.",
    quit_app: "No pude pedirle a la app que se cierre.",
    compose_stop: "No pude detener ese proyecto.",
  };

  const FREES_DISK = new Set<CleanupAction["kind"]>(["docker_prune", "docker_volume", "cache"]);

  return {
    latest: (): CleanupReport | null => last,
    analyze: (): Promise<CleanupReport> =>
      serial(async () => {
        last = await build(null);
        return last;
      }),
    apply: (id: string): Promise<CleanupReport> =>
      serial(async () => {
        const action = last?.findings.find((f) => f.id === id)?.action;
        if (!action) throw new CleanupConflict("Eso ya no aparece en el análisis. Vuelve a analizar.");
        const before = FREES_DISK.has(action.kind) ? await readFreeBytes(deps.run) : null;
        try {
          await perform(action);
        } catch (error) {
          if (error instanceof CleanupConflict) throw error;
          throw new CleanupConflict(FAILED[action.kind]);
        }
        const after = before === null ? null : await readFreeBytes(deps.run);
        last = await build(before !== null && after !== null ? Math.max(0, after - before) : null);
        return last;
      }),
  };
};

export type Cleanup = ReturnType<typeof createCleanup>;
