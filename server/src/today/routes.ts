import type { Hono } from "hono";

import type { AgendaResponse } from "../../../shared/calendar.js";
import { localDate } from "../../../shared/dates.js";
import type { MacResponse } from "../../../shared/mac.js";
import type { MailResponse } from "../../../shared/mail.js";
import type { DuePayment } from "../../../shared/payments.js";
import type { TodayResponse } from "../../../shared/today.js";
import type { WalletResponse } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";
import { type ApiError, isRemote } from "../app.js";
import type { MacSource } from "../mac/routes.js";
import { duePayments } from "../payments/due.js";
import type { PaymentStore } from "../payments/store.js";
import type { WorkSource } from "../work/routes.js";
import type { AgendaSource } from "../google/agendaSource.js";
import type { MailSource } from "../mail/source.js";
import type { WalletSource } from "../wallet/source.js";
import type { Voice } from "../voice/elevenlabs.js";
import type { BriefingWriter } from "./briefing.js";
import { type TodayInput, type TodayWithoutBriefing, buildToday } from "./build.js";
import type { BriefingSeenStore } from "./seen.js";

export type TodaySources = {
  mac: Pick<MacSource, "read">;
  payments: PaymentStore;
  work: WorkSource;
  agenda: Pick<AgendaSource, "read">;
  mail: Pick<MailSource, "read">;
  wallet: Pick<WalletSource, "read">;
  seen: BriefingSeenStore;
  now?: () => Date;
};

// A source that hangs (a stuck command, Pepper half up) becomes an error instead of holding the whole view.
const SOURCE_TIMEOUT_MS = 5000;

const withTimeout = <T>(promise: Promise<T>, label: string, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms).unref?.()),
  ]);

const settled = <T>(result: PromiseSettledResult<T>): T | Error =>
  result.status === "fulfilled"
    ? result.value
    : result.reason instanceof Error
      ? result.reason
      : new Error(String(result.reason));

// Each source on its own: one that fails or hangs never takes the others down.
export const collectToday = async (sources: TodaySources): Promise<TodayInput> => {
  const now = (sources.now ?? (() => new Date()))();
  const [payments, mac, work, agenda, mail, wallet] = await Promise.allSettled([
    Promise.resolve().then((): DuePayment[] =>
      duePayments(sources.payments.list(), sources.payments.paidPeriods(), now),
    ),
    withTimeout<MacResponse>(sources.mac.read(), "mac", SOURCE_TIMEOUT_MS),
    withTimeout<WorkSummary>(sources.work.read(), "work", SOURCE_TIMEOUT_MS),
    withTimeout<AgendaResponse>(sources.agenda.read(), "agenda", SOURCE_TIMEOUT_MS),
    withTimeout<MailResponse>(sources.mail.read(), "mail", SOURCE_TIMEOUT_MS),
    withTimeout<WalletResponse>(sources.wallet.read(), "wallet", SOURCE_TIMEOUT_MS),
  ]);
  return {
    payments: settled(payments),
    mac: settled(mac),
    work: settled(work),
    agenda: settled(agenda),
    mail: settled(mail),
    wallet: settled(wallet),
  };
};

export const todayFor = async (sources: TodaySources, remote: boolean): Promise<TodayWithoutBriefing> =>
  buildToday(await collectToday(sources), (sources.now ?? (() => new Date()))(), { remote });

export const todayRoutes =
  (sources: TodaySources, briefing: BriefingWriter, voice: Voice | null = null) =>
  (app: Hono): void => {
    app.get("/today", async (c) => {
      const input = await collectToday(sources);
      const now = (sources.now ?? (() => new Date()))();
      const local = buildToday(input, now, { remote: false });
      // The briefing is always written from the Mac's view, so both screens read the same text.
      const today = isRemote(c) ? buildToday(input, now, { remote: true }) : local;
      return c.json<TodayResponse>({
        ...today,
        ...briefing.current(local),
        briefingVoice: voice !== null,
        briefingSeen: sources.seen.seenOn() === localDate(now),
      });
    });

    // Reading the briefing is not destructive, so the phone marks it too: read on one screen, read on both.
    app.post("/today/briefing/seen", (c) => {
      const day = localDate((sources.now ?? (() => new Date()))());
      sources.seen.markSeen(day);
      return c.json({ seenOn: day });
    });

    // The briefing the page shows, in Jarvis's voice. Only a text the briefing writer produced is spoken, so the
    // route never turns into a way to bill the key for any text.
    app.get("/today/briefing/audio", async (c) => {
      if (!voice) return c.json<ApiError>({ error: "Jarvis no tiene voz configurada" }, 503);
      const text = c.req.query("text") ?? "";
      if (!text || !briefing.wrote(text)) return c.json<ApiError>({ error: "Ese texto no es un parte de Jarvis" }, 404);
      try {
        const audio = await voice.audio(text);
        return c.body(new Uint8Array(audio), 200, { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" });
      } catch (error) {
        console.error(`briefing audio failed: ${error instanceof Error ? error.message : String(error)}`);
        return c.json<ApiError>({ error: "No pude generar la voz" }, 502);
      }
    });
  };
