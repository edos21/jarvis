import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

import {
  ADDRESS,
  type SweepAge,
  type SweepApply,
  type SweepCategory,
  type SweepFilterAction,
  type SweepOutcome,
  type SweepReport,
  type SweepSender,
} from "../../../shared/mail.js";
import type { AccountStore, StoredAccount } from "../google/accounts.js";
import { GoogleApiError } from "../google/api.js";
import {
  type RawMessage,
  createFilter,
  listFilteredSenders,
  listIds,
  readMetadata,
  archiveByIds,
  trashByIds,
} from "../google/gmail.js";
import { SETTINGS_SCOPE, type GoogleAuth } from "../google/oauth.js";
import { parseFrom } from "./classify.js";

// How many of the newest messages of each tab are read to rank senders. Reading all 20 thousand would take most of
// an hour at Gmail's pace; the ranking only needs the loud ones, and their counts are exact anyway.
const SAMPLE_PER_CATEGORY = 200;
const TOP_SENDERS = 20;
const AGE_DAYS: Record<SweepCategory, number> = { promotions: 30, updates: 90 };
const CATEGORIES: readonly SweepCategory[] = ["promotions", "updates"];
const UNSUBSCRIBE_TIMEOUT_MS = 10_000;

export class SweepConflict extends Error {}

// Starred mail is never touched: a star is the owner saying "keep this".
const KEEP = "-is:starred";

export const ageQuery = (category: SweepCategory): string => `category:${category} older_than:${AGE_DAYS[category]}d ${KEEP}`;

// The address is checked against a plain-address pattern first, so nothing else can ride into the search.
export const senderQuery = (address: string, categories: readonly SweepCategory[]): string => {
  if (!ADDRESS.test(address)) throw new SweepConflict("Ese remitente tiene una dirección inesperada.");
  const tabs = categories.map((c) => `category:${c}`);
  return `from:${address} ${tabs.length === 1 ? tabs[0] : `(${tabs.join(" OR ")})`} ${KEEP}`;
};

const LOCAL_HOST = /(^|\.)(localhost|local|internal|lan|home|arpa)$/i;

// RFC 8058 one-click only: the sender says a bare POST unsubscribes, so nothing needs a browser or a sent mail.
// A link to an IP or a local name is refused before it is ever stored.
export const oneClickUrl = (headers: ReadonlyMap<string, string>): string | null => {
  if (!/List-Unsubscribe=One-Click/i.test(headers.get("list-unsubscribe-post") ?? "")) return null;
  for (const [, raw] of (headers.get("list-unsubscribe") ?? "").matchAll(/<([^>]+)>/g)) {
    try {
      const url = new URL(raw?.trim() ?? "");
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (url.protocol === "https:" && !url.username && !url.password && isIP(host) === 0 && !LOCAL_HOST.test(host)) {
        return url.toString();
      }
    } catch {
      // Not a URL: try the next one.
    }
  }
  return null;
};

// Every range that is not the public internet: this Mac, the LAN, Tailscale (100.64/10), documentation, multicast,
// and the IPv6 forms that tunnel to IPv4 (mapped, NAT64, 6to4, Teredo), which a sender has no reason to use.
// One list per family: a BlockList checks an IPv4 against IPv6 rules too, as ::ffff:a.b.c.d, so the mapped range
// would swallow every IPv4.
const NOT_PUBLIC_V4 = new BlockList();
const NOT_PUBLIC_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  NOT_PUBLIC_V4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) {
  NOT_PUBLIC_V6.addSubnet(net, prefix, "ipv6");
}

// A public name can still point inside: Tailscale, the router, this Mac.
export const isPrivateAddress = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return NOT_PUBLIC_V4.check(ip, "ipv4");
  return family === 0 || NOT_PUBLIC_V6.check(ip, "ipv6");
};

// POSTs to the address that was checked, never to whatever a second lookup of the name returns: a sender with a
// zero-TTL record could otherwise pass the check and then point the request inside. Redirects are not followed.
export type PinnedPost = (url: URL, address: string, body: string) => Promise<number>;

export const pinnedPost: PinnedPost = (url, address, body) =>
  new Promise((resolve, reject) => {
    const family = isIP(address);
    const req = request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
        // A fresh connection: a kept-alive socket to the same name would skip the pinned lookup.
        agent: false,
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        timeout: UNSUBSCRIBE_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });

export type SweepGmail = {
  listIds(q: string, limit?: number): Promise<string[]>;
  readMetadata(ids: string[]): Promise<RawMessage[]>;
  trash(ids: string[]): Promise<void>;
  archive(ids: string[]): Promise<void>;
  filteredSenders(): Promise<Set<string>>;
  createFilter(from: string, action: SweepFilterAction): Promise<void>;
};

// Gmail charges about 5 units per list or read and cuts a user off past a per-minute budget, so the sweep spends at a
// steady pace instead of in a burst: every call to Gmail waits for its turn. Measured on this account: 100 a second
// was cut off after 1290 units; 25 a second ran a whole analysis.
const UNITS_PER_CALL = 5;
const UNITS_PER_SECOND = 25;

