export type NewsTopic = "tech" | "markets" | "uruguay" | "venezuela";

export const NEWS_TOPICS: readonly NewsTopic[] = ["tech", "markets", "uruguay", "venezuela"];

export const isNewsTopic = (value: string): value is NewsTopic => (NEWS_TOPICS as readonly string[]).includes(value);

// ticker: set for a held ticker's own headlines (Yahoo), so they can be shown next to the wallet.
export type NewsItem = {
  id: string;
  topic: NewsTopic;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  ticker: string | null;
};

// errors: the names of the feeds that did not answer this time.
export type NewsResponse = { items: NewsItem[]; errors: string[]; fetchedAt: string | null };
