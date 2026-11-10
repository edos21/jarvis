import { GoogleAuthExpired, type GoogleAuth } from "./oauth.js";

// A GoogleAuth stand-in for tests: every account gets a token, or every one has lost access (now or later on).
export const fakeAuth = (expired: boolean | (() => boolean) = false): GoogleAuth => ({
  authUrl: () => "",
  exchange: async () => {
    throw new Error("unused");
  },
  accessToken: async ({ email }) => {
    if (typeof expired === "function" ? expired() : expired) throw new GoogleAuthExpired(email);
    return "token";
  },
  revoke: async () => undefined,
  forget: () => undefined,
});
