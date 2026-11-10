import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { XMLParser } from "fast-xml-parser";

import { type NewsTopic, isNewsTopic } from "../../../shared/news.js";

export type Feed = { topic: NewsTopic; name: string; url: string };

// Checked by hand when this list was written; edit ~/.jarvis/news-feeds to change it. Sites that turn away non-browser
// clients (El País, Banca y Negocios) are read through Google News' per-site search, which any client can read.
const DEFAULT_FEEDS = `# One source per line: topic | name | url. Topics: tech, markets, uruguay, venezuela.
tech | Hacker News | https://hnrss.org/frontpage?points=150
tech | The Verge | https://www.theverge.com/rss/index.xml
tech | Ars Technica | https://feeds.arstechnica.com/arstechnica/index
markets | CNBC | https://www.cnbc.com/id/100003114/device/rss/rss.html
markets | MarketWatch | https://feeds.content.dowjones.io/public/rss/mw_topstories
uruguay | El País | https://news.google.com/rss/search?q=site:elpais.com.uy+when:2d&hl=es-419&gl=UY&ceid=UY:es-419
uruguay | El Observador | https://news.google.com/rss/search?q=site:elobservador.com.uy+when:2d&hl=es-419&gl=UY&ceid=UY:es-419
uruguay | Montevideo Portal | https://www.montevideo.com.uy/anxml.aspx?59
uruguay | la diaria | https://ladiaria.com.uy/feeds/articulos/
venezuela | El Pitazo | https://elpitazo.net/feed/
venezuela | TalCual | https://talcualdigital.com/feed/
venezuela | Banca y Negocios | https://news.google.com/rss/search?q=site:bancaynegocios.com+when:2d&hl=es-419&gl=VE&ceid=VE:es-419
`;

// Read on every refresh so editing the file needs no restart; created with the defaults the first time.
export const readFeeds = (file: string): Feed[] => {
  if (!existsSync(file)) writeFileSync(file, DEFAULT_FEEDS, { mode: 0o600 });
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line): Feed[] => {
      const [topic = "", name = "", url = ""] = line.split("|").map((part) => part.trim());
      return isNewsTopic(topic) && name && /^https?:\/\//.test(url) ? [{ topic, name, url }] : [];
    });
};

export type FeedEntry = { title: string; url: string; publishedAt: string | null };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", htmlEntities: true });

const list = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : value ? [value] : []) as Record<string, unknown>[];

// Some feeds escape their titles twice ("&amp;#8217;"): what the parser leaves is decoded once more.
const codePoint = (code: number, original: string): string =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;

const decodeLeftovers = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (match, code: string) => codePoint(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => codePoint(parseInt(code, 16), match))
    .replace(/&amp;/g, "&");

// A title or link may come as plain text or as an element with attributes ({ "#text": … }).
const text = (value: unknown): string =>
  decodeLeftovers(
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : value && typeof value === "object" && "#text" in value
        ? String((value as { "#text": unknown })["#text"]).trim()
        : "",
  );

const isoOrNull = (value: unknown): string | null => {
  const time = Date.parse(text(value));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

// Atom links: the alternate one, or the first without a rel.
const atomLink = (value: unknown): string => {
  const links = list(value);
  const alternate = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return typeof alternate?.["@_href"] === "string" ? alternate["@_href"] : text(value);
};

export const parseFeed = (xml: string): FeedEntry[] => {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };
  if (doc.rss) {
    return list(doc.rss.channel?.item).map((item) => ({
      title: text(item.title),
      url: text(item.link),
      publishedAt: isoOrNull(item.pubDate ?? item["dc:date"]),
    }));
  }
  return list(doc.feed?.entry).map((entry) => ({
    title: text(entry.title),
    url: atomLink(entry.link),
    publishedAt: isoOrNull(entry.published ?? entry.updated),
  }));
};
