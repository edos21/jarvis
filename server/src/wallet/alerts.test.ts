import { describe, expect, it } from "vitest";

import type { WalletLevel, WalletPosition, WalletView } from "../../../shared/wallet.js";
import { walletAlerts } from "./alerts.js";

const position = (over: Partial<WalletPosition>): WalletPosition => ({
  symbol: "CRDO",
  description: "Credo",
  currency: "USD",
  quantity: 8,
  price: 150,
  priceSource: "live",
  dayChangePct: -7.24,
  valueUsd: 1200,
  pnlUsd: -355,
  weightPct: 1,
  ...over,
});

const view = (positions: WalletPosition[]): WalletView => ({
  positions,
  cashUsd: 0,
  totalIbkrUsd: 1200,
  dayChangeUsd: 0,
  dayChangePct: null,
  pricesAt: null,
  flexReportDate: "2026-10-29",
});

const now = new Date(2026, 9, 30, 15);

const level = (over: Partial<WalletLevel>): WalletLevel => ({
  id: 1,
  symbol: "CRDO",
  direction: "below",
  price: 148,
  kind: "alert",
  note: null,
  researchId: null,
  ...over,
});

const none = { flexError: null, carteraError: null };

describe("walletAlerts", () => {
  it("a 5% move is a warning keyed by symbol and day", () => {
    const [alert] = walletAlerts(view([position({})]), [], none, now);
    expect(alert).toEqual({
      key: "wallet:move:CRDO:2026-10-30",
      kind: "move",
      severity: "warning",
      symbol: "CRDO",
      title: "CRDO -7,2% hoy",
      detail: "Precio 150,00 USD · tu posición vale $1.200",
      researchId: null,
    });
    expect(walletAlerts(view([position({ dayChangePct: 4.9 })]), [], none, now)).toEqual([]);
    expect(walletAlerts(view([position({ dayChangePct: 5.1 })]), [], none, now)[0]?.title).toBe("CRDO +5,1% hoy");
  });

  it("no move alert without a same-day quote", () => {
    expect(walletAlerts(view([position({ dayChangePct: null })]), [], none, now)).toEqual([]);
  });

  it("crossing a level is critical with its note; not crossing is nothing", () => {
    const stop = level({ id: 3, direction: "below", price: 148, note: "stop de tesis" });
    const target = level({ id: 4, direction: "above", price: 260 });
    const crossed = walletAlerts(view([position({ price: 147.5, dayChangePct: 0 })]), [stop, target], none, now);
    expect(crossed).toEqual([
      {
        key: "wallet:level:3:2026-10-30",
        kind: "level",
        severity: "critical",
        symbol: "CRDO",
        title: "CRDO bajo tu nivel de 148,00 USD",
        detail: "stop de tesis · precio 147,50 USD",
        researchId: null,
      },
    ]);
    expect(walletAlerts(view([position({ price: 270, dayChangePct: 0 })]), [stop, target], none, now)[0]?.title).toBe(
      "CRDO sobre tu nivel de 260,00 USD",
    );
    expect(walletAlerts(view([position({ price: 200, dayChangePct: 0 })]), [stop, target], none, now)).toEqual([]);
    const atClose = walletAlerts(view([position({ price: 147.5, dayChangePct: null, priceSource: "ibkr-close" })]), [stop], none, now);
    expect(atClose[0]?.key).toBe("wallet:level:3:2026-10-29");
  });

  it("a level's kind names it, a stop reminds that Jarvis does not sell, and the analysis travels with it", () => {
    const quote = view([position({ price: 147.5, dayChangePct: 0 })]);
    const [stop] = walletAlerts(quote, [level({ kind: "stop", researchId: 7 })], none, now);
    expect(stop?.title).toBe("CRDO bajo tu stop de 148,00 USD");
    expect(stop?.detail).toBe("precio 147,50 USD · Jarvis no vende: revisa tu orden en IBKR");
    expect(stop?.researchId).toBe(7);
    const [target] = walletAlerts(quote, [level({ kind: "take_profit", direction: "above", price: 140 })], none, now);
    expect(target?.title).toBe("CRDO llegó a tu toma de ganancia de 140,00 USD");
  });

  it("a level written as BRK.B matches IBKR's BRK B", () => {
    const quote = view([position({ symbol: "BRK B", price: 480, dayChangePct: 0 })]);
    expect(walletAlerts(quote, [level({ symbol: "BRK.B", price: 490 })], none, now)).toHaveLength(1);
  });

  it("flex token error becomes a renew card, and a cartera.md problem says why", () => {
    const alerts = walletAlerts(null, [], { flexError: { kind: "token", message: "Token has expired." }, carteraError: "la tabla de IBKR no tiene las columnas esperadas" }, now);
    expect(alerts.map((a) => [a.kind, a.title])).toEqual([
      ["sync", "Renueva el token de IBKR"],
      ["sync", "No actualicé cartera.md"],
    ]);
    expect(alerts[1]?.detail).toBe("la tabla de IBKR no tiene las columnas esperadas");
  });

  it("a statement the query has to be fixed for asks to review the query, not to wait for IBKR", () => {
    const flexError = { kind: "format" as const, message: "la Flex Query no tiene la sección Open Positions; agrégala con todos sus campos" };
    const [alert] = walletAlerts(null, [], { flexError, carteraError: null }, now);
    expect(alert?.title).toBe("Revisa tu Flex Query de IBKR");
    expect(alert?.detail).toBe("la Flex Query no tiene la sección Open Positions; agrégala con todos sus campos");
  });
});
