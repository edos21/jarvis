import { type Context, Hono, type MiddlewareHandler } from "hono";

export type AppDeps = {
  tailnetHost: string | null;
  // When set, a request through Tailscale must come from this Tailscale login (my account), not any tailnet device.
  tailscaleLogin?: string | null;
  // Each module mounts its routes under /api.
  routes?: ((app: Hono) => void)[];
};

export type ApiError = { error: string };

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Headers `tailscale serve` adds when it proxies a request. A page in my browser cannot send them to 127.0.0.1
// without a CORS preflight, which fails; a local tool that sends them only restricts itself.
const PROXY_HEADERS = ["x-forwarded-for", "tailscale-user-login"];

// My phone reaches Jarvis only through `tailscale serve`.
export const isRemote = (c: Context): boolean => c.get("remote") === true;

// A whole area whose data never leaves the Mac (notes, statements): every route under the prefix, reading included.
export const macOnly = (app: Hono, prefix: string, message: string): void => {
  const deny: MiddlewareHandler = async (c, next) => (isRemote(c) ? c.json<ApiError>({ error: message }, 403) : next());
  app.use(prefix, deny);
  app.use(`${prefix}/*`, deny);
};

declare module "hono" {
  interface ContextVariableMap {
    remote: boolean;
  }
}

export const webOrigins = (tailnetHost: string | null): string[] => [
  "http://127.0.0.1:4418",
  "http://localhost:4418",
  "http://127.0.0.1:4417",
  "http://localhost:4417",
  ...(tailnetHost ? [`https://${tailnetHost}`] : []),
];

// Listening on 127.0.0.1 does not keep out the browser itself: any page I have open can send a request here.
// A known Host stops DNS rebinding, and writes must come from Jarvis's own pages (no Origin is a local tool like curl).
// Remote is decided by the proxy headers as well as the Host, so a tailnet request cannot pass as local by
// sending `Host: localhost`.
export const hostGuard = ({ tailnetHost, tailscaleLogin = null }: AppDeps): MiddlewareHandler => {
  const origins = webOrigins(tailnetHost);
  return async (c, next) => {
    const hostname = new URL(c.req.url).hostname;
    const viaTailnetHost = tailnetHost !== null && hostname === tailnetHost;
    if (!viaTailnetHost && !LOCAL_HOSTNAMES.has(hostname)) return c.json<ApiError>({ error: "Forbidden host." }, 403);
    const proxied = PROXY_HEADERS.some((name) => c.req.header(name) !== undefined);
    const remote = viaTailnetHost || proxied;
    if (remote && tailscaleLogin !== null && c.req.header("tailscale-user-login") !== tailscaleLogin) {
      return c.json<ApiError>({ error: "Forbidden user." }, 403);
    }
    const origin = c.req.header("origin");
    if (c.req.method !== "GET" && origin !== undefined && !origins.includes(origin)) {
      return c.json<ApiError>({ error: "Forbidden origin." }, 403);
    }
    c.set("remote", remote);
    await next();
  };
};

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono().basePath("/api");
  app.use("*", hostGuard(deps));
  app.onError((error, c) => {
    console.error(`${c.req.method} ${c.req.path} failed: ${error.message}`);
    return c.json<ApiError>({ error: "Algo falló en Jarvis. Revisa el log." }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/whoami", (c) => c.json({ remote: isRemote(c) }));

  for (const mount of deps.routes ?? []) mount(app);
  app.all("*", (c) => c.json<ApiError>({ error: "No existe." }, 404));
  return app;
};
