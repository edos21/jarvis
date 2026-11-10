import { describe, expect, it } from "vitest";

import { createFilter, listFilteredSenders, listIds, trashByIds } from "./gmail.js";
import { fakeAuth } from "./testing.js";

const ACCOUNT = { email: "me@gmail.com", refreshToken: "r" };

const recorder = (answer: (url: URL, body: unknown) => unknown) => {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    return Response.json(answer(url, body) ?? {});
  }) as typeof fetch;
  return { calls, fetchFn };
};

describe("listIds", () => {
  it("follows the pages until the search runs out", async () => {
    const { calls, fetchFn } = recorder((url) =>
      url.searchParams.get("pageToken") === "p2"
        ? { messages: [{ id: "c" }] }
        : { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" },
    );
    expect(await listIds(ACCOUNT, fakeAuth(), fetchFn, "category:promotions")).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.url.searchParams.get("q"))).toEqual(["category:promotions", "category:promotions"]);
  });

  it("asks for no more than the limit", async () => {
    const { calls, fetchFn } = recorder(() => ({ messages: [{ id: "a" }], nextPageToken: "more" }));
    await listIds(ACCOUNT, fakeAuth(), fetchFn, "q", 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("maxResults")).toBe("1");
  });
});

describe("writes", () => {
  it("trashes in batches of 1000", async () => {
    const { calls, fetchFn } = recorder(() => ({}));
    await trashByIds(ACCOUNT, fakeAuth(), fetchFn, Array.from({ length: 2500 }, (_, i) => `m${i}`));
    expect(calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([1000, 1000, 500]);
    expect(calls[0]?.body).toMatchObject({ addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] });
  });

  it("nothing to trash is no call", async () => {
    const { calls, fetchFn } = recorder(() => ({}));
    await trashByIds(ACCOUNT, fakeAuth(), fetchFn, []);
    expect(calls).toEqual([]);
  });

  it("a filter matches the sender's address and trashes or skips the inbox", async () => {
    const { calls, fetchFn } = recorder(() => ({}));
    await createFilter(ACCOUNT, fakeAuth(), fetchFn, "deals@shop.com", "trash");
    await createFilter(ACCOUNT, fakeAuth(), fetchFn, "deals@shop.com", "skip_inbox");
    expect(calls.map((c) => [c.method, c.url.pathname.endsWith("/settings/filters"), c.body])).toEqual([
      ["POST", true, { criteria: { from: "deals@shop.com" }, action: { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] } }],
      ["POST", true, { criteria: { from: "deals@shop.com" }, action: { removeLabelIds: ["INBOX"] } }],
    ]);
  });

  it("the senders already filtered come back lowercased", async () => {
    const { fetchFn } = recorder(() => ({
      filter: [
        { criteria: { from: " Deals@Shop.com " } },
        { criteria: { from: "a@x.com OR {b@y.com c@z.com}" } },
        { criteria: { query: "x" } },
      ],
    }));
    expect(await listFilteredSenders(ACCOUNT, fakeAuth(), fetchFn)).toEqual(
      new Set(["deals@shop.com", "a@x.com", "b@y.com", "c@z.com"]),
    );
  });
});
