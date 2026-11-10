import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import webpush from "web-push";

import type { OtherCustodians } from "../../shared/wallet.js";
import { runAgent } from "./agent/runner.js";
import { createApp, hostGuard } from "./app.js";
import { openDb } from "./db.js";
import { readKeyValues } from "./files.js";
import {
  STATEMENTS_DIR,
  DATA_DIR,
  GITHUB_OWNERS,
  MY_FACTORIES,
  PEPPER_URL,
  PEPPER_WEB_URL,
  PORT,
  TAILNET_HOST,
  TAILSCALE_LOGIN,
  assertSubscriptionAuth,
  readGoogleConfig,
  readElevenLabsKey,
  readIbkrConfig,
  NOTES_DIR,
} from "./env.js";
import { statementRoutes } from "./statements/routes.js";
import { execScript } from "./statements/run.js";
import { createAccountStore } from "./google/accounts.js";
import { agendaRoutes, createAgendaSource } from "./google/agendaSource.js";
import { createGoogleAuth } from "./google/oauth.js";
import { googleRoutes } from "./google/routes.js";
import { mailRoutes } from "./mail/routes.js";
import { createMailSource } from "./mail/source.js";
import { createMailSweep } from "./mail/sweep.js";
import { createCleanup } from "./mac/cleanup.js";
import { createMacCollector } from "./mac/collect.js";
import { createMacHistory } from "./mac/history.js";
import { createMole } from "./mac/mole.js";
import { serialQueue } from "./mac/queue.js";
import { createMacSource, macRoutes } from "./mac/routes.js";
import { createClaudeSessions } from "./mac/sessions.js";
import { paymentRoutes } from "./payments/routes.js";
import { createPaymentStore } from "./payments/store.js";
import { notesRoutes } from "./notes/routes.js";
import { createNotifier } from "./push/notifier.js";
import { pushRoutes } from "./push/routes.js";
import { pushTick } from "./push/tick.js";
import { loadOrCreateVapid } from "./push/vapid.js";
import { commandRunner, runCommand } from "./run.js";
import { taskRoutes } from "./tasks/routes.js";
import { createTaskSource } from "./tasks/source.js";
import { createBriefingWriter } from "./today/briefing.js";
import { todayRoutes } from "./today/routes.js";
import { createBriefingSeenStore } from "./today/seen.js";
import { createVoice } from "./voice/elevenlabs.js";
import { newsRoutes } from "./news/routes.js";
import { researchRoutes } from "./research/routes.js";
import { createResearchSource } from "./research/source.js";
import { createResearchStore } from "./research/store.js";
import { createNewsSource } from "./news/source.js";
import { readOtherCustodians, syncCartera } from "./wallet/cartera.js";
import { createLevelStore } from "./wallet/levels.js";
import { yahooSymbol } from "./wallet/prices.js";
import { walletRoutes } from "./wallet/routes.js";
import { createWalletSource } from "./wallet/source.js";
import { createWalletStore } from "./wallet/store.js";
import { createPrLister } from "./work/prs.js";
import { createWorkSource, workRoutes } from "./work/routes.js";

const PUSH_TICK_MS = 10 * 60_000;

assertSubscriptionAuth();
// The database holds full account numbers: the directory is mine only.
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
chmodSync(DATA_DIR, 0o700);

const db = openDb(join(DATA_DIR, "jarvis.db"));
const macHistory = createMacHistory(db);
const mac = createMacSource(createMacCollector(runCommand), { onCollect: macHistory.record });
const payments = createPaymentStore(db);
const work = createWorkSource({
  fetchFn: fetch,
  pepperUrl: PEPPER_URL,
  pepperWebUrl: PEPPER_WEB_URL,
  myFactories: MY_FACTORIES,
  prs: createPrLister(runCommand, undefined, undefined, GITHUB_OWNERS),
});

const googleConfig = readGoogleConfig();
const googleAccounts = createAccountStore(db);
const googleAuth = googleConfig
  ? createGoogleAuth({ config: googleConfig, redirectUri: `http://127.0.0.1:${PORT}/api/google/callback`, fetchFn: fetch })
  : null;
const tasks = createTaskSource({ db, auth: googleAuth, accounts: googleAccounts, fetchFn: fetch });
const agenda = createAgendaSource({ auth: googleAuth, accounts: googleAccounts, fetchFn: fetch, tasks });
const mail = createMailSource({
  auth: googleAuth,
  accounts: googleAccounts,
  fetchFn: fetch,
  automatedSendersFile: join(DATA_DIR, "automated-senders"),
});
const mailSweep = createMailSweep({ auth: googleAuth, accounts: googleAccounts, fetchFn: fetch, onChange: mail.invalidate });

const elevenLabsKey = readElevenLabsKey();
const elevenLabsVoice = elevenLabsKey ? createVoice({ apiKey: elevenLabsKey }) : null;
if (!elevenLabsVoice) console.log("voice: off (JARVIS_ELEVENLABS_API_KEY is not set)");

const CARTERA_FILE = join(NOTES_DIR, "Inversiones", "cartera.md");
const walletStore = createWalletStore(db);
const SYMBOLS_FILE = join(DATA_DIR, "wallet-symbols");
let others: { mtimeMs: number | null; value: OtherCustodians | null } = { mtimeMs: null, value: null };
const walletLevels = createLevelStore(db);
const wallet = createWalletSource({
  store: walletStore,
  levels: walletLevels,
  config: readIbkrConfig(),
  fetchFn: fetch,
  symbolsFile: SYMBOLS_FILE,
  onSnapshot: (snapshot) => {
    const result = syncCartera({ file: CARTERA_FILE, backupsDir: join(DATA_DIR, "backups"), snapshot, now: new Date() });
    walletStore.setMeta("carteraError", "error" in result ? result.error : null);
    if (!("error" in result)) walletStore.setMeta("carteraAt", new Date().toISOString());
  },
  readOthers: () => {
    // Read on every Today: parse the file again only when it changed (a sync or an edit by hand).
    const mtimeMs = existsSync(CARTERA_FILE) ? statSync(CARTERA_FILE).mtimeMs : null;
    if (mtimeMs !== others.mtimeMs) {
      others = { mtimeMs, value: mtimeMs === null ? null : readOtherCustodians(readFileSync(CARTERA_FILE, "utf8")) };
    }
    return others.value;
  },
});

