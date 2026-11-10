import type { SuggestedLevel } from "./wallet.js";

export type ResearchKind = "investigate" | "satellite";

// What to investigate: a held ticker (with its move, if that triggered it) or a headline. The satellite pick has none.
export type ResearchSubject =
  | { type: "ticker"; symbol: string; context?: string }
  | { type: "news"; title: string; url: string }
  | { type: "satellite" };

export type ResearchStatus = "running" | "done" | "failed";

export type ResearchRun = {
  id: number;
  kind: ResearchKind;
  subject: ResearchSubject;
  title: string;
  status: ResearchStatus;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
  // Where "Guardar en notas" wrote it, relative to the notes folder.
  savedPath: string | null;
};

// jarvisNote: Jarvis's aside on the report, shown next to it and never saved to the notes with it.
export type ResearchDetail = ResearchRun & {
  markdown: string | null;
  jarvisNote: string | null;
  suggestedLevels: SuggestedLevel[];
};

// satelliteThisMonth: the notes file of this month's satellite pick, when it already exists.
export type ResearchList = { runs: ResearchRun[]; satelliteThisMonth: string | null };

export type ResearchInput = { kind: ResearchKind; subject: ResearchSubject; confirm?: boolean };
