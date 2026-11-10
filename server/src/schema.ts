import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { LEVEL_KINDS } from "../../shared/wallet.js";

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  amount: real("amount"),
  currency: text("currency", { enum: ["UYU", "USD"] }).notNull(),
  dueDay: integer("due_day").notNull(),
  link: text("link"),
  accountLabel: text("account_label"),
  accountNumber: text("account_number"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Local date (YYYY-MM-DD): periods due before it are not overdue, they predate the reminder.
  createdOn: text("created_on").notNull(),
});

// A payment marked paid for one period (YYYY-MM); the next period shows it again.
export const paymentMarks = sqliteTable(
  "payment_marks",
  {
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    period: text("period").notNull(),
    paidAt: text("paid_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.period] })],
);

// One per browser that accepted notifications (my phone, the Mac).
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Every notification sent, by its key, so a restart or the next tick never sends it twice.
export const sentNotifications = sqliteTable("sent_notifications", {
  key: text("key").primaryKey(),
  sentAt: text("sent_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Google accounts connected through OAuth. The refresh token never leaves this table: not in logs, not in the API.
export const googleAccounts = sqliteTable("google_accounts", {
  email: text("email").primaryKey(),
  kind: text("kind", { enum: ["personal"] }).notNull(),
  refreshToken: text("refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: text("connected_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// The latest IBKR snapshot (Flex, last close): each new one replaces the previous rows.
export const walletPositions = sqliteTable("wallet_positions", {
  symbol: text("symbol").primaryKey(),
  description: text("description").notNull(),
  assetCategory: text("asset_category").notNull(),
  subCategory: text("sub_category").notNull(),
  currency: text("currency").notNull(),
  listingExchange: text("listing_exchange").notNull(),
  quantity: real("quantity").notNull(),
  markPrice: real("mark_price").notNull(),
  costBasisPrice: real("cost_basis_price").notNull(),
  positionValue: real("position_value").notNull(),
  unrealizedPnl: real("unrealized_pnl").notNull(),
  fxRateToBase: real("fx_rate_to_base").notNull(),
});

export const walletCash = sqliteTable("wallet_cash", {
  currency: text("currency").primaryKey(),
  amount: real("amount").notNull(),
});

// Small facts about the wallet sync: when Flex last ran, its last error, the cartera.md sync result.
export const walletMeta = sqliteTable("wallet_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Small facts about Jarvis itself that outlive a restart and are shared by every screen (the day I read the briefing).
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Prices I set per ticker (a stop, a target): crossing one is an alert.
export const walletLevels = sqliteTable("wallet_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  direction: text("direction", { enum: ["below", "above"] }).notNull(),
  price: real("price").notNull(),
  kind: text("kind", { enum: LEVEL_KINDS }).notNull().default("alert"),
  note: text("note"),
  researchId: integer("research_id"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Agent runs: "Investigar" and the monthly satellite pick. The markdown stays here until saved to the notes.
export const research = sqliteTable("research", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["investigate", "satellite"] }).notNull(),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  markdown: text("markdown"),
  error: text("error"),
  costUsd: real("cost_usd"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  savedPath: text("saved_path"),
  // JSON SuggestedLevel[]: the levels the report recommends, created only when I click.
  suggestedLevels: text("suggested_levels"),
  jarvisNote: text("jarvis_note"),
});

// The IBKR account's value per day (YYYY-MM-DD): IBKR's close when the NAV query has it, my own valuation otherwise.
export const walletNav = sqliteTable("wallet_nav", {
  date: text("date").primaryKey(),
  totalUsd: real("total_usd").notNull(),
  source: text("source", { enum: ["ibkr", "live"] }).notNull(),
});

// One reading of the Mac per tick (every 10 minutes); older than 30 days is pruned.
export const macSamples = sqliteTable("mac_samples", {
  at: text("at").primaryKey(),
  cpuPct: real("cpu_pct").notNull(),
  memPct: real("mem_pct").notNull(),
  diskPct: real("disk_pct").notNull(),
});

// A repeating task Jarvis keeps, because the Google Tasks API exposes no repetition: one task in Google at a time,
// the next one created once it is done. anchorDue is the first day (YYYY-MM-DD): every later one counts from it.
export const taskRules = sqliteTable("task_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account: text("account").notNull(),
  listId: text("list_id").notNull(),
  title: text("title").notNull(),
  every: integer("every").notNull(),
  unit: text("unit", { enum: ["day", "week", "month", "year"] }).notNull(),
  anchorDue: text("anchor_due").notNull(),
  currentTaskId: text("current_task_id"),
  currentDue: text("current_due"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
