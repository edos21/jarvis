import { describe, expect, it } from "vitest";

import type { MacResponse } from "../../../shared/mac.js";
import type { DuePayment } from "../../../shared/payments.js";
import { EMPTY_WALLET } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";
import { pushEventsFor } from "./triggers.js";

const rent: DuePayment = {
  id: 1,
  name: "Alquiler",
  amount: 950,
  currency: "USD",
  dueDay: 30,
  link: null,
  accountLabel: "Banco Uno",
  accountNumber: "0000 1111 4821",
  active: true,
  createdOn: "2026-01-01",
  period: "2026-10",
  dueDate: "2026-10-30",
  status: "due_today",
};

const mac: MacResponse = {
  status: { cpuPct: 1, memPct: 1, diskPct: 96, diskFreeGb: 9, uptimeDays: 1, updates: [], stuck: [], collectedAt: "" },
  suggestions: [
    { key: "disk", severity: "critical", title: "Disco al 96%", detail: "…", cta: null },
    { key: "updates", severity: "info", title: "1 actualización", detail: "…", cta: null },
  ],
};

const work: WorkSummary = {
  pepper: {
    reachable: true,
    boardUrl: "http://127.0.0.1:4318",
    decisions: 0,
    factoryWaiting: [{ identifier: "ENG-9", title: "Fix", factory: "Atlas", stage: null, url: "https://x" }],
    factoryInProgress: 0,
    toVerify: [],
  },
  prs: [],
  collectedAt: "",
};

const at = (h: number) => new Date(2026, 9, 30, h);

describe("pushEventsFor", () => {
  it("builds one event per payment due, critical mac issue and waiting factory", () => {
    expect(pushEventsFor({ due: [rent], mac, work }, at(10)).map((e) => e.key)).toEqual([
      "payment:1:2026-10:due_today",
      "mac:disk:2026-10-30",
      "factory:ENG-9:waiting",
    ]);
  });

  it("upcoming payments do not push", () => {
    expect(pushEventsFor({ due: [{ ...rent, status: "upcoming" }], mac: null, work: null }, at(10))).toEqual([]);
  });

  it("no push outside 09–21, not even a critical Mac issue", () => {
    const keys = (h: number) => pushEventsFor({ due: [rent], mac: null, work: null }, at(h)).map((e) => e.key);
    expect(pushEventsFor({ due: [], mac, work }, at(3))).toEqual([]);
    expect(keys(8)).toEqual([]);
    expect(keys(9)).toHaveLength(1);
    expect(keys(21)).toEqual([]);
  });

  it("push body never contains an account number", () => {
    const events = pushEventsFor({ due: [rent, { ...rent, status: "overdue" }], mac, work }, at(10));
    expect(JSON.stringify(events)).not.toMatch(/4821|1111/);
  });
});

describe("factory pushes", () => {
  it("a new stop on the same ticket is a new push", () => {
    const stopAt = (stage: string) =>
      pushEventsFor(
        { due: [], mac: null, work: { ...work, pepper: { ...work.pepper, factoryWaiting: [{ ...work.pepper.factoryWaiting[0]!, stage }] } } },
        at(10),
      )[0]?.key;
    expect(stopAt("necesita pm")).not.toBe(stopAt("necesita ingeniero"));
  });
});

describe("mail and event pushes", () => {
  const mail = {
    mailboxes: [
      {
        account: "me@gmail.com",
        snapshotId: "s",
        reconnect: false,
        groups: [
          {
            kind: "person" as const,
            items: [
              { id: "m1", threadId: "t1", from: "ana@gmail.com", fromName: "Ana Pérez", subject: "¿Almorzamos?", date: at(9).toISOString(), url: "u" },
              { id: "old", threadId: "t2", from: "bo@gmail.com", fromName: "Bo", subject: "Old", date: at(7).toISOString(), url: "u" },
            ],
          },
          { kind: "newsletter" as const, items: [{ id: "n1", threadId: "t", from: "", fromName: "", subject: "", date: "", url: "" }] },
        ],
      },
    ],
  };

  it("mail push keyed by message id, only for people and only for mail from the last two hours", () => {
    const events = pushEventsFor({ due: [], mac: null, work: null, mail }, at(10));
    expect(events).toEqual([{ key: "mail:m1", title: "Ana Pérez", body: "¿Almorzamos?", url: "u" }]);
  });

  it("an event pushes 15 minutes ahead, keyed by event and day", () => {
    const start = (min: number) => new Date(at(10).getTime() + min * 60_000).toISOString();
    const agenda = {
      reconnect: [], tasks: [],
      items: [
        { id: "e1", title: "Dentista", start: start(12), end: start(60), allDay: false, location: "Av. Brasil", url: "u" },
        { id: "e2", title: "Gym", start: start(40), end: start(90), allDay: false, location: null, url: "u" },
      ],
    };
    const events = pushEventsFor({ due: [], mac: null, work: null, agenda }, at(10));
    expect(events.map((e) => [e.key, e.title])).toEqual([["event:e1:2026-10-30", "En 12 min: Dentista"]]);
  });

  it("wallet moves and levels push with their daily key; a sync problem does not", () => {
    const alert = (kind: "move" | "level" | "sync", key: string) => ({ key, kind, severity: "warning" as const, symbol: "CRDO", title: key, detail: "d", researchId: null });
    const wallet = {
      ...EMPTY_WALLET,
      alerts: [alert("move", "wallet:move:CRDO:2026-10-30"), alert("level", "wallet:level:3:2026-10-30"), alert("sync", "wallet:sync:flex")],
    };
    const events = pushEventsFor({ due: [], mac: null, work: null, wallet }, at(10));
    expect(events.map((e) => [e.key, e.url])).toEqual([
      ["wallet:move:CRDO:2026-10-30", "/#cartera"],
      ["wallet:level:3:2026-10-30", "/#cartera"],
    ]);
  });
});
