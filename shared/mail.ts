export type MailKind = "person" | "invoice" | "notification" | "newsletter";

export const MAIL_KINDS: readonly MailKind[] = ["person", "invoice", "notification", "newsletter"];

export const isMailKind = (value: string): value is MailKind => (MAIL_KINDS as readonly string[]).includes(value);

// archive removes INBOX, read removes UNREAD, trash moves to Gmail's trash (kept 30 days): all undone from Gmail.
export type MailAction = "archive" | "read" | "trash";

const MAIL_ACTIONS: readonly MailAction[] = ["archive", "read", "trash"];

export const isMailAction = (value: string): value is MailAction => (MAIL_ACTIONS as readonly string[]).includes(value);

// Mailbox providers where a domain says nothing about the sender: marking one of them adds the address, not the domain.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.es",
  "outlook.com",
  "outlook.es",
  "live.com",
  "live.com.mx",
  "msn.com",
  "yahoo.com",
  "yahoo.es",
  "yahoo.com.ar",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "adinet.com.uy",
  "vera.com.uy",
  "cantv.net",
]);

export const ADDRESS = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/;

// What "No es una persona" writes to the automated-senders file so this sender, and only senders like it, stops
// counting as a person: the domain, or the address on a free mail provider. Null when the sender is not one plain
// address (several recipients, a malformed header), so nothing odd lands in the file.
export const automatedEntryFor = (address: string): string | null => {
  if (!ADDRESS.test(address)) return null;
  const domain = address.split("@")[1] ?? "";
  return FREE_MAIL_DOMAINS.has(domain) ? address : domain;
};

// A whole group goes to the trash only for machine mail; people and invoices are archived, since those are worth
// finding again. A hand-picked message can be trashed from any group.
export const canTrashGroup = (kind: MailKind): boolean => kind === "notification" || kind === "newsletter";

export type MailItem = {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  url: string;
};

export type MailGroup = { kind: MailKind; items: MailItem[] };

// snapshotId names exactly the messages shown, so a bulk action never touches mail that arrived afterwards.
export type MailboxResponse = { account: string; groups: MailGroup[]; snapshotId: string; reconnect: boolean };

export type MailResponse = { mailboxes: MailboxResponse[] };

// Gmail's tabs the sweep looks at: Promociones and Notificaciones (Updates, in the API).
export type SweepCategory = "promotions" | "updates";

export type SweepFilterAction = "trash" | "skip_inbox";

export type SweepAge = { id: string; category: SweepCategory; olderThanDays: number; count: number };

// count is exact: every message of that sender in those tabs, not only the sampled ones.
export type SweepSender = {
  id: string;
  address: string;
  name: string;
  categories: SweepCategory[];
  count: number;
  canUnsubscribe: boolean;
  filtered: boolean;
};

export type SweepOutcome =
  | { kind: "trashed"; count: number }
  | { kind: "archived"; count: number }
  | { kind: "unsubscribed"; name: string } | { kind: "filtered"; name: string };

export type SweepReport = {
  analyzedAt: string;
  account: string;
  // reconnect: the account was connected before Jarvis asked for the filters permission.
  filters: "ok" | "reconnect";
  ages: SweepAge[];
  senders: SweepSender[];
  outcome: SweepOutcome | null;
};

export type SweepApply =
  | { id: string; action: "trash" }
  | { id: string; action: "archive" }
  | { id: string; action: "unsubscribe" }
  | { id: string; action: "filter"; filterAction: SweepFilterAction };
