import { describe, expect, it } from "vitest";

import type { SweepCategory, SweepFilterAction } from "../../../shared/mail.js";
import { openDb } from "../db.js";
import { createAccountStore } from "../google/accounts.js";
import type { RawMessage } from "../google/gmail.js";
import { GoogleApiError } from "../google/api.js";
import { SETTINGS_SCOPE } from "../google/oauth.js";
import { fakeAuth } from "../google/testing.js";
import { SweepConflict, createMailSweep, isPrivateAddress, oneClickUrl, pacedFetch, senderQuery } from "./sweep.js";

type Fake = {
  id: string;
  from: string;
  category: SweepCategory;
  days: number;
  starred?: boolean;
  archived?: boolean;
  headers?: Record<string, string>;
};

const ONE_CLICK = {
  "List-Unsubscribe": "<mailto:bye@shop.com>, <https://shop.com/unsub?u=1>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
};

const mail = (n: number, from: string, category: SweepCategory, days: number, headers?: Record<string, string>): Fake[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${from}-${category}-${days}-${i}`, from, category, days, headers }));

const MAILBOX: Fake[] = [
  ...mail(5, "Shop <deals@shop.com>", "promotions", 40, ONE_CLICK),
  ...mail(2, "Shop <deals@shop.com>", "updates", 5),
  ...mail(3, "Bank <news@bank.com>", "promotions", 10),
  ...mail(1, "Bank <news@bank.com>", "promotions", 100),
  { id: "kept", from: "Shop <deals@shop.com>", category: "promotions", days: 400, starred: true },
  ...mail(4, "GitHub <noreply@github.com>", "updates", 120),
];

// Understands only the searches the sweep builds: from:, category: (alone or OR-ed), older_than:, in:inbox and -is:starred.
const matches = (m: Fake, q: string): boolean => {
  const from = /from:(\S+)/.exec(q)?.[1];
  const categories = [...q.matchAll(/category:(\w+)/g)].map((x) => x[1]);
  const older = Number(/older_than:(\d+)d/.exec(q)?.[1] ?? 0);
  return (
    (!from || m.from.includes(`<${from}>`)) &&
    (categories.length === 0 || categories.includes(m.category)) &&
    m.days >= older &&
    !(q.includes("-is:starred") && m.starred) &&
    !(q.includes("in:inbox") && m.archived)
  );
};

const setup = (opts: { filtersScope?: boolean; resolve?: string[]; status?: number; filterExists?: boolean } = {}) => {
  const box = new Map(MAILBOX.map((m) => [m.id, m]));
  const trashed: string[] = [];
  const archived: string[] = [];
  const filters: { from: string; action: SweepFilterAction }[] = [];
  const posts: { url: string; address: string; body: string }[] = [];
  let lists = 0;
  const accounts = createAccountStore(openDb(":memory:"));
  accounts.save({
    email: "me@gmail.com",
    kind: "personal",
    refreshToken: "r",
    scopes: opts.filtersScope === false ? "email" : `email ${SETTINGS_SCOPE}`,
  });
  let changes = 0;
  const sweep = createMailSweep({
    auth: fakeAuth(),
    accounts,
    fetchFn: (async () => new Response("{}")) as typeof fetch,
    post: async (url, address, body) => {
      posts.push({ url: String(url), address, body });
      return opts.status ?? 200;
    },
    onChange: () => {
      changes += 1;
    },
    resolve: async () => opts.resolve ?? ["93.184.216.34"],
    gmail: () => ({
      listIds: async (q, limit = Infinity) => {
        lists += 1;
        return [...box.values()]
          .filter((m) => matches(m, q))
          .sort((a, b) => a.days - b.days)
          .slice(0, limit)
          .map((m) => m.id);
      },
      readMetadata: async (ids): Promise<RawMessage[]> =>
        ids.flatMap((id) => {
          const m = box.get(id);
          if (!m) return [];
          const headers = new Map(Object.entries({ From: m.from, ...m.headers }).map(([k, v]) => [k.toLowerCase(), v]));
          return [{ id, threadId: id, internalDate: "0", labelIds: [], headers }];
        }),
      trash: async (ids) => {
        for (const id of ids) {
          trashed.push(id);
          box.delete(id);
        }
      },
      archive: async (ids) => {
        for (const id of ids) {
          archived.push(id);
          const m = box.get(id);
          if (m) m.archived = true;
        }
      },
      filteredSenders: async () => new Set(filters.map((f) => f.from)),
      createFilter: async (from, action) => {
        if (opts.filterExists) {
          filters.push({ from, action });
          throw new GoogleApiError("/settings/filters", 400);
        }
        filters.push({ from, action });
      },
    }),
    now: () => new Date("2026-11-03T12:00:00Z"),
  });
  return { sweep, trashed, archived, filters, posts, changes: () => changes, lists: () => lists };
};

describe("searches", () => {
  it("a sender's search keeps starred mail and stays in its tabs", () => {
    expect(senderQuery("deals@shop.com", ["promotions"])).toBe("from:deals@shop.com category:promotions -is:starred");
    expect(senderQuery("deals@shop.com", ["promotions", "updates"])).toBe(
      "from:deals@shop.com (category:promotions OR category:updates) -is:starred",
    );
  });

  it("an address that is not a plain address never reaches the search", () => {
    expect(() => senderQuery("x@shop.com OR in:inbox", ["promotions"])).toThrow(SweepConflict);
  });
});

describe("one-click unsubscribe", () => {
  const headers = (unsub: string, post = "List-Unsubscribe=One-Click") =>
    new Map([
      ["list-unsubscribe", unsub],
      ["list-unsubscribe-post", post],
    ]);

  it("takes the https link when the sender declares one-click", () => {
    expect(oneClickUrl(headers("<mailto:a@b.com>, <https://shop.com/u?x=1>"))).toBe("https://shop.com/u?x=1");
  });

  it("refuses without the one-click header, over http, to an IP or to a local name", () => {
    expect(oneClickUrl(headers("<https://shop.com/u>", ""))).toBeNull();
    expect(oneClickUrl(headers("<http://shop.com/u>"))).toBeNull();
    expect(oneClickUrl(headers("<https://10.0.0.1/u>"))).toBeNull();
    expect(oneClickUrl(headers("<https://[::1]/u>"))).toBeNull();
    expect(oneClickUrl(headers("<https://router.local/u>"))).toBeNull();
    expect(oneClickUrl(headers("<https://user:pw@shop.com/u>"))).toBeNull();
  });

  it("knows the private ranges, Tailscale's included", () => {
    for (const ip of [
      "10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "100.101.1.1", "169.254.1.1", "198.18.0.1", "224.0.0.1",
      "255.255.255.255", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1",
      "2002:c0a8:101::1", "not-an-ip",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("pace", () => {
  it("spaces Gmail calls out instead of bursting, and counts what they cost", async () => {
    let clock = 1000;
    const waits: number[] = [];
    const { fetchFn, units } = pacedFetch(
      (async () => new Response("{}")) as typeof fetch,
      async (ms) => {
        waits.push(ms);
      },
      () => clock,
    );
    await Promise.all([fetchFn("https://x"), fetchFn("https://x"), fetchFn("https://x")]);
    expect(waits).toEqual([200, 400]);
    expect(units()).toBe(15);
    clock += 10_000;
    await fetchFn("https://x");
    expect(waits).toHaveLength(2);
  });
});

describe("analysis", () => {
  it("ranks senders by their exact count, across the tabs they use", async () => {
    const report = await createdReport();
    expect(report.senders.map((s) => [s.address, s.count, s.categories])).toEqual([
      ["deals@shop.com", 7, ["promotions", "updates"]],
      ["news@bank.com", 4, ["promotions"]],
      ["noreply@github.com", 4, ["updates"]],
    ]);
    expect(report.senders[0]).toMatchObject({ canUnsubscribe: true, filtered: false });
    expect(report.senders[1]?.canUnsubscribe).toBe(false);
  });

  it("counts old mail per tab, never the starred", async () => {
    const report = await createdReport();
    expect(report.ages).toEqual([
      { id: "age:promotions", category: "promotions", olderThanDays: 30, count: 6 },
      { id: "age:updates", category: "updates", olderThanDays: 90, count: 4 },
    ]);
  });

  it("an account without the filters permission is asked to reconnect", async () => {
    const { sweep } = setup({ filtersScope: false });
    expect((await sweep.analyze()).filters).toBe("reconnect");
    await expect(sweep.apply({ id: "sender:deals@shop.com", action: "filter", filterAction: "trash" })).rejects.toThrow(
      /Reconecta/,
    );
  });
});

const createdReport = async () => setup().sweep.analyze();

describe("actions", () => {
  it("trashes everything of a sender in its tabs, keeping the starred, and reports the count", async () => {
    const { sweep, trashed, changes, lists } = setup();
    await sweep.analyze();
    const before = lists();
    const report = await sweep.apply({ id: "sender:deals@shop.com", action: "trash" });
    // Only the sender's own search: the report is patched, not analyzed again.
    expect(lists() - before).toBe(1);
    expect(trashed).toHaveLength(7);
    expect(trashed).not.toContain("kept");
    expect(report.outcome).toEqual({ kind: "trashed", count: 7 });
    expect(report.senders.map((s) => s.address)).not.toContain("deals@shop.com");
    expect(changes()).toBe(1);
  });

  it("archives only what of a sender is still in the inbox, and keeps the row for a trash or a filter", async () => {
    const { sweep, archived, trashed } = setup();
    await sweep.analyze();
    let report = await sweep.apply({ id: "sender:deals@shop.com", action: "archive" });
    expect(archived).toHaveLength(7);
    expect(archived).not.toContain("kept");
    expect(report.outcome).toEqual({ kind: "archived", count: 7 });
    expect(report.senders.map((s) => s.address)).toContain("deals@shop.com");
    report = await sweep.apply({ id: "sender:deals@shop.com", action: "archive" });
    expect(report.outcome).toEqual({ kind: "archived", count: 0 });
    // Archived mail is still the sender's: the trash takes it too.
    report = await sweep.apply({ id: "sender:deals@shop.com", action: "trash" });
    expect(trashed).toHaveLength(7);
  });

  it("trashes old mail of a tab", async () => {
    const { sweep, trashed } = setup();
    await sweep.analyze();
    await sweep.apply({ id: "age:updates", action: "trash" });
    expect(trashed.every((id) => id.startsWith("GitHub"))).toBe(true);
    expect(trashed).toHaveLength(4);
  });

  it("unsubscribes with a bare POST to the sender's one-click link", async () => {
    const { sweep, posts } = setup();
    await sweep.analyze();
    const report = await sweep.apply({ id: "sender:deals@shop.com", action: "unsubscribe" });
    // Sent to the address that was checked, not to a second lookup of the name.
    expect(posts).toEqual([{ url: "https://shop.com/unsub?u=1", address: "93.184.216.34", body: "List-Unsubscribe=One-Click" }]);
    expect(report.outcome).toEqual({ kind: "unsubscribed", name: "Shop" });
    expect(report.senders.find((s) => s.address === "deals@shop.com")?.canUnsubscribe).toBe(false);
    await expect(sweep.apply({ id: "sender:deals@shop.com", action: "unsubscribe" })).rejects.toThrow(SweepConflict);
    expect(posts).toHaveLength(1);
  });

  it("a redirect is not a done unsubscribe", async () => {
    const { sweep } = setup({ status: 302 });
    await sweep.analyze();
    await expect(sweep.apply({ id: "sender:deals@shop.com", action: "unsubscribe" })).rejects.toThrow(/no confirmó/);
  });

  it("a filter Gmail already has counts as made", async () => {
    const { sweep } = setup({ filterExists: true });
    await sweep.analyze();
    const report = await sweep.apply({ id: "sender:news@bank.com", action: "filter", filterAction: "trash" });
    expect(report.outcome).toEqual({ kind: "filtered", name: "Bank" });
  });

  it("a link whose name points inside is never called", async () => {
    const { sweep, posts } = setup({ resolve: ["100.64.0.5"] });
    await sweep.analyze();
    await expect(sweep.apply({ id: "sender:deals@shop.com", action: "unsubscribe" })).rejects.toThrow(SweepConflict);
    expect(posts).toEqual([]);
  });

  it("a sender without one-click cannot be unsubscribed", async () => {
    const { sweep } = setup();
    await sweep.analyze();
    await expect(sweep.apply({ id: "sender:news@bank.com", action: "unsubscribe" })).rejects.toThrow(SweepConflict);
  });

  it("a filter is created by address and the sender shows as filtered", async () => {
    const { sweep, filters } = setup();
    await sweep.analyze();
    const report = await sweep.apply({ id: "sender:news@bank.com", action: "filter", filterAction: "skip_inbox" });
    expect(filters).toEqual([{ from: "news@bank.com", action: "skip_inbox" }]);
    expect(report.senders.find((s) => s.address === "news@bank.com")?.filtered).toBe(true);
  });

  it("an id the last analysis did not show is refused", async () => {
    const { sweep, trashed } = setup();
    await expect(sweep.apply({ id: "sender:deals@shop.com", action: "trash" })).rejects.toThrow(/Vuelve a analizar/);
    await sweep.analyze();
    await expect(sweep.apply({ id: "sender:someone@else.com", action: "trash" })).rejects.toThrow(SweepConflict);
    expect(trashed).toEqual([]);
  });
});
