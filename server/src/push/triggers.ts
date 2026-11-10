import { localDate } from "../../../shared/dates.js";
import type { AgendaResponse } from "../../../shared/calendar.js";
import type { MacResponse } from "../../../shared/mac.js";
import type { MailResponse } from "../../../shared/mail.js";
import type { DuePayment } from "../../../shared/payments.js";
import type { PushEvent } from "../../../shared/push.js";
import type { WalletResponse } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";

// Nothing here is worth waking me up: outside these hours events wait for the first tick of the morning.
const AWAKE_HOURS = { from: 9, to: 21 };

const TODAY_URL = "/#hoy";

export type PushInput = {
  due: DuePayment[];
  mac: MacResponse | null;
  work: WorkSummary | null;
  mail?: MailResponse | null;
  agenda?: AgendaResponse | null;
  wallet?: WalletResponse | null;
};

// How long before an event its reminder goes out.
const EVENT_LEAD_MINUTES = 15;

const RECENT_MAIL_MS = 2 * 60 * 60_000;

// Account numbers never go in a notification: lock screens show them.
export const pushEventsFor = (
  { due, mac, work, mail = null, agenda = null, wallet = null }: PushInput,
  now: Date,
): PushEvent[] => {
  const events: PushEvent[] = [];
  const hour = now.getHours();
  if (hour < AWAKE_HOURS.from || hour >= AWAKE_HOURS.to) return events;
  for (const p of due) {
    if (p.status === "upcoming") continue;
    const amount = p.amount === null ? null : `${p.currency} ${p.amount.toLocaleString("es-UY")}`;
    events.push({
      key: `payment:${p.id}:${p.period}:${p.status}`,
      title: p.status === "due_today" ? `Hoy vence ${p.name}` : `${p.name} está vencido`,
      body: [amount, p.accountLabel].filter(Boolean).join(" · ") || "Márcalo pagado en Jarvis cuando lo hagas.",
      url: TODAY_URL,
    });
  }
  // Personal mail only: sender and subject are fine in a notification there. Only recent mail, so connecting an
  // account with a full inbox does not fire one notification per old message.
  for (const box of mail?.mailboxes ?? []) {
    for (const item of box.groups.find((g) => g.kind === "person")?.items ?? []) {
      if (!(now.getTime() - Date.parse(item.date) <= RECENT_MAIL_MS)) continue;
      events.push({ key: `mail:${item.id}`, title: item.fromName, body: item.subject, url: item.url });
    }
  }
  for (const item of agenda?.items ?? []) {
    if (item.allDay) continue;
    const minutes = (Date.parse(item.start) - now.getTime()) / 60_000;
    if (minutes < 0 || minutes > EVENT_LEAD_MINUTES) continue;
    events.push({
      key: `event:${item.id}:${localDate(now)}`,
      title: `En ${Math.max(1, Math.round(minutes))} min: ${item.title}`,
      body: item.location ?? "",
      url: item.url,
    });
  }
  // Moves and crossed levels, once a day each; a sync problem waits for Today, it is not worth a buzz.
  for (const alert of wallet?.alerts ?? []) {
    if (alert.kind === "sync") continue;
    events.push({ key: alert.key, title: alert.title, body: alert.detail, url: "/#cartera" });
  }
  for (const s of mac?.suggestions ?? []) {
    if (s.severity !== "critical") continue;
    events.push({ key: `mac:${s.key}:${localDate(now)}`, title: s.title, body: s.detail, url: "/#mac" });
  }
  if (work?.pepper.reachable) {
    for (const item of work.pepper.factoryWaiting) {
      events.push({
        // The stage is part of the key: a factory can stop on the same ticket again with a new question.
        key: `factory:${item.identifier}:${item.stage ?? "waiting"}`,
        title: `${item.factory} te espera en ${item.identifier}`,
        body: item.stage ?? item.title,
        url: item.url,
      });
    }
  }
  return events;
};
