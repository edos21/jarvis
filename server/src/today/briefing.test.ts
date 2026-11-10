import { describe, expect, it } from "vitest";

import { EMPTY_WALLET } from "../../../shared/wallet.js";
import type { AgentRequest } from "../agent/runner.js";
import { type TodayWithoutBriefing, buildToday } from "./build.js";
import { briefingPrompt, createBriefingWriter } from "./briefing.js";

const today: TodayWithoutBriefing = {
  greeting: "Buenos días, Edu.",
  dateLabel: "Viernes 30 de octubre",
  cards: [
    {
      key: "payment:1:2026-10",
      severity: "critical",
      source: "payments",
      title: "Pagar Alquiler · vence hoy",
      detail: "Banco Uno · 1234 5678 4821 · USD 950",
      actions: [{ kind: "copy", label: "Copiar cuenta", text: "1234 5678 4821" }],
    },
  ],
  side: { agenda: null, wallet: null, work: null, mac: null },
  sourceErrors: [],
  generatedAt: "2026-10-30T11:42:00Z",
};

const fakeRun = (answer: string | Error) => {
  const prompts: string[] = [];
  const run = async <T>(req: AgentRequest<T>): Promise<T> => {
    prompts.push(req.systemPrompt + req.prompt);
    if (answer instanceof Error) throw answer;
    return req.parse({ briefing: answer });
  };
  return { run, prompts };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("briefing", () => {
  it("briefing prompt never contains an account number", () => {
    const prompt = briefingPrompt(today);
    expect(prompt).toContain("Pagar Alquiler · vence hoy");
    expect(prompt).not.toContain("5678");
    expect(prompt).not.toContain("4821");
  });

  it("asks for Jarvis's formal voice, never voseo", async () => {
    const systemPrompts: string[] = [];
    const run = async <T>(req: AgentRequest<T>): Promise<T> => {
      systemPrompts.push(req.systemPrompt);
      return req.parse({ briefing: "Texto." });
    };
    createBriefingWriter(run).current(today);
    await flush();
    expect(systemPrompts[0]).toContain('"usted"');
    expect(systemPrompts[0]).toContain("Nunca voseo");
  });

  it("is pending first, then ready with the agent's text", async () => {
    const { run } = fakeRun("Hoy vence el alquiler.");
    const writer = createBriefingWriter(run);
    expect(writer.current(today)).toEqual({ briefing: null, briefingStatus: "pending" });
    await flush();
    expect(writer.current(today)).toEqual({ briefing: "Hoy vence el alquiler.", briefingStatus: "ready" });
  });

  it("knows only the texts it wrote", async () => {
    const { run } = fakeRun("Hoy vence el alquiler.");
    const writer = createBriefingWriter(run);
    expect(writer.wrote("Hoy vence el alquiler.")).toBe(false);
    writer.current(today);
    await flush();
    expect(writer.wrote("Hoy vence el alquiler.")).toBe(true);
    expect(writer.wrote("Otro texto.")).toBe(false);
  });

  it("briefing cached for identical input", async () => {
    const { run, prompts } = fakeRun("Texto.");
    const writer = createBriefingWriter(run);
    writer.current(today);
    await flush();
    writer.current({ ...today, generatedAt: "2026-10-30T11:50:00Z" });
    writer.current(today);
    expect(prompts).toHaveLength(1);
  });

  it("keeps the previous text while a new one is written", async () => {
    const { run } = fakeRun("Primero.");
    const writer = createBriefingWriter(run);
    writer.current(today);
    await flush();
    const changed = { ...today, cards: [] };
    expect(writer.current(changed)).toEqual({ briefing: "Primero.", briefingStatus: "pending" });
  });

  it("briefing unavailable when the agent throws", async () => {
    const { run } = fakeRun(new Error("CLAUDE_CODE_OAUTH_TOKEN is not set"));
    const writer = createBriefingWriter(run);
    writer.current(today);
    await flush();
    expect(writer.current(today)).toEqual({ briefing: null, briefingStatus: "unavailable" });
  });
});

describe("briefing costs", () => {
  it("a moving percentage does not write a new briefing", async () => {
    const { run, prompts } = fakeRun("Texto.");
    const writer = createBriefingWriter(run);
    const withMemory = (pct: number) => ({
      ...today,
      cards: [{ ...today.cards[0]!, key: "mac:memory", title: `Memoria al ${pct}%` }],
    });
    writer.current(withMemory(91));
    await flush();
    expect(writer.current(withMemory(93))).toEqual({ briefing: "Texto.", briefingStatus: "ready" });
    expect(prompts).toHaveLength(1);
  });

  it("a growing unread count does not write a new briefing", async () => {
    const { run, prompts } = fakeRun("Texto.");
    const writer = createBriefingWriter(run);
    const withUnread = (n: number) => ({
      ...today,
      cards: [{ ...today.cards[0]!, key: "mail:rest:me", title: `Correo: ${n} sin leer` }],
    });
    writer.current(withUnread(12));
    await flush();
    expect(writer.current(withUnread(13))).toEqual({ briefing: "Texto.", briefingStatus: "ready" });
    expect(prompts).toHaveLength(1);
  });

  it("a failed briefing is retried after ten minutes", async () => {
    let clock = 0;
    let fail = true;
    const prompts: string[] = [];
    const run = async <T>(req: AgentRequest<T>): Promise<T> => {
      prompts.push(req.prompt);
      if (fail) throw new Error("offline");
      return req.parse({ briefing: "Ya está." });
    };
    const writer = createBriefingWriter(run, () => clock);
    writer.current(today);
    await flush();
    expect(writer.current(today).briefingStatus).toBe("unavailable");
    fail = false;
    clock = 10 * 60_000;
    writer.current(today);
    await flush();
    expect(writer.current(today)).toEqual({ briefing: "Ya está.", briefingStatus: "ready" });
    expect(prompts).toHaveLength(2);
  });
});

describe("briefing privacy and churn", () => {
  it("briefing prompt has the sender name but not the subject", () => {
    const withMail = buildToday(
      {
        payments: [],
        wallet: EMPTY_WALLET,
        mac: new Error("x"),
        work: new Error("x"),
        agenda: { items: [], tasks: [], reconnect: [] },
        mail: {
          mailboxes: [
            {
              account: "me@gmail.com",
              snapshotId: "s",
              reconnect: false,
              groups: [
                {
                  kind: "person",
                  items: [{ id: "m1", threadId: "t", from: "ana@gmail.com", fromName: "Ana Pérez", subject: "Resultados del médico", date: "", url: "u" }],
                },
              ],
            },
          ],
        },
      },
      new Date(2026, 9, 31, 9),
      { remote: false },
    );
    const prompt = briefingPrompt(withMail);
    expect(prompt).toContain("Ana Pérez");
    expect(prompt).not.toContain("Resultados del médico");
  });

  it("an event countdown ticking does not write a new briefing", async () => {
    const { run, prompts } = fakeRun("Texto.");
    const writer = createBriefingWriter(run);
    const soon = (min: number) => ({
      ...today,
      cards: [{ ...today.cards[0]!, key: "event:e1", source: "agenda" as const, title: `En ${min} min: Dentista` }],
    });
    writer.current(soon(48));
    await flush();
    expect(writer.current(soon(43)).briefingStatus).toBe("ready");
    expect(prompts).toHaveLength(1);
  });
});

describe("briefing on incomplete data", () => {
  const missingMac: TodayWithoutBriefing = { ...today, cards: [], sourceErrors: ["mac"] };

  it("waits while a source has not answered, then writes once with everything", async () => {
    const { run, prompts } = fakeRun("Completo.");
    const writer = createBriefingWriter(run, () => 0, () => undefined);
    expect(writer.current(missingMac)).toEqual({ briefing: null, briefingStatus: "pending" });
    await flush();
    expect(prompts).toHaveLength(0);
    writer.current(today);
    await flush();
    expect(writer.current(today)).toEqual({ briefing: "Completo.", briefingStatus: "ready" });
    expect(prompts).toHaveLength(1);
  });

  it("writes without a source that stays down past the grace period", async () => {
    let clock = 0;
    const { run, prompts } = fakeRun("Sin la Mac.");
    const writer = createBriefingWriter(run, () => clock, () => undefined);
    writer.current(missingMac);
    clock = 10_000;
    writer.current(missingMac);
    await flush();
    expect(prompts).toHaveLength(0);
    clock = 16_000;
    writer.current(missingMac);
    await flush();
    expect(writer.current(missingMac)).toEqual({ briefing: "Sin la Mac.", briefingStatus: "ready" });
    expect(prompts).toHaveLength(1);
  });

  it("a briefing from another day is not shown while today's is written", async () => {
    const { run } = fakeRun("Ayer.");
    const writer = createBriefingWriter(run, () => 0, () => undefined);
    writer.current(today);
    await flush();
    const nextDay = { ...today, dateLabel: "Sábado 31 de octubre" };
    expect(writer.current(nextDay)).toEqual({ briefing: null, briefingStatus: "pending" });
  });

  it("logs each briefing written with the missing sources, never the cards", async () => {
    let clock = 0;
    const lines: string[] = [];
    const { run } = fakeRun("Texto.");
    const writer = createBriefingWriter(run, () => clock, (line) => lines.push(line));
    writer.current(today);
    await flush();
    writer.current(missingMac);
    clock = 16_000;
    writer.current(missingMac);
    await flush();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^briefing written at .+Z$/);
    expect(lines[1]).toMatch(/without mac$/);
    expect(lines.join("\n")).not.toContain("Alquiler");
  });
});
