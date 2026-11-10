import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import {
  MAIL_KINDS,
  type MailAction,
  type MailItem,
  type MailKind,
  type MailboxResponse,
  type MailResponse,
  automatedEntryFor,
} from "../../../shared/mail.js";
import type { AccountStore, StoredAccount } from "../google/accounts.js";
import { type RawMessage, listUnreadInbox, removeLabels, trashMessages } from "../google/gmail.js";
import { GoogleAuthExpired, type GoogleAuth } from "../google/oauth.js";
import { DEFAULT_AUTOMATED_DOMAINS, classifyMail, parseFrom } from "./classify.js";

const CACHE_MS = 2 * 60_000;
const SNAPSHOT_TTL_MS = 30 * 60_000;

export class SnapshotExpired extends Error {}
export class UnknownAccount extends Error {}
export class UnreadableSender extends Error {}

export type MailSource = {
  read(): Promise<MailResponse>;
  // Acts only on what a snapshot showed; returns the mailbox read again.
  actOnGroup(account: string, kind: MailKind, snapshotId: string, action: MailAction): Promise<MailboxResponse>;
  // A hand-picked selection: every id must be one Jarvis has shown, or nothing is touched.
  actOnMessages(account: string, ids: string[], action: MailAction): Promise<MailboxResponse>;
  // Adds the sender (its domain, or the address on a free mail provider) to the automated-senders file.
  markNotPerson(account: string, messageId: string): Promise<MailboxResponse>;
  invalidate(): void;
};

// Read on every call so editing the file needs no restart.
export const readAutomatedDomains = (file: string | null): string[] => {
  const extra =
    file && existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .map((line) => line.trim().toLowerCase())
          .filter((line) => line && !line.startsWith("#"))
      : [];
  return [...DEFAULT_AUTOMATED_DOMAINS, ...extra];
};

