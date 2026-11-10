import type { Context, Hono } from "hono";

import {
  type MailResponse,
  type MailboxResponse,
  type SweepApply,
  type SweepReport,
  canTrashGroup,
  isMailAction,
  isMailKind,
} from "../../../shared/mail.js";
import type { ApiError } from "../app.js";
import { GoogleApiError, isRateLimited } from "../google/api.js";
import { GoogleAuthExpired } from "../google/oauth.js";
import { type MailSource, SnapshotExpired, UnknownAccount, UnreadableSender } from "./source.js";
import { type MailSweep, SweepConflict } from "./sweep.js";

// The inbox read lists at most 100 messages, so a selection never needs more.
const MAX_SELECTED = 100;

const failure = (c: Context, error: unknown) => {
  if (error instanceof SnapshotExpired) return c.json<ApiError>({ error: "La lista cambió. Recarga y vuelve a intentar." }, 409);
  if (error instanceof UnknownAccount) return c.json<ApiError>({ error: "Esa cuenta no está conectada." }, 404);
  if (error instanceof UnreadableSender) {
    return c.json<ApiError>({ error: "No pude leer un remitente único en ese correo." }, 400);
  }
  if (error instanceof SweepConflict) return c.json<ApiError>({ error: error.message }, 409);
  if (error instanceof GoogleApiError && isRateLimited(error.status, error.reason)) {
    return c.json<ApiError>({ error: "Gmail pidió ir más despacio. Espera un par de minutos y vuelve a intentar." }, 429);
  }
  if (error instanceof GoogleAuthExpired) return c.json<ApiError>({ error: "Jarvis perdió el acceso. Reconecta tu Gmail." }, 409);
  throw error;
};

const sweepRequest = (body: { id?: unknown; action?: unknown; filterAction?: unknown }): SweepApply | null => {
  if (typeof body.id !== "string") return null;
  if (body.action === "trash" || body.action === "archive" || body.action === "unsubscribe") return { id: body.id, action: body.action };
  if (body.action === "filter" && (body.filterAction === "trash" || body.filterAction === "skip_inbox")) {
    return { id: body.id, action: "filter", filterAction: body.filterAction };
  }
  return null;
};

// Every action works from the phone too: archive, read and trash are all undone from Gmail (trash for 30 days).
export const mailRoutes =
  (source: MailSource, sweep: MailSweep) =>
  (app: Hono): void => {
    app.get("/mail", async (c) => c.json<MailResponse>(await source.read()));

    // Registered before /mail/:account/... so "sweep" is never read as an account.
    app.get("/mail/sweep", (c) => c.json<SweepReport | null>(sweep.latest()));

    app.post("/mail/sweep/analyze", async (c) => {
      try {
        return c.json<SweepReport>(await sweep.analyze());
      } catch (error) {
        return failure(c, error);
      }
    });

    app.post("/mail/sweep/apply", async (c) => {
      const body = await c.req
        .json<{ id?: unknown; action?: unknown; filterAction?: unknown; confirm?: unknown }>()
        .catch(() => ({}) as Record<string, unknown>);
      const request = sweepRequest(body);
      if (!request || body.confirm !== true) return c.json<ApiError>({ error: "Falta confirmar." }, 400);
      try {
        return c.json<SweepReport>(await sweep.apply(request));
      } catch (error) {
        return failure(c, error);
      }
    });

    app.post("/mail/:account/groups/:kind/:action", async (c) => {
      const { kind, action } = c.req.param();
      if (!isMailKind(kind) || !isMailAction(action)) return c.json<ApiError>({ error: "No existe." }, 404);
      if (action === "trash" && !canTrashGroup(kind)) {
        return c.json<ApiError>({ error: "Ese grupo se archiva, no se elimina entero." }, 400);
      }
      const body = await c.req.json<{ snapshotId?: string }>().catch(() => ({ snapshotId: undefined }));
      if (!body.snapshotId) return c.json<ApiError>({ error: "Falta el snapshot." }, 400);
      try {
        return c.json<MailboxResponse>(await source.actOnGroup(c.req.param("account"), kind, body.snapshotId, action));
      } catch (error) {
        return failure(c, error);
      }
    });

    app.post("/mail/:account/messages/:action", async (c) => {
      const action = c.req.param("action");
      if (!isMailAction(action)) return c.json<ApiError>({ error: "No existe." }, 404);
      const body = await c.req.json<{ ids?: unknown }>().catch(() => ({ ids: undefined }));
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
      if (ids.length === 0 || ids.length > MAX_SELECTED) return c.json<ApiError>({ error: "Selecciona entre 1 y 100 correos." }, 400);
      try {
        return c.json<MailboxResponse>(await source.actOnMessages(c.req.param("account"), ids, action));
      } catch (error) {
        return failure(c, error);
      }
    });

    app.post("/mail/:account/messages/:id/not-a-person", async (c) => {
      try {
        return c.json<MailboxResponse>(await source.markNotPerson(c.req.param("account"), c.req.param("id")));
      } catch (error) {
        return failure(c, error);
      }
    });
  };
