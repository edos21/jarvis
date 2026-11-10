import type { AgendaResponse } from "../../../shared/calendar.js";
import { type MailKind, type MailResponse, automatedEntryFor } from "../../../shared/mail.js";
import { maskAccount, type DuePayment } from "../../../shared/payments.js";
import type { MacResponse, Severity } from "../../../shared/mac.js";
import type { CardAction, CardSource, TodayCard, TodayResponse } from "../../../shared/today.js";
import type { WalletResponse } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";

export type TodayInput = {
  payments: DuePayment[] | Error;
  agenda: AgendaResponse | Error;
  mail: MailResponse | Error;
  wallet: WalletResponse | Error;
  mac: MacResponse | Error;
  work: WorkSummary | Error;
};

export type TodayWithoutBriefing = Omit<TodayResponse, "briefing" | "briefingStatus" | "briefingVoice" | "briefingSeen">;

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const SOURCE_ORDER: Record<CardSource, number> = { payments: 0, agenda: 1, mail: 2, wallet: 3, work: 4, mac: 5 };

// Alerts are worked out with the wallet itself; Today only shows them.
const walletCards = (wallet: WalletResponse): TodayCard[] =>
  wallet.alerts.map((alert) => ({
    key: alert.key,
    severity: alert.severity,
    source: "wallet",
    title: alert.title,
    detail: alert.detail,
    actions: [
      { kind: "link", label: "Ver cartera", url: "/#cartera" },
      ...(alert.researchId !== null ? [{ kind: "link" as const, label: "Ver análisis", url: `/#analisis/${alert.researchId}` }] : []),
      ...(alert.symbol && alert.kind !== "sync"
        ? [{ kind: "investigate" as const, label: "Investigar", subject: { type: "ticker" as const, symbol: alert.symbol, context: alert.title } }]
        : []),
    ],
  }));

// An event this close gets a card; the agenda column shows the rest of the day.
const SOON_MINUTES = 60;

const DUE_LABEL = { overdue: "vencido", due_today: "vence hoy", upcoming: "vence el" } as const;

