import { type SpendingMonth, type SpendingResponse, type StatementCsv, UNCATEGORIZED } from "../../../shared/statements.js";
import { InvalidCsv } from "./csv.js";
import { type StatementDeps, csvRef, listCsvs, readCsv } from "./run.js";

// Some exports write the merchant's category into the description: "Merchant (Category)".
const OWN_CATEGORY = /\(([^()]+)\)\s*$/;

const round = (n: number): number => Math.round(n * 100) / 100;

// The export's own category first; otherwise the first of my patterns the description contains.
export const categoryOf = (description: string, rules: Map<string, string>): string => {
  const own = OWN_CATEGORY.exec(description)?.[1]?.trim();
  if (own) return own;
  const upper = description.toUpperCase();
  for (const [pattern, category] of rules) if (upper.includes(pattern.toUpperCase())) return category;
  return UNCATEGORIZED;
};

// Positive amounts are spending, as the script writes them; a refund comes negative and lowers its month.
export const summarizeSpending = (csvs: StatementCsv[], rules: Map<string, string>): SpendingMonth[] => {
  const months = new Map<string, Map<string, number>>();
  for (const csv of csvs) {
    for (const row of csv.rows) {
      const [, mm, yyyy] = row.date.split("/");
      const key = `${yyyy}-${mm} ${csv.currency}`;
      const categories = months.get(key) ?? new Map<string, number>();
      const category = categoryOf(row.description, rules);
      categories.set(category, (categories.get(category) ?? 0) + row.amount);
      months.set(key, categories);
    }
  }
  return [...months]
    .map(([key, categories]) => {
      const [month = "", currency = ""] = key.split(" ");
      const list = [...categories]
        .map(([category, total]) => ({ category, total: round(total) }))
        .sort((a, b) => b.total - a.total);
      return { month, currency, total: round(list.reduce((sum, c) => sum + c.total, 0)), categories: list };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
};

export const readSpending = (deps: StatementDeps, rules: Map<string, string>, rulesFile: string): SpendingResponse => {
  const csvs: StatementCsv[] = [];
  const skipped: string[] = [];
  for (const entry of listCsvs(deps)) {
    const ref = csvRef(deps, entry.file);
    if (!ref) continue;
    try {
      csvs.push(readCsv(ref));
    } catch (error) {
      if (!(error instanceof InvalidCsv)) throw error;
      skipped.push(entry.file);
    }
  }
  return { months: summarizeSpending(csvs, rules), skipped, rulesFile };
};
