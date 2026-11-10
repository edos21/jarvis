import { createHash } from "node:crypto";

import type { NewsItem, NewsResponse, NewsTopic } from "../../../shared/news.js";
import { type Feed, parseFeed, readFeeds } from "./feeds.js";

const MAX_AGE_MS = 48 * 60 * 60_000;
const PER_FEED = 15;
// Headlines are read every two hours while I am awake; outside that the last read stays.
const REFRESH_MS = 2 * 60 * 60_000;
const AWAKE = { from: 7, to: 22 };

export type NewsSource = {
  read(topic?: NewsTopic): Promise<NewsResponse>;
  refresh(): Promise<void>;
  tick(now: Date): Promise<void>;
};

const tickerFeed = (ticker: string): Feed & { ticker: string } => ({
  topic: "markets",
  name: ticker,
  url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
  ticker,
});

export const createNewsSource = (deps: {
  feedsFile: string;
  fetchFn: typeof fetch;
  // The held tickers, for their own headlines.
  tickers: () => string[];
  now?: () => Date;
}): NewsSource => {
  const now = deps.now ?? (() => new Date());
  let cached: { items: NewsItem[]; errors: string[]; at: Date } | null = null;
  let running: Promise<void> | null = null;

  const readFeed = async (feed: Feed & { ticker?: string }): Promise<NewsItem[]> => {
    const res = await deps.fetchFn(feed.url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Mozilla/5.0 Jarvis", accept: "application/rss+xml, application/atom+xml, text/xml" },
    });
    if (!res.ok) throw new Error(`${feed.name} answered ${res.status}`);
    const cutoff = now().getTime() - MAX_AGE_MS;
    return parseFeed(await res.text())
      // Only web links: a feed is outside content and could carry anything else.
      .filter((e): e is typeof e & { publishedAt: string } => Boolean(e.title && /^https?:\/\//.test(e.url) && e.publishedAt))
      .filter((e) => Date.parse(e.publishedAt) >= cutoff)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, PER_FEED)
      .map((e) => ({
        id: createHash("sha256").update(e.url).digest("hex").slice(0, 16),
        topic: feed.topic,
        source: feed.name,
        title: e.title,
        url: e.url,
        publishedAt: e.publishedAt,
        ticker: feed.ticker ?? null,
      }));
  };

  const doRefresh = async (): Promise<void> => {
    const feeds = [...readFeeds(deps.feedsFile), ...deps.tickers().map(tickerFeed)];
    const items: NewsItem[] = [];
    const errors: string[] = [];
    for (let i = 0; i < feeds.length; i += 4) {
      const batch = feeds.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map(readFeed));
      results.forEach((result, j) => {
        if (result.status === "fulfilled") items.push(...result.value);
        else errors.push(batch[j]?.name ?? "?");
      });
    }
    // The same story from two feeds shows once.
    const byUrl = new Map<string, NewsItem>();
    for (const item of items) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    cached = {
      items: [...byUrl.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
      errors,
      at: now(),
    };
  };

  const refresh = (): Promise<void> => {
    running ??= doRefresh().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    read: async (topic) => {
      if (!cached) await refresh();
      const items = cached?.items ?? [];
      return {
        items: topic ? items.filter((i) => i.topic === topic) : items,
        errors: cached?.errors ?? [],
        fetchedAt: cached?.at.toISOString() ?? null,
      };
    },
    refresh,
    tick: async (at) => {
      const awake = at.getHours() >= AWAKE.from && at.getHours() < AWAKE.to;
      if (awake && (!cached || at.getTime() - cached.at.getTime() >= REFRESH_MS)) await refresh().catch(() => undefined);
    },
  };
};
