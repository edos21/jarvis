import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { localDate } from "../../../shared/dates.js";
import type { ResearchDetail, ResearchInput, ResearchList, ResearchRun, ResearchSubject } from "../../../shared/research.js";
import type { ReadOnlyTool, RunAgent } from "../agent/runner.js";
import { freeName } from "../files.js";
import { OUTPUT_SCHEMA, investigatePrompt, parseReport, satellitePrompt, satellitePromptFrom } from "./prompts.js";
import type { ResearchStore } from "./store.js";

const TOOLS: ReadOnlyTool[] = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export class ResearchBusy extends Error {}
export class SatelliteAlreadyDone extends Error {
  constructor(readonly file: string) {
    super(`${file} already exists`);
  }
}
export class ResearchNotFound extends Error {}

const slug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "analisis";

const titleOf = (subject: ResearchSubject, now: Date): string =>
  subject.type === "ticker"
    ? `Investigar ${subject.symbol}`
    : subject.type === "news"
      ? `Investigar: ${subject.title}`
      : `Satellite pick de ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

// The month a run was made in, not the day it is saved: a pick run on Oct 31 and saved on Nov 1 is October's.
const runDate = (detail: { createdAt: string }): Date => new Date(detail.createdAt);

const freePath = (dir: string, base: string): string => join(dir, freeName(dir, `${base}.md`));

export type ResearchSource = {
  start(input: ResearchInput): ResearchRun;
  list(): ResearchList;
  get(id: number): ResearchDetail | null;
  save(id: number): ResearchDetail;
};

export const createResearchSource = (deps: {
  store: ResearchStore;
  runAgent: RunAgent;
  // The investment notes folder (notes/Inversiones).
  investmentsDir: string;
  now?: () => Date;
}): ResearchSource => {
  const now = deps.now ?? (() => new Date());
  deps.store.failInterrupted(now().toISOString());
  const satelliteFile = (at: Date): string => `satellite-picks-${MONTHS[at.getMonth()]}-${at.getFullYear()}.md`;

  const run = async (id: number, request: { systemPrompt: string; prompt: string }, satellite: boolean): Promise<void> => {
    let costUsd: number | null = null;
    try {
      const { markdown, jarvisNote, levels } = await deps.runAgent({
        label: satellite ? "satellite pick" : "investigate",
        ...request,
        schema: OUTPUT_SCHEMA,
        parse: parseReport,
        model: satellite ? "claude-opus-5-5" : "claude-sonnet-5-5",
        maxBudgetUsd: satellite ? 5 : 1,
        timeoutMs: (satellite ? 30 : 10) * 60_000,
        maxTurns: satellite ? 60 : 25,
        tools: TOOLS,
        readableDirs: [deps.investmentsDir],
        onCost: (usd) => {
          costUsd = usd;
        },
      });
      deps.store.finish(id, {
        markdown,
        jarvisNote,
        suggestedLevels: levels,
        costUsd,
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      deps.store.fail(id, error instanceof Error ? error.message : String(error), now().toISOString());
    }
  };

  return {
    start: ({ kind, subject, confirm }) => {
      if (deps.store.running(kind)) throw new ResearchBusy();
      const at = now();
      const today = localDate(at);
      let request: { systemPrompt: string; prompt: string };
      if (kind === "satellite") {
        const file = satelliteFile(at);
        if (!confirm && existsSync(join(deps.investmentsDir, file))) throw new SatelliteAlreadyDone(file);
        const note = join(deps.investmentsDir, "Satellite Prompt Mensual.md");
        const ownerPrompt = existsSync(note) ? satellitePromptFrom(readFileSync(note, "utf8")) : null;
        if (!ownerPrompt) throw new Error("No encontré la sección '## PROMPT' de 'Satellite Prompt Mensual.md'.");
        request = satellitePrompt(ownerPrompt, deps.investmentsDir, today);
      } else {
        request = investigatePrompt(subject, deps.investmentsDir, today);
      }
      const created = deps.store.create({
        kind,
        subject: kind === "satellite" ? { type: "satellite" } : subject,
        title: titleOf(kind === "satellite" ? { type: "satellite" } : subject, at),
        createdAt: at.toISOString(),
      });
      // In the background: the page polls while it runs.
      void run(created.id, request, kind === "satellite");
      return created;
    },

    list: () => {
      const file = satelliteFile(now());
      return { runs: deps.store.list(30), satelliteThisMonth: existsSync(join(deps.investmentsDir, file)) ? file : null };
    },

    get: (id) => deps.store.get(id),

    save: (id) => {
      const detail = deps.store.get(id);
      if (!detail?.markdown) throw new ResearchNotFound();
      const at = runDate(detail);
      const investigations = join(deps.investmentsDir, "investigaciones");
      if (detail.kind === "investigate") mkdirSync(investigations, { recursive: true });
      const path =
        detail.kind === "satellite"
          ? freePath(deps.investmentsDir, satelliteFile(at).replace(/\.md$/, ""))
          : freePath(investigations, `${localDate(at)}-${slug(detail.title)}`);
      const header = `> Generado por Jarvis el ${localDate(now())}${detail.costUsd ? ` (US$ ${detail.costUsd.toFixed(2)})` : ""}.\n\n`;
      // "wx" fails instead of overwriting, even if the name was taken between the check and the write.
      writeFileSync(path, header + detail.markdown, { mode: 0o600, flag: "wx" });
      const savedPath = relative(join(deps.investmentsDir, ".."), path);
      deps.store.markSaved(id, savedPath);
      return { ...detail, savedPath };
    },
  };
};
