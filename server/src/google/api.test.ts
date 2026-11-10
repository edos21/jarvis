import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleApiError, RATE_LIMIT_WAITS_MS, googleRequest } from "./api.js";
import { fakeAuth } from "./testing.js";

const ACCOUNT = { email: "me@gmail.com", refreshToken: "r" };
const URL_ = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

const limited = (status: number, reason: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status, headers });

const answering = (responses: Response[]) => {
  let calls = 0;
  const fetchFn = (async () => responses[Math.min(calls++, responses.length - 1)] ?? Response.json({})) as typeof fetch;
  return { fetchFn, calls: () => calls };
};

// Runs the request while the fake clock skips every wait.
const settle = async <T>(promise: Promise<T>): Promise<T> => {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
};

describe("rate limits", () => {
  afterEach(() => vi.useRealTimers());

  it("a 403 for the rate limit is retried until Gmail answers", async () => {
    vi.useFakeTimers();
    const { fetchFn, calls } = answering([limited(403, "rateLimitExceeded"), limited(429, "x"), Response.json({ ok: 1 })]);
    expect(await settle(googleRequest(fakeAuth(), ACCOUNT, fetchFn, URL_))).toEqual({ ok: 1 });
    expect(calls()).toBe(3);
  });

  it("gives up after the last wait, with Google's reason in the error", async () => {
    vi.useFakeTimers();
    const { fetchFn, calls } = answering([limited(403, "userRateLimitExceeded")]);
    const error = await settle(googleRequest(fakeAuth(), ACCOUNT, fetchFn, URL_)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).reason).toBe("userRateLimitExceeded");
    expect(calls()).toBe(RATE_LIMIT_WAITS_MS.length + 1);
  });

  it("a 403 for anything else fails at once", async () => {
    const { fetchFn, calls } = answering([limited(403, "insufficientPermissions")]);
    await expect(googleRequest(fakeAuth(), ACCOUNT, fetchFn, URL_)).rejects.toThrow(/insufficientPermissions/);
    expect(calls()).toBe(1);
  });
});
