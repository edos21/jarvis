import { and, eq } from "drizzle-orm";

import { localDate } from "../../../shared/dates.js";
import type { Payment, PaymentInput } from "../../../shared/payments.js";
import type { Db } from "../db.js";
import { paymentMarks, payments } from "../schema.js";

export type PaymentStore = {
  list(): Payment[];
  paidPeriods(): Map<number, Set<string>>;
  create(input: PaymentInput): Payment;
  update(id: number, input: Partial<PaymentInput>): Payment | null;
  deactivate(id: number): boolean;
  markPaid(id: number, period: string): boolean;
  unmarkPaid(id: number, period: string): void;
};

export const createPaymentStore = (db: Db, now: () => Date = () => new Date()): PaymentStore => {
  const byId = (id: number): Payment | null => db.select().from(payments).where(eq(payments.id, id)).get() ?? null;
  return {
    list: () => db.select().from(payments).where(eq(payments.active, true)).all(),
    paidPeriods: () => {
      const map = new Map<number, Set<string>>();
      for (const mark of db.select().from(paymentMarks).all()) {
        const set = map.get(mark.paymentId) ?? new Set<string>();
        set.add(mark.period);
        map.set(mark.paymentId, set);
      }
      return map;
    },
    create: (input) => db.insert(payments).values({ ...input, createdOn: localDate(now()) }).returning().get(),
    update: (id, input) => {
      if (!byId(id)) return null;
      return db.update(payments).set(input).where(eq(payments.id, id)).returning().get();
    },
    deactivate: (id) => db.update(payments).set({ active: false }).where(eq(payments.id, id)).run().changes > 0,
    markPaid: (id, period) => {
      if (!byId(id)) return false;
      db.insert(paymentMarks).values({ paymentId: id, period }).onConflictDoNothing().run();
      return true;
    },
    unmarkPaid: (id, period) => {
      db.delete(paymentMarks)
        .where(and(eq(paymentMarks.paymentId, id), eq(paymentMarks.period, period)))
        .run();
    },
  };
};