const PACED_TIMEOUT_MS = 10_000;

export const pacedFetch = (
  fetchFn: typeof fetch,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
) => {
  let nextAt = 0;
  let units = 0;
  const paced = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const at = Math.max(now(), nextAt);
    nextAt = at + (UNITS_PER_CALL / UNITS_PER_SECOND) * 1000;
    if (at > now()) await sleep(at - now());
    units += UNITS_PER_CALL;
    // The caller's timeout started before the wait in line: the request gets its own from the moment it is sent.
    return fetchFn(input, { ...init, signal: AbortSignal.timeout(PACED_TIMEOUT_MS) });
  }) as typeof fetch;
  return { fetchFn: paced, units: () => units };
};

export const gmailFor = (account: StoredAccount, auth: GoogleAuth, fetchFn: typeof fetch): SweepGmail => ({
  listIds: (q, limit) => listIds(account, auth, fetchFn, q, limit),
  readMetadata: (ids) => readMetadata(account, auth, fetchFn, ids),
  trash: (ids) => trashByIds(account, auth, fetchFn, ids),
  archive: (ids) => archiveByIds(account, auth, fetchFn, ids),
  filteredSenders: () => listFilteredSenders(account, auth, fetchFn),
  createFilter: (from, action) => createFilter(account, auth, fetchFn, from, action),
});

type Sampled = { address: string; name: string; categories: Set<SweepCategory>; seen: number; unsubscribe: string | null };

// Newest first, so a sender's name and unsubscribe link come from its latest mail.
export const rankSenders = (sampled: { category: SweepCategory; messages: RawMessage[] }[]): Sampled[] => {
  const senders = new Map<string, Sampled>();
  for (const { category, messages } of sampled) {
    for (const m of messages) {
      const { address, name } = parseFrom(m.headers.get("from") ?? "");
      if (!ADDRESS.test(address)) continue;
      const s = senders.get(address) ?? { address, name, categories: new Set(), seen: 0, unsubscribe: null };
      s.categories.add(category);
      s.seen += 1;
      s.unsubscribe ??= oneClickUrl(m.headers);
      senders.set(address, s);
    }
  }
  return [...senders.values()].sort((a, b) => b.seen - a.seen);
};

