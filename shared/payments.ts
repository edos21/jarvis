export type Currency = "UYU" | "USD";

export type Payment = {
  id: number;
  name: string;
  amount: number | null;
  currency: Currency;
  // Day of the month it is due; past the month's last day it falls on the last day.
  dueDay: number;
  link: string | null;
  accountLabel: string | null;
  accountNumber: string | null;
  active: boolean;
  createdOn: string;
};

export type PaymentInput = Omit<Payment, "id" | "active" | "createdOn">;

export type DueStatus = "overdue" | "due_today" | "upcoming";

export type DuePayment = Payment & { period: string; dueDate: string; status: DueStatus };

// paidThisPeriod: ids marked paid for the current month, so a mistaken "Pagado" can be undone.
export type PaymentsResponse = { payments: Payment[]; due: DuePayment[]; paidThisPeriod: number[] };

export const maskAccount = (n: string): string => `••• ${n.replace(/\s/g, "").slice(-4)}`;
