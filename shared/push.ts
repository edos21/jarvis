export type PushEvent = { key: string; title: string; body: string; url: string };

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
