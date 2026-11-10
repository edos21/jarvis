import { openDb } from "../db.js";
import { createAccountStore } from "../google/accounts.js";
import { fakeAuth } from "../google/testing.js";
import { createMailSource } from "./source.js";

// A Gmail API stand-in for tests: an inbox in memory, the requests it got, and batchModify applied to it.
export type FakeMessage = { id: string; from: string; subject: string; headers?: Record<string, string> };

export const createFakeGmail = (initial: FakeMessage[]) => {
  const inbox = new Map(initial.map((m) => [m.id, { ...m, labels: new Set(["INBOX", "UNREAD"]) }]));
  const urls: string[] = [];
  const modified: { ids: string[]; removeLabelIds: string[] }[] = [];
  const trashed: string[] = [];
  const vanishing = new Set<string>();
  const failing = new Map<string, number>();
  const failingReads = new Map<string, number>();
  let gate: Promise<void> | null = null;
  let openGate = () => {};

  const fetchFn = (async (input: string, init?: RequestInit) => {
    urls.push(input);
    const url = new URL(input);
    if (url.pathname.endsWith("/messages/batchModify")) {
      const body = JSON.parse(String(init?.body)) as { ids: string[]; removeLabelIds: string[] };
      modified.push(body);
      for (const id of body.ids) for (const label of body.removeLabelIds) inbox.get(id)?.labels.delete(label);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/trash")) {
      const id = url.pathname.split("/").at(-2) ?? "";
      const status = failing.get(id) ?? (vanishing.has(id) ? 404 : null);
      if (status) return new Response("", { status });
      trashed.push(id);
      inbox.get(id)?.labels.delete("INBOX");
      inbox.get(id)?.labels.add("TRASH");
      return Response.json({ id });
    }
    if (url.pathname.endsWith("/messages")) {
      const messages = [...inbox.values()]
        .filter((m) => m.labels.has("INBOX") && m.labels.has("UNREAD"))
        .map((m) => ({ id: m.id, threadId: `t-${m.id}` }));
      // A held list answers with the inbox as it was when asked, once released.
      const held = gate;
      gate = null;
      if (held) await held;
      return Response.json({ messages });
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    const m = inbox.get(id);
    if (!m || vanishing.has(id)) return new Response("", { status: 404 });
    const status = failingReads.get(id);
    if (status) return new Response("", { status });
    const headers = Object.entries({ From: m.from, Subject: m.subject, ...m.headers }).map(([name, value]) => ({ name, value }));
    return Response.json({ id, threadId: `t-${id}`, internalDate: "1793450000000", payload: { headers } });
  }) as typeof fetch;

  return {
    fetchFn,
    urls,
    modified,
    trashed,
    // Gone after the list, as when the phone archives it mid-read.
    vanishOnRead: (id: string) => vanishing.add(id),
    // Gmail answers this status for any write to the message.
    failWrite: (id: string, status: number) => failing.set(id, status),
    failRead: (id: string, status: number) => failingReads.set(id, status),
    // The next inbox list is answered late, with what the inbox held when it was asked.
    hold: () => {
      gate = new Promise((resolve) => {
        openGate = resolve;
      });
    },
    release: () => openGate(),
    add: (m: FakeMessage) => inbox.set(m.id, { ...m, labels: new Set(["INBOX", "UNREAD"]) }),
    labelsOf: (id: string) => [...(inbox.get(id)?.labels ?? [])],
  };
};

const ME = "me@gmail.com";

const INBOX: FakeMessage[] = [
  { id: "n1", from: "News <hi@substack.com>", subject: "Weekly", headers: { "List-Unsubscribe": "<mailto:x>" } },
  { id: "n2", from: "Other <a@news.com>", subject: "Daily", headers: { "List-Id": "<daily.news.com>" } },
  { id: "p1", from: "Ana Pérez <ana@gmail.com>", subject: "¿Almorzamos?" },
  { id: "g1", from: "GitHub <notifications@github.com>", subject: "[repo] merged" },
];

export const setupMail = (opts: { expired?: boolean; inbox?: FakeMessage[]; automatedSendersFile?: string } = {}) => {
  let clock = 0;
  let expired = opts.expired ?? false;
  const gmail = createFakeGmail(opts.inbox ?? INBOX);
  const accounts = createAccountStore(openDb(":memory:"));
  accounts.save({ email: ME, kind: "personal", refreshToken: "r", scopes: "s" });
  const source = createMailSource({
    auth: fakeAuth(() => expired),
    accounts,
    fetchFn: gmail.fetchFn,
    automatedSendersFile: opts.automatedSendersFile ?? null,
    now: () => clock,
  });
  return {
    gmail,
    source,
    tick: (ms: number) => (clock += ms),
    // Google access is lost from here on, as when the owner revokes it mid-session.
    expire: () => {
      expired = true;
    },
  };
};