export const createMailSource = (deps: {
  auth: GoogleAuth | null;
  accounts: AccountStore;
  fetchFn: typeof fetch;
  automatedSendersFile: string | null;
  now?: () => number;
}): MailSource => {
  const now = deps.now ?? Date.now;
  let cached: { value: MailResponse; at: number } | null = null;
  // Bumped by every write: a read that started before it must not put the old inbox back in the cache.
  let generation = 0;
  const metadata = new Map<string, ReadonlyMap<string, RawMessage>>();
  const snapshots = new Map<
    string,
    { account: string; ids: Map<MailKind, string[]>; senders: Map<string, string>; at: number }
  >();

  const readMailbox = async (account: StoredAccount): Promise<MailboxResponse> => {
    if (!deps.auth) throw new Error("Google is not configured");
    let raw;
    try {
      raw = await listUnreadInbox(account, deps.auth, deps.fetchFn, metadata.get(account.email));
      metadata.set(account.email, new Map(raw.map((m) => [m.id, m])));
    } catch (error) {
      if (error instanceof GoogleAuthExpired) return { account: account.email, groups: [], snapshotId: "", reconnect: true };
      throw error;
    }
    const domains = readAutomatedDomains(deps.automatedSendersFile);
    const byKind = new Map<MailKind, MailItem[]>(MAIL_KINDS.map((k) => [k, []]));
    for (const m of raw) {
      const from = m.headers.get("from") ?? "";
      byKind.get(classifyMail(m.headers, m.labelIds, domains))?.push({
        id: m.id,
        threadId: m.threadId,
        from: parseFrom(from).address,
        fromName: parseFrom(from).name,
        subject: m.headers.get("subject")?.trim() || "(sin asunto)",
        date: new Date(Number(m.internalDate)).toISOString(),
        // authuser, not /u/<email>/: a Workspace account answers the email in the path with a "Temporary Error" page.
        url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#inbox/${m.threadId}`,
      });
    }
    const groups = MAIL_KINDS.map((kind) => ({ kind, items: byKind.get(kind) ?? [] })).filter((g) => g.items.length > 0);
    const ids = new Map(groups.map((g) => [g.kind, g.items.map((i) => i.id)]));
    const snapshotId = createHash("sha256")
      .update(account.email + JSON.stringify([...ids]))
      .digest("hex")
      .slice(0, 16);
    for (const [key, value] of snapshots) if (now() - value.at > SNAPSHOT_TTL_MS) snapshots.delete(key);
    const senders = new Map(groups.flatMap((g) => g.items.map((i): [string, string] => [i.id, i.from])));
    snapshots.set(snapshotId, { account: account.email, ids, senders, at: now() });
    return { account: account.email, groups, snapshotId, reconnect: false };
  };

  const personal = (): StoredAccount[] => deps.accounts.list().filter((a) => a.kind === "personal");

  const accountOf = (email: string): { account: StoredAccount; auth: GoogleAuth } => {
    const account = personal().find((a) => a.email === email);
    if (!account || !deps.auth) throw new UnknownAccount(email);
    return { account, auth: deps.auth };
  };

  const live = (s: { at: number }): boolean => now() - s.at <= SNAPSHOT_TTL_MS;

  // The sender of a message Jarvis has shown for this account recently; never an arbitrary id.
  const shownSender = (email: string, messageId: string): string | null => {
    for (const s of snapshots.values()) {
      const sender = s.account === email && live(s) ? s.senders.get(messageId) : undefined;
      if (sender !== undefined) return sender;
    }
    return null;
  };

  const invalidate = (): void => {
    generation += 1;
    cached = null;
  };

  // Even a write that failed halfway may have changed the inbox, so the cache goes either way.
  const apply = async (account: StoredAccount, auth: GoogleAuth, ids: string[], action: MailAction) => {
    try {
      if (action === "trash") await trashMessages(account, auth, deps.fetchFn, ids);
      else await removeLabels(account, auth, deps.fetchFn, ids, action === "archive" ? "INBOX" : "UNREAD");
    } finally {
      invalidate();
    }
    return readMailbox(account);
  };

  const actOnMessages = async (email: string, ids: string[], action: MailAction): Promise<MailboxResponse> => {
    const { account, auth } = accountOf(email);
    if (ids.some((id) => shownSender(email, id) === null)) throw new SnapshotExpired();
    return apply(account, auth, ids, action);
  };

  return {
    read: async () => {
      if (cached && now() - cached.at < CACHE_MS) return cached.value;
      if (!deps.auth) return { mailboxes: [] };
      const started = generation;
      const value = { mailboxes: await Promise.all(personal().map(readMailbox)) };
      if (started === generation) cached = { value, at: now() };
      return value;
    },

    actOnGroup: async (email, kind, snapshotId, action) => {
      const { account, auth } = accountOf(email);
      const snapshot = snapshots.get(snapshotId);
      if (!snapshot || snapshot.account !== email || !live(snapshot)) throw new SnapshotExpired();
      return apply(account, auth, snapshot.ids.get(kind) ?? [], action);
    },

    actOnMessages,

    markNotPerson: async (email, messageId) => {
      const { account } = accountOf(email);
      const sender = shownSender(email, messageId);
      if (sender === null) throw new SnapshotExpired();
      const file = deps.automatedSendersFile;
      if (!file) throw new Error("There is no automated-senders file to write to.");
      const entry = automatedEntryFor(sender);
      if (!entry) throw new UnreadableSender();
      if (!readAutomatedDomains(file).includes(entry)) {
        // The file is edited by hand too: a last line saved without its newline must not swallow the new entry.
        const current = existsSync(file) ? readFileSync(file, "utf8") : "";
        const separator = current && !current.endsWith("\n") ? "\n" : "";
        appendFileSync(file, `${separator}${entry}\n`, { mode: 0o600 });
      }
      invalidate();
      return readMailbox(account);
    },

    invalidate,
  };
};
