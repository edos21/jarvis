import type { AgendaResponse } from "../../../shared/calendar.js";
import type { MacResponse } from "../../../shared/mac.js";
import type { MailResponse } from "../../../shared/mail.js";
import type { WalletResponse } from "../../../shared/wallet.js";
import type { WorkSummary } from "../../../shared/work.js";
import type { MacSource } from "../mac/routes.js";
import { duePayments } from "../payments/due.js";
import type { PaymentStore } from "../payments/store.js";
import type { WorkSource } from "../work/routes.js";
import type { Notifier } from "./notifier.js";
import { pushEventsFor } from "./triggers.js";

const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

// One pass: read every source and notify what is new. A failing source just sends nothing this time.
export const pushTick = async (deps: {
  payments: PaymentStore;
  mac: Pick<MacSource, "read">;
  work: WorkSource;
  mail: { read(): Promise<MailResponse> };
  agenda: { read(): Promise<AgendaResponse> };
  wallet: { read(): Promise<WalletResponse> };
  notifier: Notifier;
  now?: () => Date;
}): Promise<void> => {
  const now = (deps.now ?? (() => new Date()))();
  const [mac, work, mail, agenda, wallet] = await Promise.all([
    orNull<MacResponse>(() => deps.mac.read()),
    orNull<WorkSummary>(() => deps.work.read()),
    orNull<MailResponse>(() => deps.mail.read()),
    orNull<AgendaResponse>(() => deps.agenda.read()),
    orNull<WalletResponse>(() => deps.wallet.read()),
  ]);
  const due = duePayments(deps.payments.list(), deps.payments.paidPeriods(), now);
  for (const event of pushEventsFor({ due, mac, work, mail, agenda, wallet }, now)) await deps.notifier.notify(event);
};