const news = createNewsSource({
  feedsFile: join(DATA_DIR, "news-feeds"),
  fetchFn: fetch,
  // Stocks only: a UCITS ETF's headlines are empty or noise. The same Yahoo symbol the prices use.
  tickers: () => {
    const overrides = existsSync(SYMBOLS_FILE) ? readKeyValues(readFileSync(SYMBOLS_FILE, "utf8")) : new Map<string, string>();
    return (walletStore.latestSnapshot()?.positions ?? []).filter((p) => p.subCategory !== "ETF").map((p) => yahooSymbol(p, overrides));
  },
});

const research = createResearchSource({
  store: createResearchStore(db),
  runAgent,
  investmentsDir: join(NOTES_DIR, "Inversiones"),
});

const vapid = loadOrCreateVapid(DATA_DIR);
// The push service needs a contact for the sender; nothing is ever sent to this address.
const vapidDetails = { subject: "mailto:jarvis@localhost.invalid", ...vapid };
const notifier = createNotifier(db, async (subscription, payload) => {
  await webpush.sendNotification(subscription, payload, { vapidDetails, TTL: 6 * 60 * 60 });
});

// The cleanup card and Mole delete overlapping caches: one queue for both.
const macCleanups = serialQueue();

const access = { tailnetHost: TAILNET_HOST, tailscaleLogin: TAILSCALE_LOGIN };

const api = createApp({
  ...access,
  routes: [
    macRoutes(
      mac,
      runCommand,
      macHistory,
      createClaudeSessions({
        sessionsDir: join(homedir(), ".claude", "sessions"),
        tabConfigDir: join(homedir(), ".warp", "tab_configs"),
        planFile: join(DATA_DIR, "claude-sessions.json"),
        run: runCommand,
      }),
      // Pruning Docker can take minutes.
      createCleanup({ run: commandRunner(5 * 60_000), home: homedir(), uid: process.getuid?.() ?? -1, serial: macCleanups }),
      // Mole's deep cleanup walks the whole home folder; NO_COLOR keeps its output plain text.
      createMole({
        run: commandRunner(15 * 60_000, { NO_COLOR: "1" }),
        home: homedir(),
        trashDir: join(homedir(), ".Trash"),
        serial: macCleanups,
      }),
    ),
    paymentRoutes(payments),
    workRoutes(work),
    todayRoutes({ mac, payments, work, agenda, mail, wallet, seen: createBriefingSeenStore(db) }, createBriefingWriter(runAgent), elevenLabsVoice),
    pushRoutes(notifier, vapid.publicKey),
    googleRoutes({ auth: googleAuth, accounts: googleAccounts, onChange: () => {
        agenda.invalidate();
        mail.invalidate();
        tasks.invalidate();
      },
    }),
    agendaRoutes(agenda),
    taskRoutes(tasks),
    mailRoutes(mail, mailSweep),
    walletRoutes(wallet, walletLevels),
    newsRoutes(news),
    researchRoutes(research),
    notesRoutes({ notesDir: NOTES_DIR, backupsDir: join(DATA_DIR, "backups", "notes"), trashDir: join(homedir(), ".Trash") }),
    statementRoutes({ statementsDir: STATEMENTS_DIR, backupsDir: join(DATA_DIR, "backups", "statements"), exec: execScript }, runCommand, join(DATA_DIR, "spending-categories")),
  ],
});

const root = new Hono();
root.route("/", api);
// The built UI goes through the same Host check as the API.
root.use("*", hostGuard(access));

// In production one process serves the built UI too; in dev, Vite serves it and proxies /api here.
if (process.env.NODE_ENV === "production") {
  const webDir = fileURLToPath(new URL("../../dist/web", import.meta.url));
  const indexHtml = readFileSync(`${webDir}/index.html`, "utf8");
  // Hashed assets never change; anything else (index.html above all) is revalidated, or the browser keeps loading
  // the previous build after a reinstall.
  root.use(
    "*",
    serveStatic({
      root: webDir,
      onFound: (path, c) => {
        c.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }),
  );
  root.get("*", (c) => {
    c.header("cache-control", "no-cache");
    return c.html(indexHtml);
  });
}

const tick = async () => {
  // The wallet goes first: the push tick needs today's prices and the news, today's holdings.
  await wallet.tick(new Date());
  await news.tick(new Date());
  await tasks.tick();
  await pushTick({ payments, mac, work, mail, agenda, wallet, notifier }).catch((error: unknown) =>
    console.error(`push tick failed: ${error instanceof Error ? error.message : String(error)}`),
  );
};
setInterval(() => void tick(), PUSH_TICK_MS);
setTimeout(() => void tick(), 30_000);
// The first inbox read fetches every message's metadata and outlasts Today's per-source timeout; doing it at boot
// means the first Today after a restart already has mail.
void mail.read().catch(() => undefined);
void agenda.read().catch(() => undefined);
void wallet.read().catch(() => undefined);

serve({ fetch: root.fetch, port: PORT, hostname: "127.0.0.1" }, ({ port }) => {
  console.log(`Jarvis listening on http://127.0.0.1:${port}`);
});
