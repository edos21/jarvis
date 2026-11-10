const pad = (n: number): string => String(n).padStart(2, "0");

// Calendar dates in this Mac's time zone, the one my bills and days run on.
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const localPeriod = (d: Date): string => localDate(d).slice(0, 7);

// The local calendar day n days after this moment's day (a negative n goes back).
export const addDays = (d: Date, n: number): string => localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

// A month's day count; monthIndex past 11 or below 0 rolls into the next or previous year.
export const daysInMonth = (year: number, monthIndex: number): number => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
