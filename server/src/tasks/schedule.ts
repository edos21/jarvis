import { daysInMonth } from "../../../shared/dates.js";
import type { Repeat } from "../../../shared/tasks.js";

// Calendar days as YYYY-MM-DD, worked out in UTC so a daylight-saving change never moves a day.
const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split("-").map(Number);
  return [y ?? 0, (m ?? 1) - 1, d ?? 1];
};

const format = (date: Date): string => date.toISOString().slice(0, 10);

// The k-th occurrence counted from the first one. Months keep the first one's day, or the month's last day when it
// has fewer (a series on the 31st falls on the 30th, and on the 28th or 29th in February).
export const occurrence = (anchor: string, { every, unit }: Repeat, k: number): string => {
  const [y, m, d] = parts(anchor);
  if (unit === "day" || unit === "week") {
    return format(new Date(Date.UTC(y, m, d + k * every * (unit === "week" ? 7 : 1))));
  }
  const months = m + k * every * (unit === "year" ? 12 : 1);
  const year = y + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  return format(new Date(Date.UTC(year, month, Math.min(d, daysInMonth(year, month)))));
};

// The next day the series is due: after the one just done and never in the past, so a task done late does not
// leave a pile of missed ones behind.
export const nextDue = (anchor: string, repeat: Repeat, after: string | null, today: string): string => {
  for (let k = 0; ; k += 1) {
    const day = occurrence(anchor, repeat, k);
    if (day >= today && (after === null || day > after)) return day;
  }
};
