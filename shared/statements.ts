// One movement of a statement, as import_split.py writes it: date as dd/mm/yyyy, amount in the file's currency.
export type StatementRow = { date: string; description: string; amount: number };

// A CSV of cuentas/files/out, named by the script "<issuer>_<currency>_<statement>.csv".
export type StatementCsvFile = { file: string; issuer: string; currency: string; mtimeMs: number };

export type StatementCsv = StatementCsvFile & { rows: StatementRow[] };

// statement: the name the upload was saved with in cuentas/files; skipped: what the script left out, and why.
export type StatementImport = { statement: string; outputs: StatementCsv[]; skipped: string[] };

export type StatementCsvSave = { file: string; rows: StatementRow[]; mtimeMs: number };

export const isStatementDate = (date: string): boolean => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!match) return false;
  const [, d, m, y] = match.map(Number) as [number, number, number, number];
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
};

export const UNCATEGORIZED = "Sin categoría";

export type SpendingCategory = { category: string; total: number };

// One month (YYYY-MM) of one currency: USD and UYU are never added together.
export type SpendingMonth = { month: string; currency: string; total: number; categories: SpendingCategory[] };

// skipped: CSVs that could not be read (edited by hand into another shape), left out of the totals.
export type SpendingResponse = { months: SpendingMonth[]; skipped: string[]; rulesFile: string };