export const createMailSweep = (deps: {
  auth: GoogleAuth | null;
  accounts: AccountStore;
  fetchFn: typeof fetch;
  // The mail page reads the inbox again after a cleanup.
  onChange: () => void;
  gmail?: (account: StoredAccount, auth: GoogleAuth) => SweepGmail;
  resolve?: (host: string) => Promise<string[]>;
  post?: PinnedPost;
  now?: () => Date;
}) => {
  const now = deps.now ?? (() => new Date());
  // One pace for the sweep's whole life: an analysis right after a cleanup must not burst either.
  const paced = pacedFetch(deps.fetchFn);
  const gmailOf = deps.gmail ?? ((account: StoredAccount, auth: GoogleAuth) => gmailFor(account, auth, paced.fetchFn));
  const resolve =
    deps.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map((a) => a.address));
  const post = deps.post ?? pinnedPost;
  let last: SweepReport | null = null;
  // The unsubscribe links stay here: the page only ever sends a sender's id.
  let links = new Map<string, string>();

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const connection = (): { account: StoredAccount; gmail: SweepGmail; filters: boolean } => {
    const account = deps.accounts.list().find((a) => a.kind === "personal");
    if (!account || !deps.auth) throw new SweepConflict("Conecta tu Gmail personal para limpiarlo.");
    return { account, gmail: gmailOf(account, deps.auth), filters: account.scopes.split(" ").includes(SETTINGS_SCOPE) };
  };

  const build = async (outcome: SweepOutcome | null): Promise<SweepReport> => {
    const { account, gmail, filters } = connection();
    // All at once on purpose: the pace of the fetch keeps Gmail under its limit, whatever is asked in parallel.
    const sampledP = Promise.all(
      CATEGORIES.map(async (category) => ({
        category,
        messages: await gmail.readMetadata(await gmail.listIds(`category:${category} ${KEEP}`, SAMPLE_PER_CATEGORY)),
      })),
    );
    const agesP = Promise.all(
      CATEGORIES.map(
        async (category): Promise<SweepAge> => ({
          id: `age:${category}`,
          category,
          olderThanDays: AGE_DAYS[category],
          count: (await gmail.listIds(ageQuery(category))).length,
        }),
      ),
    );
    const filteredP = filters ? gmail.filteredSenders() : Promise.resolve(new Set<string>());
    const [sampled, ages, filtered] = await Promise.all([sampledP, agesP, filteredP]);
    const top = rankSenders(sampled).slice(0, TOP_SENDERS);
    const counted = await Promise.all(
      top.map(async (s): Promise<SweepSender> => {
        const categories = CATEGORIES.filter((c) => s.categories.has(c));
        return {
          id: `sender:${s.address}`,
          address: s.address,
          name: s.name,
          categories,
          count: (await gmail.listIds(senderQuery(s.address, categories))).length,
          canUnsubscribe: s.unsubscribe !== null,
          filtered: filtered.has(s.address),
        };
      }),
    );
    links = new Map(top.flatMap((s) => (s.unsubscribe ? [[s.address, s.unsubscribe] as const] : [])));
    return {
      analyzedAt: now().toISOString(),
      account: account.email,
      filters: filters ? "ok" : "reconnect",
      ages: ages.filter((a) => a.count > 0),
      senders: counted.filter((s) => s.count > 0).sort((a, b) => b.count - a.count),
      outcome,
    };
  };

  const unsubscribe = async (sender: SweepSender): Promise<void> => {
    const link = links.get(sender.address);
    if (!link) throw new SweepConflict("Ese remitente no ofrece darse de baja con un clic.");
    const url = new URL(link);
    const addresses = await resolve(url.hostname).catch(() => []);
    const [address] = addresses;
    if (!address || addresses.some(isPrivateAddress)) {
      throw new SweepConflict("El enlace para darse de baja apunta a un lugar raro: no lo usé.");
    }
    const status = await post(url, address, "List-Unsubscribe=One-Click").catch(() => 0);
    // One-click answers 2xx when it is done; a redirect means a page still wants a click, so it is not done.
    if (status < 200 || status >= 300) {
      throw new SweepConflict("El remitente no confirmó la baja. Prueba desde el enlace del correo.");
    }
  };

  const perform = async (request: SweepApply): Promise<SweepOutcome> => {
    const { gmail, filters } = connection();
    const age = last?.ages.find((a) => a.id === request.id);
    const sender = last?.senders.find((s) => s.id === request.id);
    if (age && request.action === "trash") {
      // Searched again at the click: what got old since the analysis goes too.
      const ids = await gmail.listIds(ageQuery(age.category));
      await gmail.trash(ids);
      return { kind: "trashed", count: ids.length };
    }
    if (!sender) throw new SweepConflict("Eso ya no aparece en el análisis. Vuelve a analizar.");
    switch (request.action) {
      case "trash": {
        const ids = await gmail.listIds(senderQuery(sender.address, sender.categories));
        await gmail.trash(ids);
        return { kind: "trashed", count: ids.length };
      }
      case "archive": {
        // Only what is still in the inbox: the rest is already archived.
        const ids = await gmail.listIds(`${senderQuery(sender.address, sender.categories)} in:inbox`);
        await gmail.archive(ids);
        return { kind: "archived", count: ids.length };
      }
      case "unsubscribe":
        await unsubscribe(sender);
        links.delete(sender.address);
        return { kind: "unsubscribed", name: sender.name };
      case "filter":
        if (!filters) throw new SweepConflict("Reconecta tu Gmail para crear filtros.");
        try {
          await gmail.createFilter(sender.address, request.filterAction);
        } catch (error) {
          // Gmail answers 400 to a filter it already has, made from its own page or by a click whose answer got lost.
          if (!(error instanceof GoogleApiError && error.status === 400 && (await gmail.filteredSenders()).has(sender.address))) {
            throw error;
          }
        }
        return { kind: "filtered", name: sender.name };
    }
  };

  return {
    latest: (): SweepReport | null => last,
    analyze: (): Promise<SweepReport> =>
      serial(async () => {
        const before = paced.units();
        try {
          last = await build(null);
        } catch (error) {
          console.error(`mail sweep: analysis failed after ${paced.units() - before} Gmail units`);
          throw error;
        }
        return last;
      }),
    // The report is patched, not analyzed again: a new analysis takes minutes of Gmail's budget, and failing it would
    // make an action that worked look like one that did not.
    apply: (request: SweepApply): Promise<SweepReport> =>
      serial(async () => {
        let outcome: SweepOutcome;
        try {
          outcome = await perform(request);
        } finally {
          deps.onChange();
        }
        const report = last;
        if (!report) throw new SweepConflict("Vuelve a analizar.");
        last = patched(report, request, outcome);
        return last;
      }),
  };
};

// What the action changed, written into the report: a trashed row goes, an unsubscribed or filtered sender says so,
// and an archived one stays, since its mail is still there to trash or to filter.
const patched = (report: SweepReport, request: SweepApply, outcome: SweepOutcome): SweepReport => ({
  ...report,
  ages: request.action === "trash" ? report.ages.filter((a) => a.id !== request.id) : report.ages,
  senders: report.senders.flatMap((s) => {
    if (s.id !== request.id) return [s];
    if (outcome.kind === "trashed") return [];
    if (outcome.kind === "archived") return [s];
    return [outcome.kind === "unsubscribed" ? { ...s, canUnsubscribe: false } : { ...s, filtered: true }];
  }),
  outcome,
});

export type MailSweep = ReturnType<typeof createMailSweep>;
