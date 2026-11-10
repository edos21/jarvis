import { createHash, randomBytes } from "node:crypto";

import type { AccountKind } from "../../../shared/google.js";
import type { GoogleConfig } from "../env.js";

// Read and complete: marking a task done is the one write, and Google Tasks undoes it in one click.
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

// Creates filters for mail cleanup. Optional: an account connected without it works, and is asked to reconnect only
// when a filter is wanted.
export const SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Archive, mark read and move to the trash; Jarvis never sends mail or deletes it for good.
  "https://www.googleapis.com/auth/gmail.modify",
  TASKS_SCOPE,
  SETTINGS_SCOPE,
] as const;

const REQUIRED_SCOPES = GOOGLE_SCOPES.filter((scope) => scope.startsWith("https://") && scope !== SETTINGS_SCOPE);

export class MissingScopes extends Error {
  constructor() {
    super("Some permissions were not granted.");
  }
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const STATE_TTL_MS = 10 * 60_000;
// Refresh a little early so a token never expires halfway through a request.
const EXPIRY_MARGIN_MS = 60_000;

// The refresh token stopped working (access revoked, password changed): the account needs connecting again.
export class GoogleAuthExpired extends Error {
  constructor(readonly email: string) {
    super(`Google access for ${email} expired; connect the account again.`);
  }
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
};

export type Exchanged = { email: string; kind: AccountKind; refreshToken: string; scopes: string };

export type GoogleAuth = {
  authUrl(kind: AccountKind): string;
  exchange(code: string, state: string): Promise<Exchanged>;
  accessToken(account: { email: string; refreshToken: string }): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
  forget(email: string): void;
};

const base64Url = (bytes: Buffer): string => bytes.toString("base64url");

// The id_token comes straight from Google's token endpoint over TLS, so its payload is read without checking the
// signature: nobody else could have put it there.
const emailFromIdToken = (idToken: string | undefined): string => {
  const payload = idToken?.split(".")[1];
  const email = payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown }).email : null;
  if (typeof email !== "string") throw new Error("Google did not return the account's email.");
  return email;
};

export const createGoogleAuth = (deps: {
  config: GoogleConfig;
  redirectUri: string;
  fetchFn: typeof fetch;
  now?: () => number;
}): GoogleAuth => {
  const now = deps.now ?? Date.now;
  const pending = new Map<string, { verifier: string; kind: AccountKind; at: number }>();
  const tokens = new Map<string, { token: string; expiresAt: number }>();

  const post = async (url: string, params: Record<string, string>): Promise<{ status: number; body: TokenResponse }> => {
    const res = await deps.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      // A hung Google would otherwise hang mail, agenda, disconnect and the push tick with it.
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenResponse };
  };

  return {
    authUrl: (kind) => {
      for (const [key, value] of pending) if (now() - value.at > STATE_TTL_MS) pending.delete(key);
      const state = base64Url(randomBytes(24));
      const verifier = base64Url(randomBytes(48));
      pending.set(state, { verifier, kind, at: now() });
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: deps.config.clientId,
        redirect_uri: deps.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        // Without both, Google gives no refresh token when an account is connected again.
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
      }).toString();
      return url.toString();
    },

    exchange: async (code, state) => {
      const started = pending.get(state);
      pending.delete(state);
      if (!started || now() - started.at > STATE_TTL_MS) throw new Error("The sign-in state expired or is unknown.");
      const { status, body } = await post(TOKEN_URL, {
        code,
        client_id: deps.config.clientId,
        client_secret: deps.config.clientSecret,
        redirect_uri: deps.redirectUri,
        grant_type: "authorization_code",
        code_verifier: started.verifier,
      });
      if (status !== 200) throw new Error(`Google rejected the sign-in: ${body.error ?? status}.`);
      if (!body.refresh_token) throw new Error("Google returned no refresh token; connect the account again.");
      // The consent screen lets each permission be unticked; without these Jarvis can only fail later.
      const granted = new Set((body.scope ?? "").split(" "));
      if (!REQUIRED_SCOPES.every((scope) => granted.has(scope))) throw new MissingScopes();
      const email = emailFromIdToken(body.id_token);
      if (body.access_token && body.expires_in) {
        tokens.set(email, { token: body.access_token, expiresAt: now() + body.expires_in * 1000 });
      }
      return { email, kind: started.kind, refreshToken: body.refresh_token, scopes: body.scope ?? "" };
    },

    accessToken: async ({ email, refreshToken }) => {
      const cached = tokens.get(email);
      if (cached && now() < cached.expiresAt - EXPIRY_MARGIN_MS) return cached.token;
      const { status, body } = await post(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: deps.config.clientId,
        client_secret: deps.config.clientSecret,
        grant_type: "refresh_token",
      });
      if (body.error === "invalid_grant") {
        tokens.delete(email);
        throw new GoogleAuthExpired(email);
      }
      if (status !== 200 || !body.access_token || !body.expires_in) {
        throw new Error(`Google token refresh failed: ${body.error ?? status}.`);
      }
      tokens.set(email, { token: body.access_token, expiresAt: now() + body.expires_in * 1000 });
      return body.access_token;
    },

    revoke: async (refreshToken) => {
      await post(REVOKE_URL, { token: refreshToken }).catch(() => undefined);
    },

    forget: (email) => {
      tokens.delete(email);
    },
  };
};
