import type { StatementRow } from "../../../shared/statements.js";

const HEADER = ["Date", "Description", "Amount"];

export class InvalidCsv extends Error {}

// RFC 4180: a field may be quoted, and inside quotes a comma, a newline or a doubled quote is part of it.
const records = (text: string): string[][] => {
  const out: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      out.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    out.push(record);
  }
  return out.filter((r) => !(r.length === 1 && r[0] === ""));
};

export const parseCsv = (text: string): StatementRow[] => {
  const [header, ...rows] = records(text);
  if (!header || header.join(",") !== HEADER.join(",")) throw new InvalidCsv(`el CSV no tiene las columnas ${HEADER.join(", ")}`);
  return rows.map((r, i) => {
    // Number("") is 0: an empty amount (pandas' NaN, a hand edit) is an error, not a free 0.00.
    const amount = r[2]?.trim() ? Number(r[2]) : Number.NaN;
    if (r.length !== 3 || !Number.isFinite(amount)) throw new InvalidCsv(`la fila ${i + 2} no tiene fecha, descripción y monto`);
    return { date: r[0]!, description: r[1]!, amount };
  });
};

const field = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

// The same shape pandas writes: header, "\n" line ends and amounts with two decimals.
export const toCsv = (rows: StatementRow[]): string =>
  [HEADER.join(","), ...rows.map((r) => [field(r.date), field(r.description), r.amount.toFixed(2)].join(","))].join("\n") + "\n";
