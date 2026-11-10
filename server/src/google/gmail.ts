import type { StoredAccount } from "./accounts.js";
import { GoogleApiError, googleRequest } from "./api.js";
import type { GoogleAuth } from "./oauth.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// The only headers Jarvis reads: never the body.
export const METADATA_HEADERS = [
  "From",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "List-Id",
  "Precedence",
] as const;

export type RawMessage = { id: string; threadId: string; internalDate: string; labelIds: string[]; headers: Map<string, string> };

type Account = Pick<StoredAccount, "email" | "refreshToken">;

type ListResponse = { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
type MetadataResponse = {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
};

// A message can vanish between the list and a call on it (archived or deleted from the phone): that one is skipped.
// Anything else (lost access, a rate limit, a Gmail outage) fails the whole call, so nothing silently goes missing.
const inBatches = async <T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    for (const result of await Promise.allSettled(items.slice(i, i + size).map(fn))) {
      if (result.status === "fulfilled") out.push(result.value);
      else if (!(result.reason instanceof GoogleApiError && result.reason.status === 404)) throw result.reason;
    }
  }
  return out;
};

// Headers only, never the body. A message gone since it was listed is skipped.
export const readMetadata = (account: Account, auth: GoogleAuth, fetchFn: typeof fetch, ids: string[]): Promise<RawMessage[]> =>
  inBatches(ids, 10, async (id) => {
    const url = new URL(`${GMAIL}/messages/${id}`);
    url.searchParams.set("format", "metadata");
    for (const header of METADATA_HEADERS) url.searchParams.append("metadataHeaders", header);
    const m = await googleRequest<MetadataResponse>(auth, account, fetchFn, url.toString());
    const headers = new Map((m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
    return { id: m.id, threadId: m.threadId, internalDate: m.internalDate, labelIds: m.labelIds ?? [], headers };
  });

const PAGE = 500;

// Every id a search finds, newest first, up to limit: a list call costs one request per 500, so counting 20 thousand
// is 40 requests, not 20 thousand.
export const listIds = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  q: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<string[]> => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GMAIL}/messages`);
    url.search = new URLSearchParams({
      q,
      maxResults: String(Math.min(PAGE, limit - ids.length)),
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const page = await googleRequest<ListResponse>(auth, account, fetchFn, url.toString());
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids;
};

const MODIFY_BATCH = 1000;

const modifyByIds = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  ids: string[],
  labels: { addLabelIds?: string[]; removeLabelIds: string[] },
): Promise<void> => {
  for (let i = 0; i < ids.length; i += MODIFY_BATCH) {
    await googleRequest(auth, account, fetchFn, `${GMAIL}/messages/batchModify`, {
      method: "POST",
      body: { ids: ids.slice(i, i + MODIFY_BATCH), ...labels },
    });
  }
};

// The bulk form of trash: Gmail takes 1000 ids per call and keeps them 30 days, like a trash from its own page.
export const trashByIds = (account: Account, auth: GoogleAuth, fetchFn: typeof fetch, ids: string[]): Promise<void> =>
  modifyByIds(account, auth, fetchFn, ids, { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] });

export const archiveByIds = (account: Account, auth: GoogleAuth, fetchFn: typeof fetch, ids: string[]): Promise<void> =>
  modifyByIds(account, auth, fetchFn, ids, { removeLabelIds: ["INBOX"] });

export type FilterAction = "trash" | "skip_inbox";

type FilterResponse = { filter?: { criteria?: { from?: string } }[] };

const ADDRESS_IN_TEXT = /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/g;

// The senders that already have a filter by address, lowercased; a filter written by hand may list several
// ("a@x.com OR b@y.com", "{a@x.com b@y.com}").
export const listFilteredSenders = async (account: Account, auth: GoogleAuth, fetchFn: typeof fetch): Promise<Set<string>> => {
  const { filter = [] } = await googleRequest<FilterResponse>(auth, account, fetchFn, `${GMAIL}/settings/filters`);
  return new Set(filter.flatMap((f) => f.criteria?.from?.toLowerCase().match(ADDRESS_IN_TEXT) ?? []));
};

// A filter lives in Gmail: it keeps working with the Mac off, and is seen or removed in Gmail's settings.
export const createFilter = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  from: string,
  action: FilterAction,
): Promise<void> => {
  await googleRequest(auth, account, fetchFn, `${GMAIL}/settings/filters`, {
    method: "POST",
    body: {
      criteria: { from },
      action: action === "trash" ? { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] } : { removeLabelIds: ["INBOX"] },
    },
  });
};

// Metadata of a message never changes, so `known` ones (from the previous read) are not fetched again: a read with
// nothing new is a single list call.
export const listUnreadInbox = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  known: ReadonlyMap<string, RawMessage> = new Map(),
  max = 100,
): Promise<RawMessage[]> => {
  const list = new URL(`${GMAIL}/messages`);
  list.search = new URLSearchParams({ q: "in:inbox is:unread", maxResults: String(max) }).toString();
  const { messages = [] } = await googleRequest<ListResponse>(auth, account, fetchFn, list.toString());
  const fetched = await readMetadata(
    account,
    auth,
    fetchFn,
    messages.filter(({ id }) => !known.has(id)).map(({ id }) => id),
  );
  const byId = new Map([...known, ...fetched.map((m): [string, RawMessage] => [m.id, m])]);
  return messages.flatMap(({ id }) => byId.get(id) ?? []);
};

// Trash, not delete: Gmail keeps it 30 days and permanent deletion would need full mail access.
export const trashMessages = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  ids: string[],
): Promise<void> => {
  await inBatches(ids, 10, (id) =>
    googleRequest(auth, account, fetchFn, `${GMAIL}/messages/${id}/trash`, { method: "POST", body: {} }),
  );
};

// Archive removes INBOX, mark read removes UNREAD: both are undone from Gmail in one click.
export const removeLabels = async (
  account: Account,
  auth: GoogleAuth,
  fetchFn: typeof fetch,
  ids: string[],
  label: "INBOX" | "UNREAD",
): Promise<void> => {
  if (ids.length === 0) return;
  await googleRequest(auth, account, fetchFn, `${GMAIL}/messages/batchModify`, {
    method: "POST",
    body: { ids, removeLabelIds: [label] },
  });
};
