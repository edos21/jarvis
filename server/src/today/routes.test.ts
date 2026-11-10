import { describe, expect, it } from "vitest";

import type { TodayResponse } from "../../../shared/today.js";
import { EMPTY_WALLET } from "../../../shared/wallet.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createPaymentStore } from "../payments/store.js";
import { type Voice, VoiceError } from "../voice/elevenlabs.js";
import type { BriefingWriter } from "./briefing.js";
import { todayRoutes } from "./routes.js";
import { createBriefingSeenStore } from "./seen.js";

const briefing: BriefingWriter = { current: () => ({ briefing: null, briefingStatus: "pending" }), wrote: () => false };

describe("GET /api/today", () => {
  it("answers fast with the work section down when Pepper hangs", async () => {
    const payments = createPaymentStore(openDb(":memory:"));
    const app = createApp({
      tailnetHost: null,
      routes: [
        todayRoutes(
          {
            payments,
            mac: { read: async () => Promise.reject(new Error("top failed")) },
            work: { read: async () => Promise.reject(new Error("pepper timeout")) },
            agenda: { read: async () => ({ items: [], tasks: [], reconnect: [] }) },
            mail: { read: async () => ({ mailboxes: [] }) },
            wallet: { read: async () => EMPTY_WALLET },
            seen: createBriefingSeenStore(openDb(":memory:")),
          },
          briefing,
        ),
      ],
    });
    const started = Date.now();
    const res = await app.request("http://127.0.0.1:4417/api/today");
    const body = (await res.json()) as TodayResponse;
    expect(res.status).toBe(200);
    expect(body.sourceErrors).toEqual(["work", "mac"]);
    expect(body.cards).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(body.briefingVoice).toBe(false);
  });
});

describe("GET /api/today/briefing/audio", () => {
  const WRITTEN = "Buenos días, señor. La tarjeta vence hoy.";
  const sources = () => ({
    payments: createPaymentStore(openDb(":memory:")),
    mac: { read: async () => Promise.reject(new Error("off")) },
    work: { read: async () => Promise.reject(new Error("off")) },
    agenda: { read: async () => ({ items: [], tasks: [], reconnect: [] }) },
    mail: { read: async () => ({ mailboxes: [] }) },
    wallet: { read: async () => EMPTY_WALLET },
    seen: createBriefingSeenStore(openDb(":memory:")),
  });
  const writer: BriefingWriter = { ...briefing, wrote: (text) => text === WRITTEN };
  const appWith = (voice: Voice | null) =>
    createApp({ tailnetHost: null, routes: [todayRoutes(sources(), writer, voice)] });
  const audioUrl = (text: string) => `http://127.0.0.1:4417/api/today/briefing/audio?text=${encodeURIComponent(text)}`;

  it("is off without a voice", async () => {
    const res = await appWith(null).request(audioUrl(WRITTEN));
    expect(res.status).toBe(503);
  });

  it("speaks only a briefing Jarvis wrote", async () => {
    const spoken: string[] = [];
    const voice: Voice = { audio: async (text) => (spoken.push(text), Buffer.from("mp3")) };
    const res = await appWith(voice).request(audioUrl("Cualquier texto que alguien quiera facturar"));
    expect(res.status).toBe(404);
    expect(spoken).toEqual([]);
  });

  it("returns the briefing as MP3", async () => {
    const voice: Voice = { audio: async () => Buffer.from("mp3") };
    const res = await appWith(voice).request(audioUrl(WRITTEN));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("mp3");
  });

  it("answers 502 when the voice fails", async () => {
    const voice: Voice = { audio: async () => Promise.reject(new VoiceError("elevenlabs answered 429")) };
    const res = await appWith(voice).request(audioUrl(WRITTEN));
    expect(res.status).toBe(502);
  });
});

describe("briefing seen", () => {
  const TAILNET = "mac.tail1234.ts.net";
  const setup = () => {
    let now = new Date(2026, 10, 10, 8, 30);
    const db = openDb(":memory:");
    const app = createApp({
      tailnetHost: TAILNET,
      routes: [
        todayRoutes(
          {
            payments: createPaymentStore(db),
            mac: { read: async () => Promise.reject(new Error("off")) },
            work: { read: async () => Promise.reject(new Error("off")) },
            agenda: { read: async () => ({ items: [], tasks: [], reconnect: [] }) },
            mail: { read: async () => ({ mailboxes: [] }) },
            wallet: { read: async () => EMPTY_WALLET },
            seen: createBriefingSeenStore(db),
            now: () => now,
          },
          briefing,
        ),
      ],
    });
    const seen = async (host = "http://127.0.0.1:4417") =>
      ((await (await app.request(`${host}/api/today`)).json()) as TodayResponse).briefingSeen;
    return { app, seen, moveTo: (d: Date) => (now = d) };
  };

  it("is unread until marked, on every screen", async () => {
    const { app, seen } = setup();
    expect(await seen()).toBe(false);
    const res = await app.request("http://127.0.0.1:4417/api/today/briefing/seen", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seenOn: "2026-11-10" });
    expect(await seen()).toBe(true);
    expect(await seen(`https://${TAILNET}`)).toBe(true);
  });

  it("can be marked from the phone", async () => {
    const { app, seen } = setup();
    const res = await app.request(`https://${TAILNET}/api/today/briefing/seen`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await seen()).toBe(true);
  });

  it("is unread again the next day", async () => {
    const { app, seen, moveTo } = setup();
    await app.request("http://127.0.0.1:4417/api/today/briefing/seen", { method: "POST" });
    moveTo(new Date(2026, 10, 11, 7, 0));
    expect(await seen()).toBe(false);
  });
});