const money = (p: DuePayment): string =>
  p.amount === null ? "" : ` · ${p.currency} ${p.amount.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;

const paymentCard = (p: DuePayment, remote: boolean): TodayCard => {
  const when = p.status === "upcoming" ? `${DUE_LABEL.upcoming} ${Number(p.dueDate.slice(8))}` : DUE_LABEL[p.status];
  const account = p.accountNumber ? (remote ? maskAccount(p.accountNumber) : p.accountNumber) : null;
  const actions: CardAction[] = [];
  // From the phone a masked number is useless to copy; the full one never leaves the Mac.
  if (p.accountNumber && !remote) actions.push({ kind: "copy", label: "Copiar cuenta", text: p.accountNumber });
  if (p.link) actions.push({ kind: "link", label: "Abrir", url: p.link });
  actions.push({ kind: "mark_paid", label: "Pagado", paymentId: p.id, period: p.period });
  return {
    key: `payment:${p.id}:${p.period}`,
    severity: p.status === "upcoming" ? "info" : "critical",
    source: "payments",
    title: `Pagar ${p.name} · ${when}`,
    detail: [p.accountLabel, account].filter(Boolean).join(" · ") + money(p),
    actions,
  };
};

const macCards = (mac: MacResponse, remote: boolean): TodayCard[] =>
  mac.suggestions.map((s) => ({
    key: `mac:${s.key}`,
    severity: s.severity,
    source: "mac",
    title: s.title,
    detail: s.detail,
    actions:
      s.cta && !(remote && (s.cta.kind === "kill" || s.cta.kind === "open_app" || s.cta.kind === "open_url"))
        ? [{ kind: "mac_cta", label: s.cta.kind === "kill" ? "Cerrar proceso" : "Abrir", cta: s.cta }]
        : [],
  }));

const workCards = (work: WorkSummary, remote: boolean): TodayCard[] => {
  const { pepper, prs } = work;
  const cards: TodayCard[] = [];
  if (pepper.reachable) {
    for (const item of pepper.factoryWaiting) {
      cards.push({
        key: `factory:${item.identifier}`,
        severity: "warning",
        source: "work",
        title: `${item.factory} te espera en ${item.identifier}`,
        detail: [item.stage, item.title].filter(Boolean).join(" · "),
        actions: [{ kind: "link", label: "Abrir panel", url: item.url }],
      });
    }
    for (const t of pepper.toVerify) {
      cards.push({
        key: `verify:${t.identifier}`,
        severity: "info",
        source: "work",
        title: `${t.identifier} llegó a producción`,
        detail: `Falta verificarlo · ${t.title}`,
        actions: [{ kind: "link", label: "Abrir en Linear", url: t.url }],
      });
    }
    if (pepper.decisions > 0) {
      cards.push({
        key: "pepper:decisions",
        severity: "info",
        source: "work",
        title: pepper.decisions === 1 ? "1 decisión en Pepper" : `${pepper.decisions} decisiones en Pepper`,
        detail: "Tickets esperando que decidas algo.",
        // Pepper only listens on the Mac.
        actions: remote ? [] : [{ kind: "link", label: "Abrir Pepper", url: pepper.boardUrl }],
      });
    }
  }
  for (const pr of prs ?? []) {
    if (pr.ci !== "failing" && pr.review !== "changes_requested") continue;
    cards.push({
      key: `pr:${pr.url}`,
      severity: "warning",
      source: "work",
      title: pr.ci === "failing" ? `CI en rojo en ${pr.repo}` : `Te pidieron cambios en ${pr.repo}`,
      detail: pr.title,
      actions: [{ kind: "link", label: "Ver PR", url: pr.url }],
    });
  }
  return cards;
};

const MAIL_KIND_LABEL: Record<MailKind, string> = {
  person: "de personas",
  invoice: "facturas",
  notification: "notificaciones",
  newsletter: "newsletters",
};

// Beyond this many people, the rest wait in Correo instead of burying the day.
const MAX_PERSON_CARDS = 5;

const mailCards = (mail: MailResponse): TodayCard[] =>
  mail.mailboxes.flatMap((box): TodayCard[] => {
    if (box.reconnect) {
      return [
        {
          key: `mail:reconnect:${box.account}`,
          severity: "warning",
          source: "mail",
          title: "Reconecta tu Gmail",
          detail: `Jarvis perdió el acceso a ${box.account}.`,
          actions: [{ kind: "link", label: "Ir a Correo", url: "/#correo" }],
        },
      ];
    }
    const people = box.groups.find((g) => g.kind === "person")?.items ?? [];
    const cards: TodayCard[] = people.slice(0, MAX_PERSON_CARDS).map((item) => {
      const entry = automatedEntryFor(item.from);
      return {
        key: `mail:${item.id}`,
        severity: "warning",
        source: "mail",
        title: `Te escribió ${item.fromName}`,
        detail: item.subject,
        actions: [
          { kind: "link", label: "Abrir en Gmail", url: item.url },
          ...(entry
            ? [{ kind: "not_person" as const, label: "No es una persona", account: box.account, messageId: item.id, entry }]
            : []),
          { kind: "archive_mail", label: "Archivar", account: box.account, messageId: item.id },
        ],
      };
    });
    const overflow = people.length - MAX_PERSON_CARDS;
    const rest = [
      ...(overflow > 0 ? [{ kind: "person" as const, count: overflow }] : []),
      ...box.groups.filter((g) => g.kind !== "person").map((g) => ({ kind: g.kind, count: g.items.length })),
    ];
    const count = rest.reduce((n, g) => n + g.count, 0);
    if (count > 0) {
      cards.push({
        key: `mail:rest:${box.account}`,
        severity: "info",
        source: "mail",
        title: count === 1 ? "Correo: 1 sin leer" : `Correo: ${count} sin leer`,
        detail: rest.map((g) => `${g.count} ${MAIL_KIND_LABEL[g.kind]}`).join(" · "),
        actions: [{ kind: "link", label: "Revisar", url: "/#correo" }],
      });
    }
    return cards;
  });

const agendaCards = (agenda: AgendaResponse, now: Date): TodayCard[] => {
  const cards: TodayCard[] = agenda.items.flatMap((item): TodayCard[] => {
    if (item.allDay) return [];
    const minutes = Math.round((Date.parse(item.start) - now.getTime()) / 60_000);
    // "Ahora" lasts until the event ends, not just the minute it starts.
    const ongoing = Date.parse(item.start) <= now.getTime() && now.getTime() < Date.parse(item.end);
    if (!ongoing && (minutes < 0 || minutes > SOON_MINUTES)) return [];
    return [
      {
        key: `event:${item.id}`,
        severity: "info",
        source: "agenda",
        title: ongoing || minutes === 0 ? `Ahora: ${item.title}` : `En ${minutes} min: ${item.title}`,
        detail: item.location ?? "",
        actions: [{ kind: "link", label: "Ver evento", url: item.url }],
      },
    ];
  });
  for (const task of agenda.tasks) {
    const [y, m, d] = task.due.split("-").map(Number);
    cards.push({
      key: `task:${task.id}`,
      severity: task.overdue ? "warning" : "info",
      source: "agenda",
      title: task.overdue ? `Tarea vencida: ${task.title}` : `Para hoy: ${task.title}`,
      detail: [
        task.overdue
          ? `Vencía el ${new Date(y ?? 0, (m ?? 1) - 1, d).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}`
          : "",
        task.ruleId !== null ? "↻ se repite" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      actions: [
        { kind: "link", label: "Abrir en Tasks", url: task.url },
        { kind: "postpone_task", label: "Mañana", account: task.account, listId: task.listId, taskId: task.id },
        { kind: "complete_task", label: "Marcar hecha", account: task.account, listId: task.listId, taskId: task.id },
      ],
    });
  }
  if (agenda.reconnect.length > 0) {
    cards.push({
      key: "agenda:reconnect",
      severity: "warning",
      source: "agenda",
      title: "Reconecta tu Google",
      detail: `Para leer tu agenda y tus tareas, conecta de nuevo ${agenda.reconnect.join(", ")}.`,
      actions: [{ kind: "link", label: "Ir a Correo", url: "/#correo" }],
    });
  }
  return cards;
};

const greetingAt = (d: Date): string => {
  const h = d.getHours();
  const part = h >= 5 && h < 12 ? "Buenos días" : h >= 12 && h < 19 ? "Buenas tardes" : "Buenas noches";
  return `${part}, Edu.`;
};

const dateLabel = (d: Date): string => {
  const label = d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const ok = <T>(value: T | Error): value is T => !(value instanceof Error);

export const buildToday = (input: TodayInput, now: Date, opts: { remote: boolean }): TodayWithoutBriefing => {
  const sourceErrors: CardSource[] = [];
  const cards: TodayCard[] = [];
  if (ok(input.payments)) cards.push(...input.payments.map((p) => paymentCard(p, opts.remote)));
  else sourceErrors.push("payments");
  if (ok(input.agenda)) cards.push(...agendaCards(input.agenda, now));
  else sourceErrors.push("agenda");
  if (ok(input.mail)) cards.push(...mailCards(input.mail));
  else sourceErrors.push("mail");
  if (ok(input.wallet)) cards.push(...walletCards(input.wallet));
  else sourceErrors.push("wallet");
  if (ok(input.work)) cards.push(...workCards(input.work, opts.remote));
  else sourceErrors.push("work");
  if (ok(input.mac)) cards.push(...macCards(input.mac, opts.remote));
  else sourceErrors.push("mac");
  // A stable sort keeps each source's own order inside the same severity.
  cards.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source],
  );
  return {
    greeting: greetingAt(now),
    dateLabel: dateLabel(now),
    cards,
    side: {
      agenda: ok(input.agenda) ? input.agenda : null,
      wallet: ok(input.wallet) ? input.wallet : null,
      work: ok(input.work) ? input.work : null,
      mac: ok(input.mac) ? input.mac.status : null,
    },
    sourceErrors,
    generatedAt: now.toISOString(),
  };
};
