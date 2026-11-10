import { describe, expect, it } from "vitest";

import { ApiError, request } from "./api";

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("request", () => {
  it("returns the body on ok", async () => {
    expect(await request("/health", undefined, respond(200, { ok: true }))).toEqual({ ok: true });
  });

  it("throws body.error on non-ok", async () => {
    const error = await request("/payments", undefined, respond(400, { error: "Falta el nombre." })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Falta el nombre.", status: 400 });
  });
});
