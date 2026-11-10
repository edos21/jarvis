import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SnapshotExpired } from "./source.js";
import { setupMail } from "./testing.js";

const ME = "me@gmail.com";

describe("mail source", () => {
  it("groups the unread inbox by kind, people first", async () => {
    const { source } = setupMail();
    const [box] = (await source.read()).mailboxes;
    expect(box?.groups.map((g) => [g.kind, g.items.map((i) => i.id)])).toEqual([
      ["person", ["p1"]],
      ["notification", ["g1"]],
      ["newsletter", ["n1", "n2"]],
    ]);
    expect(box?.groups[0]?.items[0]).toMatchObject({
      fromName: "Ana Pérez",
      from: "ana@gmail.com",
      url: "https://mail.google.com/mail/?authuser=me%40gmail.com#inbox/t-p1",
    });
  });

  it("only metadata is requested, never the body", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    const gets = gmail.urls.filter((u) => /\/messages\/[^/?]+\?/.test(u));
    expect(gets.length).toBe(4);
    for (const u of gets) expect(new URL(u).searchParams.get("format")).toBe("metadata");
  });

  it("expired token → reconnect true and empty groups", async () => {
    const { source } = setupMail({ expired: true });
    expect((await source.read()).mailboxes).toEqual([{ account: ME, groups: [], snapshotId: "", reconnect: true }]);
  });

  it("archive touches only ids from the snapshot, not mail that arrived after", async () => {
    const { source, gmail } = setupMail();
    const [box] = (await source.read()).mailboxes;
    gmail.add({ id: "n3", from: "Late <x@news.com>", subject: "Breaking", headers: { "List-Id": "<x>" } });
    const after = await source.actOnGroup(ME, "newsletter", box!.snapshotId, "archive");
    expect(gmail.modified).toEqual([{ ids: ["n1", "n2"], removeLabelIds: ["INBOX"] }]);
    expect(after.groups.find((g) => g.kind === "newsletter")?.items.map((i) => i.id)).toEqual(["n3"]);
  });

  it("mark read removes UNREAD only", async () => {
    const { source, gmail } = setupMail();
    const [box] = (await source.read()).mailboxes;
    await source.actOnGroup(ME, "notification", box!.snapshotId, "read");
    expect(gmail.labelsOf("g1")).toEqual(["INBOX"]);
  });

  it("expired snapshot is refused", async () => {
    const { source, tick } = setupMail();
    const [box] = (await source.read()).mailboxes;
    tick(30 * 60_000 + 1);
    await expect(source.actOnGroup(ME, "newsletter", box!.snapshotId, "archive")).rejects.toBeInstanceOf(SnapshotExpired);
  });

});

describe("trash", () => {
  it("moves only the snapshot's ids of the group to the trash", async () => {
    const { source, gmail } = setupMail();
    const [box] = (await source.read()).mailboxes;
    gmail.add({ id: "n3", from: "Late <x@news.com>", subject: "Breaking", headers: { "List-Id": "<x>" } });
    const after = await source.actOnGroup(ME, "newsletter", box!.snapshotId, "trash");
    expect(gmail.trashed).toEqual(["n1", "n2"]);
    expect(gmail.labelsOf("n1")).toEqual(["UNREAD", "TRASH"]);
    expect(after.groups.find((g) => g.kind === "newsletter")?.items.map((i) => i.id)).toEqual(["n3"]);
  });
});

describe("acting on selected messages", () => {
  it("a message already gone is fine, but any other Gmail failure is reported", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    gmail.vanishOnRead("n1");
    await source.actOnMessages(ME, ["n1", "n2"], "trash");
    expect(gmail.trashed).toEqual(["n2"]);
    gmail.failWrite("g1", 500);
    await expect(source.actOnMessages(ME, ["g1", "p1"], "trash")).rejects.toThrow();
  });

  it("trashes, archives or reads exactly the selected ids", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    await source.actOnMessages(ME, ["n1", "g1"], "trash");
    expect(gmail.trashed).toEqual(["n1", "g1"]);
    await source.actOnMessages(ME, ["p1"], "read");
    expect(gmail.labelsOf("p1")).toEqual(["INBOX"]);
    await source.actOnMessages(ME, ["n2"], "archive");
    expect(gmail.labelsOf("n2")).toEqual(["UNREAD"]);
  });

  it("refuses the whole selection if any id was never shown", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    await expect(source.actOnMessages(ME, ["n1", "never-shown"], "trash")).rejects.toBeInstanceOf(SnapshotExpired);
    expect(gmail.trashed).toEqual([]);
  });
});

