import { daysInMonth, localDate } from "../../../shared/dates.js";
import type { DuePayment, DueStatus, Payment } from "../../../shared/payments.js";

// How many days ahead a payment starts showing.
export const UPCOMING_DAYS = 5;

const DAY_MS = 86_400_000;

const STATUS_ORDER: Record<DueStatus, number> = { overdue: 0, due_today: 1, upcoming: 2 };

type Period = { period: string; dueDate: string };

const periodAt = (year: number, monthIndex: number, dueDay: number): Period => {
  const date = new Date(year, monthIndex, Math.min(dueDay, daysInMonth(year, monthIndex)));
  const dueDate = localDate(date);
  return { period: dueDate.slice(0, 7), dueDate };
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// The previous, current and next month's occurrence of each active payment that is not paid and is overdue,
// due today, or due within UPCOMING_DAYS.
export const duePayments = (
  payments: Payment[],
  paidPeriods: Map<number, Set<string>>,
  today: Date,
): DuePayment[] => {
  const todayStr = localDate(today);
  const year = today.getFullYear();
  const month = today.getMonth();
  return payments
    .filter((p) => p.active)
    .flatMap((p) =>
      [-1, 0, 1].flatMap((offset): DuePayment[] => {
        const { period, dueDate } = periodAt(year, month + offset, p.dueDay);
        if (paidPeriods.get(p.id)?.has(period)) return [];
        if (dueDate < p.createdOn) return [];
        const days = daysBetween(todayStr, dueDate);
        const status: DueStatus | null =
          days < 0 ? "overdue" : days === 0 ? "due_today" : days <= UPCOMING_DAYS ? "upcoming" : null;
        return status ? [{ ...p, period, dueDate, status }] : [];
      }),
    )
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.dueDate.localeCompare(b.dueDate));
};
