import { createHash } from "node:crypto";

import type { BriefingStatus } from "../../../shared/today.js";
import type { RunAgent } from "../agent/runner.js";
import type { TodayWithoutBriefing } from "./build.js";

export const BRIEFING_MODEL = "claude-haiku-5-5";

const SYSTEM_PROMPT = `Eres Jarvis, el asistente personal de Edu: un mayordomo de la vieja escuela que ya leyó todo
antes de que él despierte. Escribes el parte del día que abre su panel.
Reglas:
- 1 a 3 oraciones, en español latino neutro, tratándolo de "usted". Nunca voseo ("tenés", "podés", "elegí").
- No saludes ni pongas la fecha: el panel ya lo hace.
- Empieza por lo más urgente y agrupa lo menor ("y un par de asuntos menores de la Mac").
- Tono sobrio, preciso y cortés, con ingenio seco: como mucho una pincelada de ironía, y solo si los datos la dan.
  Nunca payaso, nunca empalagoso. Sin emojis, sin listas, sin markdown.
- Usa solo los datos que te paso. Si no hay nada urgente, dilo en una oración tranquila.`;

const SCHEMA = {
  type: "object",
  properties: { briefing: { type: "string", minLength: 1, maxLength: 500 } },
  required: ["briefing"],
  additionalProperties: false,
};

// Only titles, severities and counts: card details and actions (where account numbers live) never reach Claude.
export const briefingPrompt = (today: TodayWithoutBriefing): string => {
  const lines = today.cards.map((c) => `- [${c.severity}] ${c.title}`);
  const work = today.side.work;
  if (work) {
    lines.push(
      work.pepper.reachable
        ? `- Trabajo: ${work.pepper.factoryInProgress} tickets en curso en las fábricas`
        : "- Trabajo: Pepper no responde",
      `- PRs abiertos: ${work.prs === null ? "no se pudieron leer" : work.prs.length}`,
    );
  }
  return `Hoy es ${today.dateLabel}. Lo que hay:\n${lines.length > 0 ? lines.join("\n") : "- Nada pendiente"}`;
};

export type BriefingState = { briefing: string | null; briefingStatus: BriefingStatus };

export type BriefingWriter = {
  current(today: TodayWithoutBriefing): BriefingState;
  // Whether this text is a briefing Jarvis wrote recently: the only text the voice route agrees to speak.
  wrote(text: string): boolean;
};

// Never blocks the Today view: returns what it has and writes a new briefing in the background when the data changed.
// A failure (no token yet, a network blip) is tried again after this long instead of waiting for the data to change.
const RETRY_FAILED_MS = 10 * 60_000;
// A source that has not answered yet (cold after a restart, slower than the timeout) is usually back on the page's next
// poll: a briefing written meanwhile would be replaced seconds later. One that stays down this long is written without.
const INCOMPLETE_GRACE_MS = 15_000;

export const createBriefingWriter = (
  run: RunAgent,
  now: () => number = Date.now,
  // One line per briefing written, never its text or the cards: how many a day cost, and which ones lacked a source.
  log: (line: string) => void = console.log,
): BriefingWriter => {
  const written = new Map<string, { text: string | null; at: number }>();
  // Yesterday's text is not shown while today's is written: it would only change in front of me.
  let latest: { text: string; day: string } | null = null;
  const inFlight = new Set<string>();
  const heldSince = new Map<string, number>();
  // Each distinct day state is a few hundred bytes; keep the recent ones only.
  const remember = (hash: string, text: string | null): void => {
    written.set(hash, { text, at: now() });
    if (written.size > 50) written.delete(written.keys().next().value as string);
  };

  const write = (hash: string, prompt: string, today: TodayWithoutBriefing): void => {
    inFlight.add(hash);
    run({
      label: "briefing",
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: SCHEMA,
      parse: (output) => {
        const text = (output as { briefing?: unknown } | null)?.briefing;
        if (typeof text !== "string" || text.trim() === "") throw new Error("briefing: empty answer");
        return text.trim();
      },
      model: BRIEFING_MODEL,
      maxBudgetUsd: 0.05,
      timeoutMs: 20_000,
    })
      .then((text) => {
        remember(hash, text);
        latest = { text, day: today.dateLabel };
        const missing = today.sourceErrors.length > 0 ? `, without ${today.sourceErrors.join(", ")}` : "";
        log(`briefing written at ${new Date(now()).toISOString()}${missing}`);
      })
      .catch((error: unknown) => {
        console.error(`briefing failed: ${error instanceof Error ? error.message : String(error)}`);
        remember(hash, null);
      })
      .finally(() => inFlight.delete(hash));
  };

  return {
    wrote: (text) => [...written.values()].some((entry) => entry.text === text),
    current: (today) => {
      const prompt = briefingPrompt(today);
      // Percentages move all day (memory, CPU), an event countdown every minute and the unread count with each
      // newsletter; none alone is a new day worth another paragraph.
      const stable = prompt
        .replace(/\d+(?:[.,]\d+)?%/g, "%")
        .replace(/(En \d+ min|Ahora): /g, "Pronto: ")
        .replace(/Correo: \d+ sin leer/g, "Correo: sin leer");
      const hash = createHash("sha256").update(`${stable}\nmissing: ${today.sourceErrors.join(",")}`).digest("hex");
      const known = written.get(hash);
      if (known?.text) return { briefing: known.text, briefingStatus: "ready" };
      if (known && now() - known.at < RETRY_FAILED_MS) return { briefing: null, briefingStatus: "unavailable" };
      const pending: BriefingState = { briefing: latest?.day === today.dateLabel ? latest.text : null, briefingStatus: "pending" };
      if (inFlight.has(hash)) return pending;
      if (today.sourceErrors.length > 0) {
        const since = heldSince.get(hash) ?? now();
        if (heldSince.size > 50) heldSince.clear();
        heldSince.set(hash, since);
        if (now() - since < INCOMPLETE_GRACE_MS) return pending;
      }
      heldSince.delete(hash);
      write(hash, prompt, today);
      return pending;
    },
  };
};