describe("marking a sender as not a person", () => {
  const shop = { id: "s1", from: "Wagner Food <promo@wagnerfood.com>", subject: "¡Disfruta más!" };
  const friend = { id: "p2", from: "Beto <beto@gmail.com>", subject: "Cadena" };
  const setup = () => {
    const file = join(mkdtempSync(join(tmpdir(), "jarvis-")), "automated-senders");
    return { file, ...setupMail({ inbox: [shop, friend, { id: "p3", from: "Ana <ana@gmail.com>", subject: "Hola" }], automatedSendersFile: file }) };
  };

  it("a company sender adds its whole domain and leaves the person group", async () => {
    const { source, file } = setup();
    await source.read();
    const box = await source.markNotPerson(ME, "s1");
    expect(readFileSync(file, "utf8")).toBe("wagnerfood.com\n");
    expect(box.groups.find((g) => g.kind === "notification")?.items.map((i) => i.id)).toEqual(["s1"]);
  });

  it("a free mail address adds only that address, so other people on gmail.com stay people", async () => {
    const { source, file } = setup();
    await source.read();
    const box = await source.markNotPerson(ME, "p2");
    expect(readFileSync(file, "utf8")).toBe("beto@gmail.com\n");
    expect(box.groups.find((g) => g.kind === "person")?.items.map((i) => i.id)).toEqual(["s1", "p3"]);
  });

  it("marking the same sender twice writes it once", async () => {
    const { source, file } = setup();
    await source.read();
    await source.markNotPerson(ME, "s1");
    await source.markNotPerson(ME, "s1");
    expect(readFileSync(file, "utf8")).toBe("wagnerfood.com\n");
  });

  it("needs the message to have been shown", async () => {
    const { source } = setup();
    await source.read();
    await expect(source.markNotPerson(ME, "never-shown")).rejects.toBeInstanceOf(SnapshotExpired);
  });
});

describe("reading the inbox again", () => {
  it("a server error on one message fails the read instead of hiding the message", async () => {
    const { source, gmail } = setupMail();
    gmail.failRead("p1", 503);
    await expect(source.read()).rejects.toThrow();
  });

  it("metadata is fetched once per message; later reads only list the inbox", async () => {
    const { source, gmail, tick } = setupMail();
    await source.read();
    tick(3 * 60_000);
    gmail.urls.length = 0;
    gmail.add({ id: "p9", from: "Leo <leo@gmail.com>", subject: "Hola" });
    const [box] = (await source.read()).mailboxes;
    expect(gmail.urls.filter((u) => /\/messages\/[^/?]+\?/.test(u)).map((u) => new URL(u).pathname.split("/").at(-1))).toEqual(["p9"]);
    expect(box?.groups[0]?.items.map((i) => i.id)).toEqual(["p1", "p9"]);
  });

  it("a failed action still drops the cache, so a retry sees what already changed", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    gmail.failWrite("n2", 500);
    await expect(source.actOnMessages(ME, ["n1", "n2"], "trash")).rejects.toThrow();
    const [box] = (await source.read()).mailboxes;
    expect(box?.groups.find((g) => g.kind === "newsletter")?.items.map((i) => i.id)).toEqual(["n2"]);
  });

  it("a read that started before an action does not put the old inbox back in the cache", async () => {
    const { source, gmail } = setupMail();
    await source.read();
    source.invalidate();
    gmail.hold();
    const slow = source.read();
    await source.actOnMessages(ME, ["p1"], "archive");
    gmail.release();
    await slow;
    const [box] = (await source.read()).mailboxes;
    expect(box?.groups.find((g) => g.kind === "person")).toBeUndefined();
  });
});

describe("the automated-senders file", () => {
  it("an entry added after a hand-edited last line without newline stays on its own line", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "jarvis-")), "automated-senders");
    writeFileSync(file, "mybank.com");
    const { source } = setupMail({ inbox: [{ id: "s1", from: "Shop <x@shop.com>", subject: "Promo" }], automatedSendersFile: file });
    await source.read();
    await source.markNotPerson(ME, "s1");
    expect(readFileSync(file, "utf8")).toBe("mybank.com\nshop.com\n");
  });
});

describe("a message that vanishes mid-read", () => {
  it("is skipped and the rest of the mailbox still loads", async () => {
    const { source, gmail } = setupMail();
    gmail.vanishOnRead("n1");
    const [box] = (await source.read()).mailboxes;
    expect(box?.groups.flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(["g1", "n2", "p1"]);
  });
});
