import { describe, expect, it } from "vitest";

import { openDb } from "../db.js";
import { createNotifier, type PushSender } from "./notifier.js";

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });
const event = { key: "payment:1:2026-10:due_today", title: "Pagar Alquiler", body: "Vence hoy", url: "/#hoy" };

describe("notifier", () => {
  it("same key is sent once across notifier instances", async () => {
    const db = openDb(":memory:");
    const sent: string[] = [];
    const send: PushSender = async (s) => {
      sent.push(s.endpoint);
    };
    createNotifier(db, send).subscribe(sub("https://push/1"));
    expect(await createNotifier(db, send).notify(event)).toBe("sent");
    // A restart builds a new notifier on the same database.
    expect(await createNotifier(db, send).notify(event)).toBe("duplicate");
    expect(sent).toEqual(["https://push/1"]);
  });

  it("410 deletes the subscription and keeps sending to others", async () => {
    const db = openDb(":memory:");
    const sent: string[] = [];
    const send: PushSender = async (s) => {
      if (s.endpoint === "https://push/gone") throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (s.endpoint === "https://push/flaky") throw Object.assign(new Error("Bad gateway"), { statusCode: 502 });
      sent.push(s.endpoint);
    };
    const notifier = createNotifier(db, send);
    notifier.subscribe(sub("https://push/gone"));
    notifier.subscribe(sub("https://push/flaky"));
    notifier.subscribe(sub("https://push/ok"));
    await notifier.notify(event);
    expect(sent).toEqual(["https://push/ok"]);
    expect(notifier.subscriptions().map((s) => s.endpoint)).toEqual(["https://push/flaky", "https://push/ok"]);
  });

  it("without subscriptions nothing is marked sent", async () => {
    const db = openDb(":memory:");
    const notifier = createNotifier(db, async () => undefined);
    expect(await notifier.notify(event)).toBe("no_subscribers");
    notifier.subscribe(sub("https://push/1"));
    expect(await notifier.notify(event)).toBe("sent");
  });
});

describe("delivery failures", () => {
  it("a send that fails everywhere is retried on the next tick", async () => {
    const db = openDb(":memory:");
    let up = false;
    const send: PushSender = async () => {
      if (!up) throw Object.assign(new Error("Bad gateway"), { statusCode: 502 });
    };
    const notifier = createNotifier(db, send);
    notifier.subscribe(sub("https://push/1"));
    expect(await notifier.notify(event)).toBe("failed");
    up = true;
    expect(await notifier.notify(event)).toBe("sent");
    expect(await notifier.notify(event)).toBe("duplicate");
  });
});
