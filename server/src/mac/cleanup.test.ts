import { describe, expect, it } from "vitest";

import {
  CleanupConflict,
  type DockerDf,
  createCleanup,
  dockerBytes,
  dockerDate,
  dockerReclaim,
  groupApps,
  upForMs,
} from "./cleanup.js";

const NOW = new Date("2026-11-03T12:00:00Z");
const HOME = "/Users/me";

const LABELS = (project: string) => `com.docker.compose.project.config_files=/a.yml,/b.yml,com.docker.compose.project=${project},x=y`;

const image = (id: string, repo: string, tag: string, created: string, unique: string) => ({
  ID: `sha256:${id}`,
  Repository: repo,
  Tag: tag,
  CreatedAt: created,
  UniqueSize: unique,
});

const container = (id: string, name: string, img: string, state: string, created: string, project: string | null) => ({
  ID: id,
  Names: name,
  Image: img,
  State: state,
  Status: state === "running" ? (name.includes("db") ? "Up 2 hours (healthy)" : "Up About an hour") : "Exited (0) 2 days ago",
  CreatedAt: created,
  Size: "1MB",
  Labels: project ? LABELS(project) : "",
});

// A Mac like mine, small: one project running, an old worktree stopped, rebuild leftovers and old cache.
const DF: DockerDf = {
  Images: [
    image("run", "api-agent", "latest", "2026-11-03 11:00:00 -0300 -03", "485.2MB"),
    image("dangling", "<none>", "<none>", "2026-11-03 10:00:00 -0300 -03", "7.2MB"),
    image("oldtag", "api-agent", "old", "2026-10-20 10:00:00 -0300 -03", "400MB"),
    image("newtag", "shop-web", "latest", "2026-11-02 15:00:00 -0300 -03", "846MB"),
    image("stopped", "shop-db", "latest", "2026-09-01 10:00:00 -0300 -03", "300MB"),
    image("recent-stopped", "redis", "7", "2026-09-01 10:00:00 -0300 -03", "50MB"),
  ],
  Containers: [
    container("c1", "api-agent-1", "api-agent:latest", "running", "2026-11-03 08:50:00 -0300 -03", "api"),
    container("c2", "api-db-1", "postgres:16", "running", "2026-11-03 08:50:00 -0300 -03", "api"),
    container("c3", "old-db-1", "shop-db:latest", "exited", "2026-10-01 10:00:00 -0300 -03", "old"),
    container("c4", "new-redis-1", "redis:7", "exited", "2026-11-03 07:00:00 -0300 -03", "new"),
  ],
  Volumes: [
    { Name: "old_pgdata", Links: "0", Size: "120MB", Labels: "com.docker.compose.project=old" },
    { Name: "a".repeat(64), Links: "0", Size: "5MB", Labels: "com.docker.volume.anonymous=" },
    { Name: "api_pgdata", Links: "1", Size: "300MB", Labels: "com.docker.compose.project=api" },
    { Name: "tiny", Links: "0", Size: "92B", Labels: "" },
  ],
  BuildCache: [
    { ID: "old", InUse: "false", LastUsedAt: "2026-10-13 19:54:15.680495836 +0000 UTC", Size: "1GB" },
    { ID: "recent", Parent: "base", InUse: "false", LastUsedAt: "2026-11-02 19:54:15.680495836 +0000 UTC", Size: "2GB" },
    // Old, but a recent layer is built on it: the prune has to leave it.
    { ID: "base", InUse: "false", LastUsedAt: "2026-10-01 19:54:15.680495836 +0000 UTC", Size: "700MB" },
    { ID: "busy", InUse: "true", LastUsedAt: "2026-10-01 19:54:15.680495836 +0000 UTC", Size: "3GB" },
  ],
};

const STATS = [
  { Name: "api-agent-1", CPUPerc: "12.50%", MemUsage: "512MiB / 7.653GiB" },
  { Name: "api-db-1", CPUPerc: "0.40%", MemUsage: "64MiB / 7.653GiB" },
]
  .map((s) => JSON.stringify(s))
  .join("\n");

const PS = `  PID   UID   RSS  %CPU COMM
  718   501 2000000  30.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 1496   501 1000000  15.0 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  900   501  300000   1.0 /Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  950   501 3000000  50.0 /usr/local/bin/node
  960     0 3000000  50.0 /Applications/Root Thing.app/Contents/MacOS/Root Thing
`;

