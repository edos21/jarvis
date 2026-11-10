import { eq } from "drizzle-orm";

import type { PushEvent, PushSubscriptionInput } from "../../../shared/push.js";
import type { Db } from "../db.js";
import { pushSubscriptions, sentNotifications } from "../schema.js";

export type PushSender = (subscription: PushSubscriptionInput, payload: string) => Promise<void>;

export type NotifyResult = "sent" | "duplicate" | "no_subscribers" | "failed";

export type Notifier = {
  subscribe(s: PushSubscriptionInput): void;
  unsubscribe(endpoint: string): void;
  subscriptions(): PushSubscriptionInput[];
  notify(e: PushEvent): Promise<NotifyResult>;
};

// The push service answers 404/410 once a browser dropped the subscription: it will never work again.
const isGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
};

export const createNotifier = (db: Db, send: PushSender): Notifier => {
  const subscriptions = (): PushSubscriptionInput[] =>
    db
      .select()
      .from(pushSubscriptions)
      .all()
      .map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  const unsubscribe = (endpoint: string): void => {
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  };
  return {
    subscribe: ({ endpoint, keys }) => {
      db.insert(pushSubscriptions)
        .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } })
        .run();
    },
    unsubscribe,
    subscriptions,
    notify: async (event) => {
      const targets = subscriptions();
      // Not marked sent until someone can receive it, so subscribing later still gets today's alerts.
      if (targets.length === 0) return "no_subscribers";
      const already = db.select().from(sentNotifications).where(eq(sentNotifications.key, event.key)).get();
      if (already) return "duplicate";
      const payload = JSON.stringify(event);
      const delivered = await Promise.all(
        targets.map(async (target) => {
          try {
            await send(target, payload);
            return true;
          } catch (error) {
            if (isGone(error)) unsubscribe(target.endpoint);
            else console.error(`push to ${new URL(target.endpoint).host} failed: ${(error as Error).message}`);
            return false;
          }
        }),
      );
      // Recorded only once a device got it: a failed send (no network right after waking) is retried next tick.
      if (!delivered.some(Boolean)) return "failed";
      db.insert(sentNotifications).values({ key: event.key }).onConflictDoNothing().run();
      return "sent";
    },
  };
};
