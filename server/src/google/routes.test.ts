import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { createAccountStore } from "./accounts.js";
import type { GoogleAuth } from "./oauth.js";
import { googleRoutes } from "./routes.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";

const fakeAuth = (): GoogleAuth & { revoked: string[] } => {
  const revoked: string[] = [];
  return {
    revoked,
    authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?state=s",
    exchange: async (code) => {
      if (code !== "good") throw new Error("bad state");
      return { email: "me@gmail.com", kind: "personal", refreshToken: "secret-refresh", scopes: "s" };
    },
    accessToken: async () => "a",
    revoke: async (token) => {
      revoked.push(token);
    },
    forget: () => undefined,
  };
};

const setup = (auth: GoogleAuth | null = fakeAuth()) => {
  const accounts = createAccountStore(openDb(":memory:"));
  const app = createApp({ tailnetHost: TAILNET, routes: [googleRoutes({ auth, accounts })] });
  return { app, accounts };
};

describe("google routes", () => {
  it("callback stores the account and /status never returns the refresh token", async () => {
    const { app } = setup();
    const res = await app.request(`${LOCAL}/api/google/callback?code=good&state=s`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/#correo");
    const status = await (await app.request(`${LOCAL}/api/google/status`)).text();
    expect(status).toContain("me@gmail.com");
    expect(status).not.toContain("secret-refresh");
  });

  it("a bad callback answers a readable page, not a 500", async () => {
    const { app } = setup();
    const res = await app.request(`${LOCAL}/api/google/callback?code=bad&state=s`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Vuelve a conectar");
  });

  it("connect and disconnect are 403 from the tailnet", async () => {
    const { app } = setup();
    expect((await app.request(`https://${TAILNET}/api/google/connect`)).status).toBe(403);
    expect((await app.request(`https://${TAILNET}/api/google/accounts/me@gmail.com`, { method: "DELETE" })).status).toBe(403);
  });

  it("connect without client id is 409 with setup instructions", async () => {
    const { app } = setup(null);
    const res = await app.request(`${LOCAL}/api/google/connect`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("JARVIS_GOOGLE_CLIENT_ID");
  });

  it("disconnect revokes the token at Google and forgets the account", async () => {
    const auth = fakeAuth();
    const { app, accounts } = setup(auth);
    await app.request(`${LOCAL}/api/google/callback?code=good&state=s`);
    const res = await app.request(`${LOCAL}/api/google/accounts/me@gmail.com`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(auth.revoked).toEqual(["secret-refresh"]);
    expect(accounts.list()).toEqual([]);
  });
});
