import type { Hono } from "hono";

import { type PositionHistory, type WalletHistory, type WalletResponse, isHistoryRange, parseLevelInput } from "../../../shared/wallet.js";
import { type ApiError, isRemote } from "../app.js";
import { FlexError } from "./flex.js";
import type { LevelStore } from "./levels.js";
import type { WalletSource } from "./source.js";

const MAC_ONLY = "Los niveles se editan desde la Mac.";

export const walletRoutes =
  (source: WalletSource, levels: LevelStore) =>
  (app: Hono): void => {
    app.get("/wallet", async (c) => c.json<WalletResponse>(await source.read()));

    app.get("/wallet/history", (c) => {
      const range = c.req.query("range") ?? "3m";
      if (!isHistoryRange(range)) return c.json<ApiError>({ error: "Rango inválido." }, 400);
      return c.json<WalletHistory>(source.history(range));
    });

    app.get("/wallet/history/:symbol", async (c) => {
      const range = c.req.query("range") ?? "3m";
      if (!isHistoryRange(range)) return c.json<ApiError>({ error: "Rango inválido." }, 400);
      try {
        const history = await source.positionHistory(c.req.param("symbol"), range);
        if (!history) return c.json<ApiError>({ error: "Esa posición no está en tu cartera." }, 404);
        return c.json<PositionHistory>(history);
      } catch {
        return c.json<ApiError>({ error: "Yahoo no devolvió el historial de esta posición." }, 502);
      }
    });

    // Allowed from the phone too: it only reads IBKR and Yahoo again.
    app.post("/wallet/refresh", async (c) => {
      const what = c.req.query("what");
      if (what !== "prices" && what !== "flex") return c.json<ApiError>({ error: "No existe." }, 404);
      try {
        await (what === "flex" ? source.refreshFlex() : source.refreshPrices());
      } catch (error) {
        // The read below carries the error the page shows; anything that is not IBKR's answer is a real failure.
        if (!(error instanceof FlexError)) throw error;
      }
      return c.json<WalletResponse>(await source.read());
    });

    app.post("/wallet/levels", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      const input = parseLevelInput(await c.req.json<unknown>().catch(() => null));
      if (!input) return c.json<ApiError>({ error: "Falta el ticker, la dirección, el tipo o un precio válido." }, 400);
      levels.create(input);
      return c.json<WalletResponse>(await source.read());
    });

    app.delete("/wallet/levels/:id", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      if (!levels.remove(Number(c.req.param("id")))) return c.json<ApiError>({ error: "Ese nivel no existe." }, 404);
      return c.json<WalletResponse>(await source.read());
    });
  };
