import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

const TAILNET = "mac.tail1234.ts.net";

const build = () => createApp({ tailnetHost: TAILNET });

describe("host and origin guard", () => {
  it("rejects a foreign Host with 403", async () => {
    const res = await build().request("http://evil.com/api/health");
    expect(res.status).toBe(403);
  });

  it("accepts a local host", async () => {
    const res = await build().request("http://127.0.0.1:4417/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts the tailnet host", async () => {
    const res = await build().request(`https://${TAILNET}/api/health`);
    expect(res.status).toBe(200);
  });

  it("rejects a write with a foreign Origin", async () => {
    const res = await build().request("http://127.0.0.1:4417/api/health", {
      method: "POST",
      headers: { origin: "http://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("isRemote is true only for the tailnet host", async () => {
    const app = build();
    const local = await app.request("http://127.0.0.1:4417/api/whoami");
    const remote = await app.request(`https://${TAILNET}/api/whoami`);
    expect(await local.json()).toEqual({ remote: false });
    expect(await remote.json()).toEqual({ remote: true });
  });

  it("without a tailnet host configured, only local hosts pass", async () => {
    const res = await createApp({ tailnetHost: null }).request(`https://${TAILNET}/api/health`);
    expect(res.status).toBe(403);
  });
});

describe("remote detection", () => {
  it("a proxied request is remote even with a local Host", async () => {
    const res = await build().request("http://127.0.0.1:4417/api/whoami", { headers: { "x-forwarded-for": "100.64.0.2" } });
    expect(await res.json()).toEqual({ remote: true });
  });

  it("with a login configured, only that Tailscale user gets in", async () => {
    const app = createApp({ tailnetHost: TAILNET, tailscaleLogin: "me@example.com" });
    const as = (login?: string) =>
      app.request(`https://${TAILNET}/api/health`, { headers: login ? { "tailscale-user-login": login } : {} });
    expect((await as("me@example.com")).status).toBe(200);
    expect((await as("other@example.com")).status).toBe(403);
    expect((await as()).status).toBe(403);
    // Local requests carry no Tailscale headers and stay allowed.
    expect((await app.request("http://127.0.0.1:4417/api/health")).status).toBe(200);
  });

  it("unknown api paths answer a JSON 404", async () => {
    const res = await build().request("http://127.0.0.1:4417/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No existe." });
  });
});
