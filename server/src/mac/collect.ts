import type { MacStatus, StuckProcess } from "../../../shared/mac.js";

export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

const DAY_MS = 86_400_000;
// softwareupdate -l talks to Apple's servers and takes tens of seconds.
const UPDATES_TTL_MS = 6 * 60 * 60 * 1000;
// A process above this on two readings in a row is runaway, not just busy for a moment.
const RUNAWAY_CPU_PCT = 90;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export const parseBoottime = (text: string, now: Date): number => {
  const sec = Number(/sec = (\d+)/.exec(text)?.[1]);
  if (!Number.isFinite(sec)) throw new Error("kern.boottime has no sec field");
  return Math.floor((now.getTime() - sec * 1000) / DAY_MS);
};

// Memory in use the way Activity Monitor counts it: app (active), wired and compressed pages.
export const parseMemPct = (vmStat: string, memsize: number): number => {
  const pageSize = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1]);
  const pages = (label: string): number => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vmStat)?.[1] ?? 0);
  const used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor");
  return round1(((used * pageSize) / memsize) * 100);
};

// top prints the first sample since boot; the second one is the current load.
export const parseCpuPct = (top: string): number => {
  const idles = [...top.matchAll(/CPU usage:.*?([\d.]+)% idle/g)].map((m) => Number(m[1]));
  const idle = idles.at(-1);
  if (idle === undefined) throw new Error("top printed no CPU usage line");
  return round1(100 - idle);
};

// df -k: the last row's available column is in KiB.
const dfRow = (df: string): string[] => df.trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];

export const parseDfFreeBytes = (df: string): number => {
  const available = Number(dfRow(df)[3]);
  if (!Number.isFinite(available)) throw new Error("unexpected df output");
  return available * 1024;
};

const DATA_DISK = "/System/Volumes/Data";

// Free space on the data volume, or null when df cannot be read: before and after a cleanup.
export const readFreeBytes = (run: CommandRunner): Promise<number | null> =>
  run("df", ["-k", DATA_DISK])
    .then(parseDfFreeBytes)
    .catch(() => null);

export const parseDisk = (df: string): { diskPct: number; diskFreeGb: number } => {
  const capacity = Number(dfRow(df)[4]?.replace("%", ""));
  if (!Number.isFinite(capacity)) throw new Error("unexpected df output");
  return { diskPct: capacity, diskFreeGb: round1(parseDfFreeBytes(df) / 1e9) };
};

export const parseUpdates = (text: string): string[] =>
  [...text.matchAll(/Title: (.+?), Version:/g)].map((m) => {
    const title = m[1] ?? "";
    const version = /Version: ([^,]+)/.exec(text.slice(m.index))?.[1] ?? "";
    return title.includes(version) ? title : `${title} ${version}`;
  });

export type ProcessRow = { pid: number; uid: number; stat: string; cpuPct: number; name: string };

export const PS_ARGS = ["-Ao", "pid,uid,stat,%cpu,comm"];

export const parseProcesses = (ps: string): ProcessRow[] =>
  ps
    .trim()
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(.+)$/.exec(line);
      return m
        ? [{ pid: Number(m[1]), uid: Number(m[2]), stat: m[3] ?? "", cpuPct: Number(m[4]), name: m[5] ?? "" }]
        : [];
    });

export type MacCollector = { collect(): Promise<MacStatus> };

// Only my own processes are flagged: a system daemon is not mine to kill, and Jarvis could not signal it anyway.
export const createMacCollector = (
  run: CommandRunner,
  now: () => Date = () => new Date(),
  uid: number = process.getuid?.() ?? -1,
): MacCollector => {
  let updates: { value: string[] | null; at: number } | null = null;
  let checkingUpdates: Promise<void> | null = null;
  // A process can be in U or above the CPU threshold for an instant; only two readings in a row (a minute apart,
  // the Mac source caches for that long) mean it is stuck.
  let hotLastTime = new Set<number>();
  let waitingLastTime = new Set<number>();

  // Never awaited by collect(): the first readings go out without updates rather than wait for Apple's servers.
  const readUpdates = (): string[] | null => {
    const at = now().getTime();
    if ((!updates || at - updates.at >= UPDATES_TTL_MS) && !checkingUpdates) {
      checkingUpdates = run("softwareupdate", ["-l"])
        .then((text) => parseUpdates(text))
        .catch(() => null)
        .then((value) => {
          updates = { value, at: now().getTime() };
        })
        .finally(() => {
          checkingUpdates = null;
        });
    }
    return updates?.value ?? null;
  };

  const stuckFrom = (rows: ProcessRow[]): StuckProcess[] => {
    const hot = new Set(rows.filter((r) => r.cpuPct >= RUNAWAY_CPU_PCT).map((r) => r.pid));
    const waiting = new Set(rows.filter((r) => r.stat.startsWith("U")).map((r) => r.pid));
    const stuck = rows.flatMap((r): StuckProcess[] => {
      if (waiting.has(r.pid) && waitingLastTime.has(r.pid)) return [{ pid: r.pid, name: r.name, reason: "uninterruptible", cpuPct: r.cpuPct }];
      if (r.stat.startsWith("Z")) return [{ pid: r.pid, name: r.name, reason: "zombie", cpuPct: r.cpuPct }];
      if (hot.has(r.pid) && hotLastTime.has(r.pid)) {
        return [{ pid: r.pid, name: r.name, reason: "runaway_cpu", cpuPct: r.cpuPct }];
      }
      return [];
    });
    hotLastTime = hot;
    waitingLastTime = waiting;
    return stuck;
  };

  return {
    collect: async () => {
      const pending = readUpdates();
      const [boottime, memsize, vmStat, top, df, ps] = await Promise.all([
        run("sysctl", ["-n", "kern.boottime"]),
        run("sysctl", ["-n", "hw.memsize"]),
        run("vm_stat", []),
        run("top", ["-l", "2", "-n", "0", "-s", "1"]),
        run("df", ["-k", "/System/Volumes/Data"]),
        run("ps", PS_ARGS),
      ]);
      const at = now();
      return {
        cpuPct: parseCpuPct(top),
        memPct: parseMemPct(vmStat, Number(memsize.trim())),
        ...parseDisk(df),
        uptimeDays: parseBoottime(boottime, at),
        updates: pending,
        stuck: stuckFrom(parseProcesses(ps).filter((r) => r.uid === uid)),
        collectedAt: at.toISOString(),
      };
    },
  };
};
