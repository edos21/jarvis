import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readAgenda } from "./calendar.js";
import { GoogleAuthExpired, type GoogleAuth } from "./oauth.js";

const events = readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8");

const auth = (expired: string[] = []): GoogleAuth => ({
  authUrl: () => "",
  exchange: async () => {
    throw new Error("unused");
  },
  accessToken: async ({ email }) => {
    if (expired.includes(email)) throw new GoogleAuthExpired(email);
    return "token";
  },
  revoke: async () => undefined,
  forget: () => undefined,
});

const urls: string[] = [];
const fetchFn = (async (url: string) => {
  urls.push(url);
  return new Response(events, { status: 200 });
}) as typeof fetch;

const account = { email: "me@gmail.com", refreshToken: "r" };

// The fixtures are in Uruguay's offset (-03:00), the zone the tests run the day in.
process.env.TZ = "America/Montevideo";

describe("readAgenda", () => {
  it("all-day event shows today and not tomorrow", async () => {
    const { items } = await readAgenda([account], auth(), fetchFn, new Date(2026, 9, 31, 9));
    expect(items.map((i) => i.id)).toContain("allday-today");
    expect(items.map((i) => i.id)).not.toContain("allday-tomorrow");
  });

  it("event crossing midnight shows on both days", async () => {
    const today = await readAgenda([account], auth(), fetchFn, new Date(2026, 9, 31, 9));
    const tomorrow = await readAgenda([account], auth(), fetchFn, new Date(2026, 10, 1, 0, 30));
    expect(today.items.map((i) => i.id)).toContain("late-night");
    expect(tomorrow.items.map((i) => i.id)).toContain("late-night");
    expect(tomorrow.items.map((i) => i.id)).toContain("allday-tomorrow");
  });

  it("declined events are left out and the rest keep their link and place", async () => {
    const { items } = await readAgenda([account], auth(), fetchFn, new Date(2026, 9, 31, 9));
    expect(items.map((i) => i.id)).not.toContain("declined");
    expect(items.find((i) => i.id === "dentist")).toMatchObject({
      title: "Dentista",
      location: "Av. Brasil 2500",
      allDay: false,
      url: "https://www.google.com/calendar/event?eid=5",
    });
  });

  it("orders all-day first, then by start", async () => {
    const { items } = await readAgenda([account], auth(), fetchFn, new Date(2026, 9, 31, 9));
    expect(items.map((i) => i.id)).toEqual(["allday-today", "dentist", "late-night"]);
  });

  it("asks only for the local day's window", async () => {
    urls.length = 0;
    await readAgenda([account], auth(), fetchFn, new Date(2026, 9, 31, 9));
    const url = new URL(urls[0] ?? "");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("timeMin")).toBe(new Date(2026, 9, 31).toISOString());
    expect(url.searchParams.get("timeMax")).toBe(new Date(2026, 10, 1).toISOString());
  });

  it("expired token → reconnect lists the email, no throw", async () => {
    const result = await readAgenda([account], auth(["me@gmail.com"]), fetchFn, new Date(2026, 9, 31, 9));
    expect(result).toEqual({ items: [], reconnect: ["me@gmail.com"] });
  });
});
