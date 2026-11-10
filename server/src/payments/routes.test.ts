import { describe, expect, it } from "vitest";

import type { PaymentsResponse } from "../../../shared/payments.js";
import { createApp } from "../app.js";
import { openDb } from "../db.js";
import { paymentRoutes } from "./routes.js";
import { createPaymentStore } from "./store.js";

const TAILNET = "mac.tail1234.ts.net";
const LOCAL = "http://127.0.0.1:4417";

const setup = () => {
  const now = () => new Date(2026, 9, 30, 12);
  const store = createPaymentStore(openDb(":memory:"), () => new Date(2026, 9, 1, 12));
  const app = createApp({ tailnetHost: TAILNET, routes: [paymentRoutes(store, now)] });
  const call = async (method: string, path: string, body?: unknown, host = LOCAL) => {
    const res = await app.request(`${host}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as PaymentsResponse & { error?: string } };
  };
  return { call };
};

const rent = {
  name: "Alquiler",
  amount: 950,
  currency: "USD",
  dueDay: 30,
  link: "https://bank.example",
  accountLabel: "Banco Uno",
  accountNumber: "1234 5678 4821",
};

describe("payment routes", () => {
  it("creates a payment and shows it due today", async () => {
    const { call } = setup();
    const { json } = await call("POST", "/payments", rent);
    expect(json.due).toEqual([expect.objectContaining({ name: "Alquiler", status: "due_today", period: "2026-10" })]);
  });

  it("mark paid then undo", async () => {
    const { call } = setup();
    const created = await call("POST", "/payments", rent);
    const id = created.json.payments[0]?.id;
    const marked = (await call("POST", `/payments/${id}/paid`, { period: "2026-10" })).json;
    expect(marked.due).toEqual([]);
    expect(marked.paidThisPeriod).toEqual([id]);
    expect((await call("DELETE", `/payments/${id}/paid/2026-10`)).json.due).toHaveLength(1);
  });

  it("payments masked for remote", async () => {
    const { call } = setup();
    await call("POST", "/payments", rent);
    const { json } = await call("GET", "/payments", undefined, `https://${TAILNET}`);
    expect(json.payments[0]?.accountNumber).toBe("••• 4821");
    expect(json.due[0]?.accountNumber).toBe("••• 4821");
    expect(JSON.stringify(json)).not.toContain("5678");
  });

  it("the phone can mark paid but not edit", async () => {
    const { call } = setup();
    const id = (await call("POST", "/payments", rent)).json.payments[0]?.id;
    expect((await call("POST", "/payments", rent, `https://${TAILNET}`)).status).toBe(403);
    expect((await call("POST", `/payments/${id}/paid`, { period: "2026-10" }, `https://${TAILNET}`)).status).toBe(200);
  });

  it("rejects invalid input with a readable error", async () => {
    const { call } = setup();
    const res = await call("POST", "/payments", { ...rent, dueDay: 40 });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain("1 al 31");
    expect((await call("POST", "/payments/1/paid", { period: "2026-13" })).status).toBe(400);
  });

  it("deactivated payments disappear", async () => {
    const { call } = setup();
    const id = (await call("POST", "/payments", rent)).json.payments[0]?.id;
    expect((await call("DELETE", `/payments/${id}`)).json.payments).toEqual([]);
  });
});