const setup = (opts: { docker?: boolean } = {}) => {
  const calls: string[] = [];
  let free = 100e9;
  let volumeUsers = "";
  let ps = PS;
  const run = async (cmd: string, args: string[]): Promise<string> => {
    const line = [cmd, ...args].join(" ");
    if (cmd === "docker" && opts.docker === false) throw new Error("Cannot connect to the Docker daemon");
    if (line.startsWith("docker system df")) return JSON.stringify(DF);
    if (line.startsWith("docker info")) return "8217825280\n";
    if (line.startsWith("docker stats")) return STATS;
    if (line.startsWith("docker ps")) return volumeUsers;
    if (cmd === "du") return args[1]?.endsWith("uv") ? `4766976\t${args[1]}` : `100\t${args[1]}`;
    if (cmd === "ps") return ps;
    if (cmd === "df") return `Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s5 100 50 ${free / 1024} 82%\n`;
    calls.push(line);
    if (line.startsWith("docker builder prune")) free += 3e9;
    return "";
  };
  const cleanup = createCleanup({
    run,
    home: HOME,
    uid: 501,
    now: () => NOW,
    sleep: async () => undefined,
    path: "/usr/local/bin",
    isExecutable: async (file) => file === `${HOME}/.local/bin/uv`,
  });
  return {
    cleanup,
    calls,
    useVolume: () => {
      volumeUsers = "c9\n";
    },
    // A long-lived `uv run` (an MCP server) holds uv's cache lock.
    startUv: (count = 1, uid = 501) => {
      ps += Array.from({ length: count }, (_, i) => `  ${2000 + i}   ${uid}  5000   0.0 uv\n`).join("");
    },
  };
};

describe("docker output", () => {
  it("reads sizes in decimal and binary units, and its dates", () => {
    expect(dockerBytes("485.2MB")).toBe(485_200_000);
    expect(dockerBytes("92B")).toBe(92);
    expect(dockerBytes("2.35MB (virtual 228MB)")).toBe(2_350_000);
    expect(dockerBytes("15.78MiB ")).toBe(Math.round(15.78 * 1024 ** 2));
    expect(dockerBytes("N/A")).toBe(0);
    expect(dockerDate("2026-11-03 11:11:22 -0300 -03")).toBe(Date.parse("2026-11-03T14:11:22Z"));
    expect(dockerDate("2026-10-13 19:54:15.680495836 +0000 UTC")).toBe(Date.parse("2026-10-13T19:54:15Z"));
    expect(upForMs("Up 24 hours")).toBe(24 * 3_600_000);
    expect(upForMs("Up 7 minutes (healthy)")).toBe(7 * 60_000);
    expect(upForMs("Up About an hour")).toBe(3_600_000);
    expect(upForMs("Exited (255) 24 hours ago")).toBeNull();
  });

  it("counts only what the prunes remove: never images a container keeps, this week's builds or the layers under them", () => {
    // Removed: the old stopped container (1MB), its image, the dangling one and the old tag; and the old build cache.
    expect(dockerReclaim(DF, NOW.getTime())).toEqual({
      containers: 1,
      images: 3,
      cacheBytes: 1e9,
      bytes: 1e6 + 300e6 + 7.2e6 + 400e6 + 1e9,
    });
  });

  it("an image used by short id, or by one of its tags, stays; a boolean InUse keeps its cache", () => {
    const old = "2026-09-01 10:00:00 -0300 -03";
    const df: DockerDf = {
      Images: [
        image("a1b2c3d4e5f6aaaa", "<none>", "<none>", old, "100MB"),
        image("multi", "app", "v1", old, "200MB"),
        image("multi", "app", "v2", old, "200MB"),
        image("free", "app", "v0", old, "50MB"),
        image("free", "app", "v00", old, "50MB"),
      ],
      Containers: [
        container("c1", "a-1", "a1b2c3d4e5f6", "running", old, null),
        container("c2", "b-1", "app:v2", "running", old, null),
      ],
      Volumes: [],
      BuildCache: [{ ID: "x", InUse: true, LastUsedAt: "2026-10-01 19:54:15 +0000 UTC", Size: "1GB" }],
    };
    // Only the unused image, once for its two tags.
    expect(dockerReclaim(df, NOW.getTime())).toMatchObject({ images: 1, cacheBytes: 0, bytes: 50e6 });
  });
});

describe("apps", () => {
  it("adds every helper to its app and leaves out what is not mine or not an app", () => {
    expect(groupApps(PS, 501)).toEqual([
      { app: "Google Chrome", memBytes: 3_000_000 * 1024, cpuPct: 45 },
      { app: "Terminal", memBytes: 300_000 * 1024, cpuPct: 1 },
    ]);
  });
});

