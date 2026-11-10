import type { Context, Hono } from "hono";

import {
  type Currency,
  type Payment,
  type PaymentInput,
  type PaymentsResponse,
  maskAccount,
} from "../../../shared/payments.js";
import { type ApiError, isRemote } from "../app.js";
import { localPeriod } from "../../../shared/dates.js";
import { duePayments } from "./due.js";
import type { PaymentStore } from "./store.js";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCIES: readonly Currency[] = ["UYU", "USD"];

// My phone never gets a full account number: it shows on the Mac only.
export const forViewer = <T extends Payment>(p: T, remote: boolean): T =>
  remote && p.accountNumber ? { ...p, accountNumber: maskAccount(p.accountNumber) } : p;

const optionalText = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// Validates the fields present in a body; `partial` allows any of them to be missing.
export const parsePaymentInput = (body: Record<string, unknown>, partial: boolean): Partial<PaymentInput> | string => {
  const out: Partial<PaymentInput> = {};
  if ("name" in body || !partial) {
    if (typeof body.name !== "string" || body.name.trim() === "") return "Falta el nombre.";
    out.name = body.name.trim();
  }
  if ("dueDay" in body || !partial) {
    const day = Number(body.dueDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return "El día de vencimiento va del 1 al 31.";
    out.dueDay = day;
  }
  if ("currency" in body || !partial) {
    if (!CURRENCIES.includes(body.currency as Currency)) return "La moneda debe ser UYU o USD.";
    out.currency = body.currency as Currency;
  }
  if ("amount" in body || !partial) {
    if (body.amount === null || body.amount === undefined || body.amount === "") out.amount = null;
    else {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) return "El monto debe ser un número positivo.";
      out.amount = amount;
    }
  }
  if ("link" in body || !partial) {
    const link = optionalText(body.link);
    if (link && !/^https?:\/\//.test(link)) return "El link debe empezar con http:// o https://.";
    out.link = link;
  }
  if ("accountLabel" in body || !partial) out.accountLabel = optionalText(body.accountLabel);
  if ("accountNumber" in body || !partial) out.accountNumber = optionalText(body.accountNumber);
  return out;
};

export const paymentRoutes =
  (store: PaymentStore, now: () => Date = () => new Date()) =>
  (app: Hono): void => {
    const respond = (c: Context) => {
      const remote = isRemote(c);
      const list = store.list();
      const paid = store.paidPeriods();
      const period = localPeriod(now());
      return c.json<PaymentsResponse>({
        payments: list.map((p) => forViewer(p, remote)),
        due: duePayments(list, paid, now()).map((p) => forViewer(p, remote)),
        paidThisPeriod: list.filter((p) => paid.get(p.id)?.has(period)).map((p) => p.id),
      });
    };
    const body = async (c: Context): Promise<Record<string, unknown>> =>
      c.req.json<Record<string, unknown>>().catch(() => ({}));
    const idOf = (c: Context): number => Number(c.req.param("id"));

    app.get("/payments", respond);

    // Editing payments is Mac-only: the phone would otherwise see and overwrite full account numbers.
    app.post("/payments", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Los pagos se editan desde la Mac." }, 403);
      const input = parsePaymentInput(await body(c), false);
      if (typeof input === "string") return c.json<ApiError>({ error: input }, 400);
      store.create(input as PaymentInput);
      return respond(c);
    });

    app.patch("/payments/:id", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Los pagos se editan desde la Mac." }, 403);
      const input = parsePaymentInput(await body(c), true);
      if (typeof input === "string") return c.json<ApiError>({ error: input }, 400);
      if (!store.update(idOf(c), input)) return c.json<ApiError>({ error: "No existe ese pago." }, 404);
      return respond(c);
    });

    app.delete("/payments/:id", (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: "Los pagos se editan desde la Mac." }, 403);
      if (!store.deactivate(idOf(c))) return c.json<ApiError>({ error: "No existe ese pago." }, 404);
      return respond(c);
    });

    app.post("/payments/:id/paid", async (c) => {
      const { period } = await body(c);
      if (typeof period !== "string" || !PERIOD.test(period)) {
        return c.json<ApiError>({ error: "Período inválido." }, 400);
      }
      if (!store.markPaid(idOf(c), period)) return c.json<ApiError>({ error: "No existe ese pago." }, 404);
      return respond(c);
    });

    app.delete("/payments/:id/paid/:period", (c) => {
      store.unmarkPaid(idOf(c), c.req.param("period"));
      return respond(c);
    });
  };
