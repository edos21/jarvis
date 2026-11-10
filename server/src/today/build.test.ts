import { describe, expect, it } from "vitest";

import type { MacResponse } from "../../../shared/mac.js";
import type { DuePayment } from "../../../shared/payments.js";
import { EMPTY_WALLET } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";
import { buildToday } from "./build.js";

const now = new Date(2026, 9, 30, 8, 42);

const google = { agenda: { items: [], tasks: [], reconnect: [] }, mail: { mailboxes: [] }, wallet: EMPTY_WALLET };

const rent: DuePayment = {
  id: 1,
  name: "Alquiler",
  amount: 950,
  currency: "USD",
  dueDay: 30,
  link: "https://bank.example",
  accountLabel: "Banco Uno",
  accountNumber: "1234 5678 4821",
  active: true,
  createdOn: "2026-01-01",
  period: "2026-10",
  dueDate: "2026-10-30",
  status: "due_today",
};

const mac: MacResponse = {
  status: {
    cpuPct: 20,
    memPct: 70,
    diskPct: 95,
    diskFreeGb: 20,
    uptimeDays: 3,
    updates: [],
    stuck: [],
    collectedAt: now.toISOString(),
  },
  suggestions: [
    { key: "disk", severity: "critical", title: "Disco al 95%", detail: "…", cta: null },
    {
      key: "stuck:9",
      severity: "warning",
      title: "x parece colgado",
      detail: "…",
      cta: { kind: "kill", pid: 9, name: "x" },
    },
  ],
};

const work: WorkSummary = {
  pepper: {
    reachable: true,
    boardUrl: "http://127.0.0.1:4318",
    decisions: 2,
    factoryWaiting: [
      { identifier: "ENG-9", title: "Fix", factory: "Atlas", stage: "necesita ingeniero", url: "https://factory.example.com/atlas/ENG-9" },
    ],
    factoryInProgress: 1,
    toVerify: [],
  },
  prs: [
    { url: "https://github.com/acme/api/pull/1", repo: "api", title: "fix", draft: false, ci: "failing", review: "pending" },
  ],
  collectedAt: now.toISOString(),
};

describe("buildToday", () => {
  it("orders critical before warning, and payments before mac at equal severity", () => {
    const today = buildToday({ ...google, payments: [rent], mac, work }, now, { remote: false });
    expect(today.cards.map((c) => [c.source, c.severity])).toEqual([
      ["payments", "critical"],
      ["mac", "critical"],
      ["work", "warning"],
      ["work", "warning"],
      ["mac", "warning"],
      ["work", "info"],
    ]);
  });

  it("payment card copies the account and marks the period paid", () => {
    const [card] = buildToday({ ...google, payments: [rent], mac: new Error("x"), work: new Error("x") }, now, { remote: false }).cards;
    expect(card?.actions).toEqual([
      { kind: "copy", label: "Copiar cuenta", text: "1234 5678 4821" },
      { kind: "link", label: "Abrir", url: "https://bank.example" },
      { kind: "mark_paid", label: "Pagado", paymentId: 1, period: "2026-10" },
    ]);
  });

  it("remote never carries the full account and offers no kill", () => {
    const today = buildToday({ ...google, payments: [rent], mac, work }, now, { remote: true });
    expect(JSON.stringify(today)).not.toContain("5678");
    expect(today.cards.find((c) => c.source === "payments")?.detail).toContain("••• 4821");
    expect(today.cards.flatMap((c) => c.actions).some((a) => a.kind === "mac_cta" && a.cta.kind === "kill")).toBe(false);
    expect(JSON.stringify(today.cards)).not.toContain("127.0.0.1:4318");
  });

  it("failed source goes to sourceErrors and others still render", () => {
    const today = buildToday({ ...google, payments: [rent], mac: new Error("top failed"), work }, now, { remote: false });
    expect(today.sourceErrors).toEqual(["mac"]);
    expect(today.side.mac).toBeNull();
    expect(today.cards.some((c) => c.source === "payments")).toBe(true);
  });

  it("pepper unreachable adds no work cards but keeps PRs", () => {
    const down: WorkSummary = { ...work, pepper: { ...work.pepper, reachable: false, decisions: 0, factoryWaiting: [] } };
    const cards = buildToday({ ...google, payments: [], mac: new Error("x"), work: down }, now, { remote: false }).cards;
    expect(cards.map((c) => c.key)).toEqual(["pr:https://github.com/acme/api/pull/1"]);
  });

  it("greets by the time of day in Spanish", () => {
    const at = (h: number) => buildToday({ ...google, payments: [], mac, work }, new Date(2026, 9, 30, h), { remote: false });
    expect(at(8).greeting).toBe("Buenos días, Edu.");
    expect(at(15).greeting).toBe("Buenas tardes, Edu.");
    expect(at(22).greeting).toBe("Buenas noches, Edu.");
    expect(at(8).dateLabel).toBe("Viernes 30 de octubre");
  });
});

