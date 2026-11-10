import type { MailKind } from "../../../shared/mail.js";

// Senders that only ever send machine mail. More can go in ~/.jarvis/automated-senders, one domain or full address
// per line.
export const DEFAULT_AUTOMATED_DOMAINS: readonly string[] = [
  "linear.app",
  "github.com",
  "datadoghq.com",
  "newrelic.com",
  "atlassian.net",
  "slack.com",
  "google.com",
  "accounts.google.com",
];

const INVOICE_WORDS = /\b(factura|invoice|recibo|receipt|estado de cuenta|vencimiento|pago)\b/i;
// Gmail's own tabs: senders without list headers (banks, shops) still land in Promotions or Updates.
const PROMOTIONS = "CATEGORY_PROMOTIONS";
const AUTOMATED_CATEGORIES = new Set(["CATEGORY_UPDATES", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);
const MACHINE_LOCAL_PART = /^(no-?reply|notifications?|alerts?|mailer-daemon)([+._-]|$)/i;

export const parseFrom = (from: string): { name: string; address: string } => {
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  const address = (angled?.[2] ?? from).trim().toLowerCase();
  const name = angled?.[1]?.trim() || address.split("@")[0] || address;
  return { name, address };
};

const senderIn = (address: string, entries: readonly string[]): boolean => {
  const domain = address.split("@")[1] ?? "";
  return entries.some((e) => (e.includes("@") ? address === e : domain === e || domain.endsWith(`.${e}`)));
};

// Rules, most specific first: an invoice is an invoice even when it comes from a noreply address.
export const classifyMail = (
  headers: Map<string, string>,
  labelIds: readonly string[],
  automatedDomains: readonly string[],
): MailKind => {
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return "newsletter";
  if (/^(bulk|list)$/i.test(headers.get("precedence")?.trim() ?? "")) return "newsletter";
  if (labelIds.includes(PROMOTIONS)) return "newsletter";
  if (INVOICE_WORDS.test(headers.get("subject") ?? "")) return "invoice";
  if (labelIds.some((label) => AUTOMATED_CATEGORIES.has(label))) return "notification";
  const { address } = parseFrom(headers.get("from") ?? "");
  if (MACHINE_LOCAL_PART.test(address.split("@")[0] ?? "")) return "notification";
  if (senderIn(address, automatedDomains)) return "notification";
  return "person";
};
