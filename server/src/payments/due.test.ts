import { describe, expect, it } from "vitest";

import { type Payment, maskAccount } from "../../../shared/payments.js";
import { duePayments } from "./due.js";

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 1,
  name: "Alquiler",
  amount: 950,
  currency: "USD",
  dueDay: 10,
  link: null,
  accountLabel: "Banco Uno",
  accountNumber: "1234 5678 4821",
  active: true,
  createdOn: "2026-01-01",
  ...over,
});

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

const paid = (id: number, ...periods: string[]) => new Map([[id, new Set(periods)]]);

describe("duePayments", () => {
  it("dueDay 31 in February is due on the 28th", () => {
    const [due] = duePayments([payment({ dueDay: 31 })], paid(1, "2026-01"), day(2026, 2, 28));
    expect(due).toMatchObject({ period: "2026-02", dueDate: "2026-02-28", status: "due_today" });
  });

  it("paid in 2026-10 does not hide 2026-11", () => {
    const due = duePayments([payment()], paid(1, "2026-10"), day(2026, 11, 10));
    expect(due.map((d) => [d.period, d.status])).toEqual([["2026-11", "due_today"]]);
  });

  it("shows upcoming 5 days before, hides 6 days before", () => {
    expect(duePayments([payment()], paid(1, "2026-09"), day(2026, 10, 5))[0]?.status).toBe("upcoming");
    expect(duePayments([payment()], paid(1, "2026-09"), day(2026, 10, 4))).toEqual([]);
  });

  it("upcoming crosses into next month", () => {
    const due = duePayments([payment({ dueDay: 2 })], paid(1, "2026-09", "2026-10"), day(2026, 10, 30));
    expect(due.map((d) => [d.period, d.status])).toEqual([["2026-11", "upcoming"]]);
  });

  it("overdue stays until marked paid", () => {
    const today = day(2026, 10, 25);
    expect(duePayments([payment()], paid(1, "2026-09"), today)[0]).toMatchObject({
      period: "2026-10",
      status: "overdue",
    });
    expect(duePayments([payment()], paid(1, "2026-09", "2026-10"), today)).toEqual([]);
  });

  it("an unpaid previous month is overdue alongside the current one", () => {
    const due = duePayments([payment()], new Map(), day(2026, 10, 12));
    expect(due.map((d) => d.period)).toEqual(["2026-09", "2026-10"]);
  });

  it("a payment created after its due date is not overdue for that period", () => {
    const due = duePayments([payment({ createdOn: "2026-10-30" })], new Map(), day(2026, 10, 30));
    expect(due).toEqual([]);
  });

  it("inactive payments never show", () => {
    expect(duePayments([payment({ active: false })], new Map(), day(2026, 10, 10))).toEqual([]);
  });

  it("orders overdue, then due today, then upcoming by date", () => {
    const sept = new Set(["2026-09"]);
    const due = duePayments(
      [payment({ id: 1, dueDay: 14 }), payment({ id: 2, dueDay: 12 }), payment({ id: 3, dueDay: 8 })],
      new Map([
        [1, sept],
        [2, sept],
        [3, sept],
      ]),
      day(2026, 10, 12),
    );
    expect(due.map((d) => [d.id, d.status])).toEqual([
      [3, "overdue"],
      [2, "due_today"],
      [1, "upcoming"],
    ]);
  });
});

describe("maskAccount", () => {
  it("keeps the last 4", () => {
    expect(maskAccount("1234 5678 4821")).toBe("••• 4821");
  });
});