describe("mail and agenda in Today", () => {
  const mail = {
    mailboxes: [
      {
        account: "me@gmail.com",
        snapshotId: "s1",
        reconnect: false,
        groups: [
          {
            kind: "person" as const,
            items: [
              {
                id: "m1",
                threadId: "t1",
                from: "ana@gmail.com",
                fromName: "Ana Pérez",
                subject: "¿Almorzamos?",
                date: "",
                url: "https://mail.google.com/mail/?authuser=me%40gmail.com#inbox/t1",
              },
            ],
          },
          { kind: "newsletter" as const, items: [{ id: "n1", threadId: "t", from: "", fromName: "", subject: "", date: "", url: "" }] },
          { kind: "invoice" as const, items: [{ id: "i1", threadId: "t", from: "", fromName: "", subject: "", date: "", url: "" }] },
        ],
      },
    ],
  };

  const inputWith = (over: object) => ({ ...google, payments: [], mac: new Error("x"), work: new Error("x"), ...over });

  it("a person email becomes a warning card with open and archive", () => {
    const [card] = buildToday(inputWith({ mail }), now, { remote: false }).cards;
    expect(card).toMatchObject({ severity: "warning", source: "mail", title: "Te escribió Ana Pérez", detail: "¿Almorzamos?" });
    expect(card?.actions.map((a) => a.kind)).toEqual(["link", "not_person", "archive_mail"]);
  });

  it("other groups collapse into one info card", () => {
    const cards = buildToday(inputWith({ mail }), now, { remote: false }).cards;
    expect(cards[1]).toMatchObject({ severity: "info", title: "Correo: 2 sin leer", detail: "1 newsletters · 1 facturas" });
  });

  it("event within 60 minutes is a card; later or all-day ones are not", () => {
    const at = (h: number, m: number) => new Date(2026, 9, 30, h, m).toISOString();
    const agenda = {
      reconnect: [], tasks: [],
      items: [
        { id: "soon", title: "Dentista", start: at(9, 30), end: at(10, 0), allDay: false, location: "Av. Brasil", url: "u" },
        { id: "later", title: "Gym", start: at(19, 0), end: at(20, 0), allDay: false, location: null, url: "u" },
        { id: "day", title: "Feriado", start: "2026-10-30", end: "2026-10-31", allDay: true, location: null, url: "u" },
      ],
    };
    const cards = buildToday(inputWith({ agenda }), now, { remote: false }).cards;
    expect(cards.map((c) => c.title)).toEqual(["En 48 min: Dentista"]);
    const during = buildToday(inputWith({ agenda }), new Date(2026, 9, 30, 9, 45), { remote: false }).cards;
    expect(during.map((c) => c.title)).toEqual(["Ahora: Dentista"]);
  });

  it("an overdue task is a warning card with mark done; one due today is info", () => {
    const task = { listId: "L1", account: "me@gmail.com", url: "https://tasks.google.com/", ruleId: null };
    const agenda = {
      items: [],
      reconnect: [],
      tasks: [
        { ...task, id: "late", title: "Pagar UTE", due: "2026-10-28", overdue: true },
        { ...task, id: "today", title: "Llamar al banco", due: "2026-10-30", overdue: false, ruleId: 4 },
      ],
    };
    const cards = buildToday(inputWith({ agenda }), now, { remote: false }).cards;
    expect(cards.map((c) => [c.severity, c.title, c.detail])).toEqual([
      ["warning", "Tarea vencida: Pagar UTE", "Vencía el 28 de octubre"],
      ["info", "Para hoy: Llamar al banco", "↻ se repite"],
    ]);
    expect(cards[0]?.actions).toEqual([
      { kind: "link", label: "Abrir en Tasks", url: "https://tasks.google.com/" },
      { kind: "postpone_task", label: "Mañana", account: "me@gmail.com", listId: "L1", taskId: "late" },
      { kind: "complete_task", label: "Marcar hecha", account: "me@gmail.com", listId: "L1", taskId: "late" },
    ]);
  });

  it("wallet alerts become cards that link to the wallet", () => {
    const wallet = {
      ...EMPTY_WALLET,
      alerts: [
        { key: "wallet:move:CRDO:2026-10-30", kind: "move" as const, severity: "warning" as const, symbol: "CRDO", title: "CRDO -7,2% hoy", detail: "d", researchId: null },
      ],
    };
    const [card] = buildToday(inputWith({ wallet }), now, { remote: false }).cards;
    expect(card).toMatchObject({ key: "wallet:move:CRDO:2026-10-30", source: "wallet", title: "CRDO -7,2% hoy" });
    expect(card?.actions).toEqual([
      { kind: "link", label: "Ver cartera", url: "/#cartera" },
      { kind: "investigate", label: "Investigar", subject: { type: "ticker", symbol: "CRDO", context: "CRDO -7,2% hoy" } },
    ]);
  });

  it("a level suggested by an analysis links back to it", () => {
    const wallet = {
      ...EMPTY_WALLET,
      alerts: [
        { key: "wallet:level:3:2026-10-30", kind: "level" as const, severity: "critical" as const, symbol: "CRDO", title: "CRDO bajo tu stop de 148,00 USD", detail: "d", researchId: 7 },
      ],
    };
    const [card] = buildToday(inputWith({ wallet }), now, { remote: false }).cards;
    expect(card?.actions.map((a) => a.label)).toEqual(["Ver cartera", "Ver análisis", "Investigar"]);
    expect(card?.actions[1]).toEqual({ kind: "link", label: "Ver análisis", url: "/#analisis/7" });
  });

  it("an expired Google account asks to reconnect", () => {
    const cards = buildToday(
      inputWith({ mail: { mailboxes: [{ account: "me@gmail.com", groups: [], snapshotId: "", reconnect: true }] } }),
      now,
      { remote: false },
    ).cards;
    expect(cards[0]?.title).toBe("Reconecta tu Gmail");
  });

  it("failing mail source goes to sourceErrors", () => {
    expect(buildToday(inputWith({ mail: new Error("gmail down") }), now, { remote: false }).sourceErrors).toEqual([
      "mail",
      "work",
      "mac",
    ]);
  });
});

describe("many people writing", () => {
  it("shows five person cards and counts the rest in the summary", () => {
    const person = (i: number) => ({ id: `p${i}`, threadId: "t", from: "", fromName: `P${i}`, subject: "s", date: "", url: "u" });
    const mail = {
      mailboxes: [
        { account: "me@gmail.com", snapshotId: "s", reconnect: false, groups: [{ kind: "person" as const, items: [1, 2, 3, 4, 5, 6, 7].map(person) }] },
      ],
    };
    const cards = buildToday({ ...google, mail, payments: [], mac: new Error("x"), work: new Error("x") }, now, { remote: false }).cards;
    expect(cards.filter((c) => c.title.startsWith("Te escribió"))).toHaveLength(5);
    expect(cards.at(-1)).toMatchObject({ title: "Correo: 2 sin leer", detail: "2 de personas" });
  });
});
