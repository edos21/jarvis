import type { Hono } from "hono";

import type { GoogleStatus } from "../../../shared/google.js";
import { type ApiError, isRemote } from "../app.js";
import { type AccountStore, publicAccount } from "./accounts.js";
import { type GoogleAuth, MissingScopes } from "./oauth.js";

const MAC_ONLY = "Las cuentas de Google se conectan desde la Mac.";
const NOT_CONFIGURED =
  "Falta configurar Google: agrega JARVIS_GOOGLE_CLIENT_ID y JARVIS_GOOGLE_CLIENT_SECRET en ~/.jarvis/env y reinicia Jarvis.";

const page = (title: string, detail: string): string =>
  `<!doctype html><html lang="es"><meta charset="utf-8"><title>Jarvis</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.3rem">${title}</h1><p>${detail}</p><p><a href="/#correo">Volver a Jarvis</a></p></body></html>`;

export const googleRoutes =
  (deps: { auth: GoogleAuth | null; accounts: AccountStore; onChange?: () => void }) =>
  (app: Hono): void => {
    const { auth, accounts } = deps;

    app.get("/google/status", (c) =>
      c.json<GoogleStatus>({ configured: auth !== null, accounts: accounts.list().map(publicAccount) }),
    );

    app.get("/google/connect", (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      if (!auth) return c.json<ApiError>({ error: NOT_CONFIGURED }, 409);
      return c.redirect(auth.authUrl("personal"), 302);
    });

    // Google sends the browser back here after consent; the state ties it to a sign-in this server started.
    app.get("/google/callback", async (c) => {
      if (!auth) return c.html(page("Google no está configurado", NOT_CONFIGURED), 409);
      const { code, state, error } = c.req.query();
      if (error || !code || !state) {
        return c.html(page("No se conectó la cuenta", "Cancelaste el permiso o Google no lo devolvió. Prueba de nuevo."), 400);
      }
      try {
        accounts.save(await auth.exchange(code, state));
        deps.onChange?.();
        return c.redirect("/#correo", 302);
      } catch (e) {
        console.error(`google callback failed: ${(e as Error).message}`);
        if (e instanceof MissingScopes) {
          return c.html(
            page("Faltan permisos", "Jarvis necesita leer tu calendario y tus tareas, y ordenar tu correo. Conecta de nuevo y deja marcadas todas las casillas."),
            400,
          );
        }
        return c.html(page("No se conectó la cuenta", "El inicio de sesión venció o ya se usó. Vuelve a conectar desde Jarvis."), 400);
      }
    });

    app.delete("/google/accounts/:email", async (c) => {
      if (isRemote(c)) return c.json<ApiError>({ error: MAC_ONLY }, 403);
      const email = c.req.param("email");
      const account = accounts.get(email);
      if (!account) return c.json<ApiError>({ error: "Esa cuenta no está conectada." }, 404);
      await auth?.revoke(account.refreshToken);
      auth?.forget(email);
      accounts.remove(email);
      deps.onChange?.();
      return c.json<GoogleStatus>({ configured: auth !== null, accounts: accounts.list().map(publicAccount) });
    });
  };
