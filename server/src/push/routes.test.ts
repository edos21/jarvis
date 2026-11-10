import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createNotifier } from "./notifier.js";
import { pushRoutes } from "./routes.js";

describe("push routes", () => {
  it("accepts a real push service and rejects any other URL", async () => {
    const notifier = createNotifier(openDb(":memory:"), async () => undefined);
    const app = createApp({ tailnetHost: "mac.tail1234.ts.net", routes: [pushRoutes(notifier, "PUB")] });
    const subscribe = (endpoint: string) =>
      app.request("https://mac.tail1234.ts.net/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint, keys: { p256dh: "p", auth: "a" } }),
      });
    expect((await subscribe("http://127.0.0.1:4317/api/board")).status).toBe(400);
    expect((await subscribe("https://fcm.googleapis.com/fcm/send/abc")).status).toBe(200);
    expect(notifier.subscriptions().map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/abc"]);
  });
});
