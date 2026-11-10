import type React from "react";
import type { Severity } from "../../../shared/mac";
import type { LevelDirection, LevelKind } from "../../../shared/wallet";

// Inline, because the card's own border color would otherwise win over a left-border utility.
export const severityStripe = (severity: Severity): React.CSSProperties => ({ borderLeftColor: `var(--${severity})` });

export const timeOf = (at: string | number): string =>
  new Date(at).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });

// "YYYY-MM-DD" (or "YYYY-MM") read as a local date, so a day never shifts by the time zone.
export const dayToMs = (day: string): number => {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

export const shortDay = (ms: number): string => new Date(ms).toLocaleDateString("es-UY", { day: "numeric", month: "short" });

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const LEVEL_KIND_LABEL: Record<LevelKind, string> = { stop: "Stop", take_profit: "Toma de ganancia", alert: "Alerta" };

export const LEVEL_DIRECTION_LABEL: Record<LevelDirection, string> = { below: "baja de", above: "sube de" };

// IBKR writes share classes with a space ("BRK B"); the notes and the market write "BRK.B".
export const ticker = (symbol: string): string => symbol.replace(/ /g, ".");

// Every amount is written the same way: es-UY digits, then the currency code. usd is the whole-dollar version for
// totals read at a glance; amountIn keeps the cents. A table names its currency once, in the header, with wholeUnits.
export const wholeUnits = (n: number): string => Math.round(n).toLocaleString("es-UY");

export const usd = (n: number): string => `${wholeUnits(n)} USD`;

export const amountIn = (n: number, currency: string): string =>
  `${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

// A share of a whole, such as a position's weight: one decimal, no sign.
export const pct = (n: number): string =>
  `${n.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const count = (n: number): string => n.toLocaleString("es-UY");

export const signedPct = (n: number): string =>
  `${n.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" })}%`;

// Up, down or flat, as a color for numbers that move.
export const moveTone = (n: number | null): string => (n === null || n === 0 ? "text-muted" : n > 0 ? "text-good" : "text-critical");

export const dateTimeOf = (iso: string): string =>
  new Date(iso).toLocaleString("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Disk and memory sizes the way Finder shows them: decimal units.
export const formatBytes = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
