import { describe, expect, it } from "vitest";

import { GOOGLE_SCOPES, GoogleAuthExpired, MissingScopes, SETTINGS_SCOPE, createGoogleAuth } from "./oauth.js";

const config = { clientId: "client-id", clientSecret: "client-secret" };
const REDIRECT = "http://127.0.0.1:4417/api/google/callback";

const idToken = (email: string) =>
  ["x", Buffer.from(JSON.stringify({ email })).toString("base64url"), "sig"].join(".");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const setup = (handler: (url: string, body: URLSearchParams) => Response) => {
  let clock = 0;
  const calls: URLSearchParams[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push(body);
    return handler(url, body);
  }) as typeof fetch;
  const auth = createGoogleAuth({ config, redirectUri: REDIRECT, fetchFn, now: () => clock });
  return { auth, calls, tick: (ms: number) => (clock += ms) };
};

const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";

describe("google oauth", () => {
  it("authUrl carries PKCE challenge, offline access and the three scopes", () => {
    const { auth } = setup(() => json(200, {}));
    const url = new URL(auth.authUrl("personal"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
  });

  it("exchange sends the verifier and reads the email from id_token", async () => {
    const { auth, calls } = setup(() =>
      json(200, { access_token: "a", expires_in: 3600, refresh_token: "r", scope: GOOGLE_SCOPES.join(" "), id_token: idToken("me@gmail.com") }),
    );
    const state = stateOf(auth.authUrl("personal"));
    const result = await auth.exchange("code-1", state);
    expect(result).toEqual({ email: "me@gmail.com", kind: "personal", refreshToken: "r", scopes: GOOGLE_SCOPES.join(" ") });
    expect(calls[0]?.get("code_verifier")).toMatch(/^[\w-]{43,}$/);
    expect(calls[0]?.get("grant_type")).toBe("authorization_code");
  });

  it("state is single use and expires after 10 minutes", async () => {
    const { auth, tick } = setup(() =>
      json(200, { access_token: "a", expires_in: 3600, refresh_token: "r", scope: GOOGLE_SCOPES.join(" "), id_token: idToken("me@gmail.com") }),
    );
    const state = stateOf(auth.authUrl("personal"));
    await auth.exchange("code", state);
    await expect(auth.exchange("code", state)).rejects.toThrow(/state/);
    const late = stateOf(auth.authUrl("personal"));
    tick(10 * 60_000 + 1);
    await expect(auth.exchange("code", late)).rejects.toThrow(/state/);
  });

  it("a consent without refresh token is rejected", async () => {
    const { auth } = setup(() => json(200, { access_token: "a", expires_in: 3600, id_token: idToken("me@gmail.com") }));
    await expect(auth.exchange("code", stateOf(auth.authUrl("personal")))).rejects.toThrow(/refresh/);
  });

  it("caches the access token until a minute before it expires", async () => {
    let issued = 0;
    const { auth, tick } = setup(() => json(200, { access_token: `a${++issued}`, expires_in: 3600 }));
    const account = { email: "me@gmail.com", refreshToken: "r" };
    expect(await auth.accessToken(account)).toBe("a1");
    tick(3600_000 - 61_000);
    expect(await auth.accessToken(account)).toBe("a1");
    tick(2_000);
    expect(await auth.accessToken(account)).toBe("a2");
  });

  it("invalid_grant on refresh throws GoogleAuthExpired", async () => {
    const { auth } = setup(() => json(400, { error: "invalid_grant" }));
    await expect(auth.accessToken({ email: "me@gmail.com", refreshToken: "r" })).rejects.toBeInstanceOf(GoogleAuthExpired);
  });
});

describe("granted permissions", () => {
  it("a consent with Gmail unticked is rejected", async () => {
    const { auth } = setup(() =>
      json(200, {
        access_token: "a",
        expires_in: 3600,
        refresh_token: "r",
        scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
        id_token: idToken("me@gmail.com"),
      }),
    );
    await expect(auth.exchange("code", stateOf(auth.authUrl("personal")))).rejects.toBeInstanceOf(MissingScopes);
  });

  it("a consent without the filters permission still connects", async () => {
    const scope = GOOGLE_SCOPES.filter((s) => s !== SETTINGS_SCOPE).join(" ");
    const { auth } = setup(() =>
      json(200, { access_token: "a", expires_in: 3600, refresh_token: "r", scope, id_token: idToken("me@gmail.com") }),
    );
    expect((await auth.exchange("code", stateOf(auth.authUrl("personal")))).scopes).toBe(scope);
  });
});
