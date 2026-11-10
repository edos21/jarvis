import { homedir } from "node:os";
import { join } from "node:path";

export const PORT = Number(process.env.JARVIS_PORT ?? 4417);

export const DATA_DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), ".jarvis");

// My notes folder (Obsidian vault): Jarvis reads investment notes from it and keeps cartera.md's IBKR section current.
export const NOTES_DIR = process.env.JARVIS_NOTES_DIR ?? join(homedir(), "dev", "edos", "notes");

// My statements project: import_split.py with its own venv, statements in files/ and its CSVs in files/out.
export const STATEMENTS_DIR = process.env.JARVIS_CUENTAS_DIR ?? join(homedir(), "dev", "edos", "cuentas");

// The name `tailscale serve` publishes this Mac under (e.g. mac.tail1234.ts.net): the only non-local Host
// Jarvis answers, and the one that marks a request as coming from my phone.
export const TAILNET_HOST = process.env.JARVIS_TAILNET_HOST || null;

// My Tailscale login (e.g. me@example.com): when set, only my own devices on the tailnet get in.
export const TAILSCALE_LOGIN = process.env.JARVIS_TAILSCALE_LOGIN || null;

// Pepper is read from the server side only, so it never has to be reachable from outside this Mac.
export const PEPPER_URL = process.env.JARVIS_PEPPER_URL ?? "http://127.0.0.1:4317";
export const PEPPER_WEB_URL = process.env.JARVIS_PEPPER_WEB_URL ?? "http://127.0.0.1:4318";

// The factories that are mine (comma separated). My Pepper board also shows tickets a teammate's factory has, and
// when those wait on a human, the human is that teammate.
const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export const MY_FACTORIES = list(process.env.JARVIS_MY_FACTORIES);

// The GitHub owners whose open PRs of mine count as work (comma separated). Empty means every owner.
export const GITHUB_OWNERS = list(process.env.JARVIS_GITHUB_OWNERS);

// In headless mode an API key always wins over the Max subscription login,
// so a stray key would silently bill every agent run to the API.
export const assertSubscriptionAuth = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is set. Jarvis runs on the Max subscription (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`); unset the key and restart.",
    );
  }
};

// Checked on every agent run, not at startup, so the panel still works without it.
export const assertAgentAuth = (env: NodeJS.ProcessEnv = process.env): void => {
  assertSubscriptionAuth(env);
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token`, export the token and restart Jarvis.");
  }
};

// A "Desktop app" OAuth client of my own Google Cloud project; without it, mail and agenda say how to set it up.
export type GoogleConfig = { clientId: string; clientSecret: string };

export const readGoogleConfig = (env: NodeJS.ProcessEnv = process.env): GoogleConfig | null => {
  const { JARVIS_GOOGLE_CLIENT_ID: clientId, JARVIS_GOOGLE_CLIENT_SECRET: clientSecret } = env;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

// An ElevenLabs key with Text to Speech access: Jarvis speaks the briefing with it. Without it the page stays silent.
export const readElevenLabsKey = (env: NodeJS.ProcessEnv = process.env): string | null =>
  env.JARVIS_ELEVENLABS_API_KEY?.trim() || null;

// A read-only Flex Web Service token and the id of the "open positions + cash" Flex Query, both from the IBKR portal.
// The NAV query (a year of daily account values) is a second, optional one: without it the history starts today.
export type IbkrConfig = { token: string; queryId: string; navQueryId?: string };

export const readIbkrConfig = (env: NodeJS.ProcessEnv = process.env): IbkrConfig | null => {
  const token = env.JARVIS_IBKR_FLEX_TOKEN?.trim();
  const queryId = env.JARVIS_IBKR_FLEX_QUERY_ID?.trim();
  const navQueryId = env.JARVIS_IBKR_FLEX_NAV_QUERY_ID?.trim();
  if (!token || !queryId) return null;
  return navQueryId ? { token, queryId, navQueryId } : { token, queryId };
};
