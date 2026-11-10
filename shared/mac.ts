import { oneOf } from "./choices.js";

export type StuckReason = "uninterruptible" | "zombie" | "runaway_cpu";

export type StuckProcess = { pid: number; name: string; reason: StuckReason; cpuPct: number };

export type MacStatus = {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  diskFreeGb: number;
  uptimeDays: number;
  // Titles of the pending updates; null when softwareupdate could not be read.
  updates: string[] | null;
  stuck: StuckProcess[];
  collectedAt: string;
};

export type Severity = "critical" | "warning" | "info";

export type MacCta =
  | { kind: "open_url"; url: string }
  | { kind: "open_app"; app: "Activity Monitor" }
  | { kind: "kill"; pid: number; name: string };

export type MacSuggestion = { key: string; severity: Severity; title: string; detail: string; cta: MacCta | null };

export type MacResponse = { status: MacStatus; suggestions: MacSuggestion[] };

export const MAC_RANGES = ["24h", "7d", "30d"] as const;

export type MacRange = (typeof MAC_RANGES)[number];

export const isMacRange = oneOf(MAC_RANGES);

// How often the history keeps a reading of the Mac.
export const MAC_SAMPLE_MINUTES = 10;

export type MacSample = { at: string; cpuPct: number; memPct: number; diskPct: number };

// An interactive Claude Code session, as Claude Code records it while it runs.
export type ClaudeSession = { sessionId: string; cwd: string; name: string | null };

export type ClaudeSessionsResponse = {
  open: ClaudeSession[];
  // When "Preparar reinicio" last saved the open sessions; null when nothing is saved.
  preparedAt: string | null;
  // Saved sessions that are not running now: what "Retomar" brings back after the restart.
  toResume: ClaudeSession[];
};

export const CACHE_TOOLS = ["npm", "pip", "uv", "brew"] as const;

export type CacheTool = (typeof CACHE_TOOLS)[number];

// What a finding lets me do. The page only sends a finding's id back: the server reads the action from its own report.
export type CleanupAction =
  | { kind: "docker_prune" }
  | { kind: "docker_volume"; name: string }
  | { kind: "cache"; tool: CacheTool }
  | { kind: "quit_app"; app: string }
  | { kind: "compose_stop"; project: string };

export type CleanupArea = "disk" | "memory" | "cpu";

export type CleanupFinding = {
  id: string;
  area: CleanupArea;
  title: string;
  detail: string;
  // Space it frees, or memory it holds, when that can be measured.
  bytes: number | null;
  action: CleanupAction | null;
  // "data": what it deletes does not come back (a volume holds a database).
  risk: "safe" | "data";
};

export type CleanupReport = {
  analyzedAt: string;
  docker: { available: boolean; vmMemBytes: number | null };
  findings: CleanupFinding[];
  // Set right after a cleanup: free disk space gained, measured with df.
  freedBytes: number | null;
};

// Mole (`mo`, installed with Homebrew) adds a disk explorer and a deep cleanup. Everything that deletes is shown as
// a dry run first, and the deletion only acts on a preview this recent.
export const MOLE_PREVIEW_TTL_MINUTES = 15;

export type MoleStatus = { available: boolean; version: string | null };

export type ScanStatus = "complete" | "partial" | "unavailable";

export type DiskEntry = { name: string; path: string; bytes: number; isDir: boolean; insight: boolean; cleanable: boolean };

export type DiskView = {
  analyzedAt: string;
  // null: the overview of the whole Mac.
  path: string | null;
  scanStatus: ScanStatus;
  totalBytes: number;
  entries: DiskEntry[];
  largeFiles: { name: string; path: string; bytes: number }[];
  // The folders opened to get here, from the overview down, so the page can go back.
  trail: { name: string; path: string }[];
};

// "clean": the run deletes it. "review": Mole only points at it (Docker, Hugging Face, `mo purge`). "skipped": Mole
// left it out (the Trash without Full Disk Access, a whitelisted path).
export type CleanRowKind = "clean" | "review" | "skipped";

export type CleanRow = { text: string; bytes: number | null; kind: CleanRowKind };

// bytes: what the section's "clean" rows add up to. Mole's rows can overlap, so the sections may add up to more
// than the preview's total.
export type CleanSection = { name: string; bytes: number; rows: CleanRow[]; topPaths: { path: string; bytes: number }[] };

export type CleanPreview = {
  id: string;
  previewedAt: string;
  potentialBytes: number | null;
  items: number | null;
  sections: CleanSection[];
  // The run would empty the Trash: the page refuses to clean until Mole's whitelist protects it.
  emptiesTrash: boolean;
  // Without a sudo session Mole leaves the system caches out, in the preview and in the run.
  skippedSystem: boolean;
};

export type InstallerFile = { path: string; name: string; bytes: number; folder: string };

export type InstallerPreview = { id: string; previewedAt: string; files: InstallerFile[]; totalBytes: number };

export type MoleRun = {
  kind: "clean" | "installers";
  at: string;
  // What the preview said, what the run says it removed, and what df saw come back.
  estimatedBytes: number | null;
  removedBytes: number | null;
  freedBytes: number | null;
  // Installers that changed after the preview and were left where they are.
  skipped: string[];
  // false: `mo clean` ended without saying it finished; part of it may have run.
  complete: boolean;
};

export type MoleReport = {
  mole: MoleStatus;
  disk: DiskView | null;
  clean: CleanPreview | null;
  installers: InstallerPreview | null;
  lastRun: MoleRun | null;
};
