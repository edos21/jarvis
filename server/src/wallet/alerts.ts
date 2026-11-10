import { localDate } from "../../../shared/dates.js";
import { type FlexFailure, type WalletAlert, type WalletLevel, type WalletView, sameTicker } from "../../../shared/wallet.js";

// A day move this big on one position is worth a look.
const MOVE_PCT = 5;

const flexAlertText = (failure: FlexFailure): { title: string; detail: string } => {
  switch (failure.kind) {
    case "token":
      return {
        title: "Renueva el token de IBKR",
        detail: "El token del Flex Web Service venció o fue revocado. Genera uno nuevo en el portal y ponlo en ~/.jarvis/env.",
      };
    // IBKR answered, but with a statement the query has to be fixed for; retrying will not help.
    case "format":
      return { title: "Revisa tu Flex Query de IBKR", detail: failure.message };
    case "other":
      return { title: "IBKR no respondió", detail: failure.message };
  }
};

const levelLabel = (level: WalletLevel): string => {
  if (level.kind === "take_profit") return "llegó a tu toma de ganancia de";
  return `${level.direction === "below" ? "bajo" : "sobre"} tu ${level.kind === "stop" ? "stop" : "nivel"} de`;
};

const amount = (n: number, currency: string): string =>
  `${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const usd = (n: number): string => `$${Math.round(n).toLocaleString("es-UY")}`;
const signedPct = (n: number): string =>
  `${n.toLocaleString("es-UY", { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "always" })}%`;

export const walletAlerts = (
  view: WalletView | null,
  levels: WalletLevel[],
  errors: { flexError: FlexFailure | null; carteraError: string | null },
  now: Date,
): WalletAlert[] => {
  const day = localDate(now);
  const alerts: WalletAlert[] = [];
  for (const level of levels) {
    const position = view?.positions.find((p) => sameTicker(p.symbol, level.symbol));
    if (!position) continue;
    const crossed = level.direction === "below" ? position.price <= level.price : position.price >= level.price;
    if (!crossed) continue;
    alerts.push({
      // Crossed at IBKR's close, the price does not move until the next statement: one alert per close, not per day.
      key: `wallet:level:${level.id}:${position.priceSource === "live" ? day : (view?.flexReportDate ?? day)}`,
      kind: "level",
      severity: "critical",
      symbol: level.symbol,
      title: `${level.symbol} ${levelLabel(level)} ${amount(level.price, position.currency)}`,
      detail: [
        level.note,
        `precio ${amount(position.price, position.currency)}`,
        level.kind === "stop" ? "Jarvis no vende: revisa tu orden en IBKR" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      researchId: level.researchId,
    });
  }
  for (const position of view?.positions ?? []) {
    if (position.dayChangePct === null || Math.abs(position.dayChangePct) < MOVE_PCT) continue;
    alerts.push({
      key: `wallet:move:${position.symbol}:${day}`,
      kind: "move",
      severity: "warning",
      symbol: position.symbol,
      researchId: null,
      title: `${position.symbol} ${signedPct(position.dayChangePct)} hoy`,
      detail: `Precio ${amount(position.price, position.currency)} · tu posición vale ${usd(position.valueUsd)}`,
    });
  }
  if (errors.flexError) {
    alerts.push({
      key: "wallet:sync:flex",
      kind: "sync",
      severity: "warning",
      symbol: null,
      researchId: null,
      ...flexAlertText(errors.flexError),
    });
  }
  if (errors.carteraError) {
    alerts.push({
      key: "wallet:sync:cartera",
      kind: "sync",
      severity: "warning",
      symbol: null,
      researchId: null,
      title: "No actualicé cartera.md",
      detail: errors.carteraError,
    });
  }
  return alerts;
};