describe("analysis", () => {
  it("lists docker, volumes one by one, running projects, caches and the apps that weigh", async () => {
    const { cleanup } = setup();
    const report = await cleanup.analyze();
    expect(report.docker).toEqual({ available: true, vmMemBytes: 8217825280 });
    expect(report.findings.map((f) => f.id)).toEqual([
      "docker",
      "volume:old_pgdata",
      `volume:${"a".repeat(64)}`,
      "compose:api",
      "docker-vm",
      "cache:uv",
      "mem:Google Chrome",
      "cpu:Google Chrome",
    ]);
    const byId = new Map(report.findings.map((f) => [f.id, f]));
    expect(byId.get("volume:old_pgdata")).toMatchObject({ risk: "data", title: "Volumen old_pgdata", bytes: 120e6 });
    expect(byId.get("compose:api")?.detail).toContain("CPU 12.9% ahora, levantado hace 1 hora");
    // Something is running: closing Docker Desktop is not offered.
    expect(byId.get("docker-vm")?.action).toBeNull();
  });

  it("with Docker down, the caches and apps still come", async () => {
    const { cleanup } = setup({ docker: false });
    const report = await cleanup.analyze();
    expect(report.docker.available).toBe(false);
    expect(report.findings.map((f) => f.id)).toEqual(["cache:uv", "mem:Google Chrome", "cpu:Google Chrome"]);
  });
});

describe("cleanup", () => {
  it("docker runs the four prunes with their filters and says what df gained", async () => {
    const { cleanup, calls } = setup();
    await cleanup.analyze();
    const report = await cleanup.apply("docker");
    expect(calls).toEqual([
      "docker container prune -f --filter until=24h",
      "docker image prune -f",
      "docker image prune -a -f --filter until=168h",
      "docker builder prune -a -f --filter until=168h",
    ]);
    expect(report.freedBytes).toBe(3e9);
  });

  it("a volume a container started using is not deleted", async () => {
    const { cleanup, calls, useVolume } = setup();
    await cleanup.analyze();
    useVolume();
    await expect(cleanup.apply("volume:old_pgdata")).rejects.toBeInstanceOf(CleanupConflict);
    expect(calls).toEqual([]);
  });

  it("an unused volume is deleted by name", async () => {
    const { cleanup, calls } = setup();
    await cleanup.analyze();
    await cleanup.apply("volume:old_pgdata");
    expect(calls).toEqual(["docker volume rm old_pgdata"]);
  });

  it("a cache is cleaned by its own tool", async () => {
    const { cleanup, calls } = setup();
    await cleanup.analyze();
    await cleanup.apply("cache:uv");
    expect(calls).toEqual([`${HOME}/.local/bin/uv cache clean`]);
  });

  it("a uv cache held by running uv processes is shown without a button", async () => {
    const { cleanup, startUv } = setup();
    startUv(2);
    startUv(1, 0);
    const finding = (await cleanup.analyze()).findings.find((f) => f.id === "cache:uv");
    expect(finding?.action).toBeNull();
    expect(finding?.detail).toContain("2 procesos");
  });

  it("a uv started after the analysis stops the clean instead of hanging on its lock", async () => {
    const { cleanup, calls, startUv } = setup();
    await cleanup.analyze();
    startUv();
    await expect(cleanup.apply("cache:uv")).rejects.toThrow(/1 proceso/);
    expect(calls).toEqual([]);
  });

  it("quitting an app passes its name as an argument, never inside the script", async () => {
    const { cleanup, calls } = setup();
    await cleanup.analyze();
    const report = await cleanup.apply("mem:Google Chrome");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^osascript .*tell application \(item 1 of argv\) to quit.* Google Chrome$/);
    expect(report.freedBytes).toBeNull();
  });

  it("a project is stopped, not removed", async () => {
    const { cleanup, calls } = setup();
    await cleanup.analyze();
    await cleanup.apply("compose:api");
    expect(calls).toEqual(["docker compose -p api stop"]);
  });

  it("an id that is not in the last analysis is refused", async () => {
    const { cleanup, calls } = setup();
    await expect(cleanup.apply("docker")).rejects.toThrow("Vuelve a analizar");
    await cleanup.analyze();
    await expect(cleanup.apply("volume:api_pgdata")).rejects.toBeInstanceOf(CleanupConflict);
    expect(calls).toEqual([]);
  });
});
