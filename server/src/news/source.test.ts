import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFeed, readFeeds } from "./feeds.js";
import { createNewsSource } from "./source.js";

const rss = readFileSync(new URL("./fixtures/rss.xml", import.meta.url), "utf8");
const atom = readFileSync(new URL("./fixtures/atom.xml", import.meta.url), "utf8");
const now = new Date("2026-10-30T18:00:00Z");

describe("parseFeed", () => {
  it("parses RSS and Atom, CDATA and entities", () => {
    expect(parseFeed(rss).map((i) => i.title)).toEqual([
      "El BCU mantiene la tasa & sorprende",
      "Nvidia’s earnings & AI",
      "Muy vieja",
      "Here’s why you can't & won’t",
      "Sin fecha",
    ]);
    expect(parseFeed(atom)).toEqual([
      { title: "Apple ships <b>M6</b>", url: "https://example.com/c", publishedAt: "2026-10-30T14:00:00.000Z" },
      { title: "Same story again", url: "https://example.com/b", publishedAt: "2026-10-30T10:00:00.000Z" },
    ]);
  });
});

describe("readFeeds", () => {
  it("the feeds file is created with defaults and re-read", () => {
    const file = join(mkdtempSync(join(tmpdir(), "jarvis-news-")), "news-feeds");
    const defaults = readFeeds(file);
    expect(new Set(defaults.map((f) => f.topic))).toEqual(new Set(["tech", "markets", "uruguay", "venezuela"]));
    writeFileSync(file, "# mine\ntech | Mine | https://mine.example/rss\nbogus line\nsports | Nope | https://x\n");
    expect(readFeeds(file)).toEqual([{ topic: "tech", name: "Mine", url: "https://mine.example/rss" }]);
  });
});

describe("news source", () => {
  const setup = (tickers: string[] = []) => {
    const file = join(mkdtempSync(join(tmpdir(), "jarvis-news-")), "news-feeds");
    writeFileSync(file, "uruguay | Uno | https://one.example/rss\ntech | Dos | https://two.example/atom\ntech | Caída | https://down.example/rss\n");
    const fetched: string[] = [];
    const fetchFn = (async (url: string) => {
      fetched.push(url);
      if (url.startsWith("https://down.example")) return new Response("", { status: 503 });
      if (url.includes("finance.yahoo.com")) return new Response(rss.replace(/example\.uy\/a/, "example.com/crdo"));
      return new Response(url.includes("atom") ? atom : rss);
    }) as typeof fetch;
    return { source: createNewsSource({ feedsFile: file, fetchFn, tickers: () => tickers, now: () => now }), fetched };
  };

  it("a failing feed is listed in errors and the rest load", async () => {
    const { source } = setup();
    const news = await source.read();
    expect(news.errors).toEqual(["Caída"]);
    expect(news.items.length).toBeGreaterThan(0);
  });

  it("items older than 48h or without a date are dropped, duplicates merged, newest first", async () => {
    const { source } = setup();
    const { items } = await source.read();
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain("https://example.uy/old");
    expect(urls).not.toContain("https://example.uy/nodate");
    expect(urls.filter((u) => u === "https://example.com/b")).toHaveLength(1);
    expect(items.map((i) => i.publishedAt)).toEqual([...items.map((i) => i.publishedAt)].sort().reverse());
  });

  it("filters by topic", async () => {
    const { source } = setup();
    const { items } = await source.read("tech");
    expect(new Set(items.map((i) => i.topic))).toEqual(new Set(["tech"]));
  });

  it("held tickers add Yahoo headlines under markets, tagged with the ticker", async () => {
    const { source, fetched } = setup(["CRDO"]);
    const { items } = await source.read("markets");
    expect(fetched.some((u) => u.includes("s=CRDO"))).toBe(true);
    expect(items.find((i) => i.url === "https://example.com/crdo")).toMatchObject({ topic: "markets", ticker: "CRDO", source: "CRDO" });
  });

  it("reads once and serves the cache until refreshed", async () => {
    const { source, fetched } = setup();
    await source.read();
    const calls = fetched.length;
    await source.read("tech");
    expect(fetched.length).toBe(calls);
    await source.refresh();
    expect(fetched.length).toBeGreaterThan(calls);
  });
});
