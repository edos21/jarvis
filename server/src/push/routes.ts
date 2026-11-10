import type { Hono } from "hono";

import type { PushSubscriptionInput } from "../../../shared/push.js";
import type { ApiError } from "../app.js";
import type { Notifier } from "./notifier.js";

// Only the real push services: a subscription is a URL the server will POST to.
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

const isPushEndpoint = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
};

export const pushRoutes =
  (notifier: Notifier, publicKey: string) =>
  (app: Hono): void => {
    app.get("/push/key", (c) => c.json({ publicKey }));

    app.post("/push/subscribe", async (c) => {
      const body = await c.req.json<PushSubscriptionInput>().catch(() => null);
      if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth || !isPushEndpoint(body.endpoint)) {
        return c.json<ApiError>({ error: "Suscripción inválida." }, 400);
      }
      notifier.subscribe(body);
      return c.json({ ok: true });
    });

    app.delete("/push/subscribe", async (c) => {
      const body = await c.req.json<{ endpoint?: string }>().catch(() => null);
      if (body?.endpoint) notifier.unsubscribe(body.endpoint);
      return c.json({ ok: true });
    });
  };
