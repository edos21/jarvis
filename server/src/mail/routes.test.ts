import { describe, expect, it } from "vitest";

import type { MailResponse } from "../../../shared/mail.js";
import { createApp } from "../app.js";
import { createAccountStore } from "../google/accounts.js";
import { openDb } from "../db.js";
import { fakeAuth } from "../google/testing.js";
import { mailRoutes } from "./routes.js";
import { createMailSweep } from "./sweep.js";
import { setupMail } from "./testing.js";

const LOCAL = "http://127.0.0.1:4417";

describe("mail routes", () => {
  const setup = () => {
    const mail = setupMail();
    // No personal account: the sweep answers before it would ever reach Gmail.
    const sweep = createMailSweep({
      auth: fakeAuth(),
      accounts: createAccountStore(openDb(":memory:")),
      fetchFn: fetch,
      onChange: () => undefined,
    });
    const app = createApp({ tailnetHost: null, routes: [mailRoutes(mail.source, sweep)] });
    const post = (path: string, body: unknown) =>
      app.request(`${LOCAL}/api${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    return { ...mail, app, post };
  };

  it("archives a group from its snapshot", async () => {
    const { app, post, gmail } = setup();
    const { mailboxes } = (await (await app.request(`${LOCAL}/api/mail`)).json()) as MailResponse;
    const res = await post(`/mail/me@gmail.com/groups/newsletter/archive`, { snapshotId: mailboxes[0]?.snapshotId });
    expect(res.status).toBe(200);
    expect(gmail.modified[0]?.ids).toEqual(["n1", "n2"]);
  });

  it("trashes a group from its snapshot", async () => {
    const { app, post, gmail } = setup();
    const { mailboxes } = (await (await app.request(`${LOCAL}/api/mail`)).json()) as MailResponse;
    const res = await post(`/mail/me@gmail.com/groups/notification/trash`, { snapshotId: mailboxes[0]?.snapshotId });
    expect(res.status).toBe(200);
    expect(gmail.trashed).toEqual(["g1"]);
  });

  it("acts on a selection; an empty or unknown action is refused", async () => {
    const { app, post, gmail } = setup();
    await app.request(`${LOCAL}/api/mail`);
    expect((await post(`/mail/me@gmail.com/messages/trash`, { ids: ["n1", "p1"] })).status).toBe(200);
    expect(gmail.trashed).toEqual(["n1", "p1"]);
    expect((await post(`/mail/me@gmail.com/messages/trash`, { ids: [] })).status).toBe(400);
    expect((await post(`/mail/me@gmail.com/messages/delete`, { ids: ["n2"] })).status).toBe(404);
  });

  it("people and invoices cannot be trashed as a whole group", async () => {
    const { app, post, gmail } = setup();
    const { mailboxes } = (await (await app.request(`${LOCAL}/api/mail`)).json()) as MailResponse;
    const res = await post(`/mail/me@gmail.com/groups/person/trash`, { snapshotId: mailboxes[0]?.snapshotId });
    expect(res.status).toBe(400);
    expect(gmail.trashed).toEqual([]);
  });

  it("a selection over 100 is refused", async () => {
    const { post } = setup();
    const ids = Array.from({ length: 101 }, (_, i) => `m${i}`);
    expect((await post(`/mail/me@gmail.com/messages/trash`, { ids })).status).toBe(400);
  });

  it("lost Google access during an action asks to reconnect instead of a generic error", async () => {
    const { app, post, expire } = setup();
    await app.request(`${LOCAL}/api/mail`);
    expire();
    const res = await post(`/mail/me@gmail.com/messages/trash`, { ids: ["n1"] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Reconecta");
  });

  it("not-a-person for a message never shown is a 409", async () => {
    const { post } = setup();
    expect((await post(`/mail/me@gmail.com/messages/never/not-a-person`, {})).status).toBe(409);
  });

  it("an old snapshot is a 409 with a readable message", async () => {
    const { post } = setup();
    const res = await post(`/mail/me@gmail.com/groups/newsletter/archive`, { snapshotId: "stale" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Recarga");
  });

  it("unknown account → 404, unknown kind or action → 404", async () => {
    const { post } = setup();
    expect((await post(`/mail/other@gmail.com/groups/newsletter/archive`, { snapshotId: "x" })).status).toBe(404);
    expect((await post(`/mail/me@gmail.com/groups/spam/archive`, { snapshotId: "x" })).status).toBe(404);
    expect((await post(`/mail/me@gmail.com/groups/newsletter/delete`, { snapshotId: "x" })).status).toBe(404);
  });

  it("the sweep: nothing analyzed yet, no confirm, no account", async () => {
    const { app, post } = setup();
    expect(await (await app.request(`${LOCAL}/api/mail/sweep`)).json()).toBeNull();
    expect((await post("/mail/sweep/apply", { id: "age:promotions", action: "trash" })).status).toBe(400);
    expect((await post("/mail/sweep/apply", { id: "x", action: "filter", filterAction: "delete", confirm: true })).status).toBe(400);
    const res = await post("/mail/sweep/apply", { id: "age:promotions", action: "trash", confirm: true });
    expect(res.status).toBe(409);
    expect((await post("/mail/sweep/analyze", {})).status).toBe(409);
  });
});
