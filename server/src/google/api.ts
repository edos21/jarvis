import type { StoredAccount } from "./accounts.js";
import type { GoogleAuth } from "./oauth.js";

export class GoogleApiError extends Error {
  constructor(
    path: string,
    readonly status: number,
    // Google's own reason ("rateLimitExceeded", "insufficientPermissions"): a code, never message content.
    readonly reason: string | null = null,
    // When Gmail locks an account out for going too fast, it says until when.
    readonly retryAt: Date | null = null,
  ) {
    super(`Google API ${path} answered ${status}${reason ? ` (${reason})` : ""}${retryAt ? ` until ${retryAt.toISOString()}` : ""}`);
  }
}

const retryAtOf = (text: string): Date | null => {
  const at = /Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(text)?.[1];
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const reasonOf = (text: string): string | null => {
  try {
    const body = JSON.parse(text) as { error?: { errors?: { reason?: string }[]; status?: string } };
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? null;
    return reason && /^[A-Za-z_]{1,64}$/.test(reason) ? reason : null;
  } catch {
    return null;
  }
};

// Gmail allows a few hundred units a second per user; a burst past it answers 429, or 403 with one of these reasons.
const RATE_LIMITED = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RESOURCE_EXHAUSTED"]);
export const isRateLimited = (status: number, reason: string | null): boolean =>
  status === 429 || (status === 403 && reason !== null && RATE_LIMITED.has(reason));

export const RATE_LIMIT_WAITS_MS: readonly number[] = [1000, 2000, 4000, 8000];

const waitFor = (res: Response, fallback: number): number => {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : fallback;
};

// A request to a Google API as one account; a 401 means the cached access token died early, so retry once fresh.
export const googleRequest = async <T>(
  auth: GoogleAuth,
  account: Pick<StoredAccount, "email" | "refreshToken">,
  fetchFn: typeof fetch,
  url: string,
  init?: { method: "POST" | "PATCH"; body: unknown } | { method: "DELETE" },
): Promise<T> => {
  const call = async (): Promise<Response> =>
    fetchFn(url, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${await auth.accessToken(account)}`,
        ...(init && "body" in init ? { "content-type": "application/json" } : {}),
      },
      body: init && "body" in init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  let res = await call();
  if (res.status === 401) {
    auth.forget(account.email);
    res = await call();
  }
  for (const wait of [...RATE_LIMIT_WAITS_MS, null]) {
    if (res.ok) break;
    const text = await res.clone().text().catch(() => "");
    const reason = reasonOf(text);
    const retryAt = retryAtOf(text);
    const limited = isRateLimited(res.status, reason);
    // A lockout lasts minutes: waiting it out here would only hang the page.
    if (!limited || wait === null || retryAt) {
      const quota = limited ? (/quota metric '([^']{1,80})' and limit '([^']{1,80})'/.exec(text) ?? null) : null;
      const error = new GoogleApiError(new URL(url).pathname, res.status, reason, retryAt);
      if (quota) error.message += ` [${quota[1]} / ${quota[2]}]`;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, waitFor(res, wait)));
    res = await call();
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
};
