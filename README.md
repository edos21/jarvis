# Jarvis

My personal assistant panel: today's briefing, payments due, the Mac's health and what Pepper and the factories need
from me. Local only, reachable from my phone through Tailscale. See `CLAUDE.md` for the rules the code follows.

## Run it

```bash
nvm use                 # Node 22
npm install
npm run dev             # http://127.0.0.1:4418 (server on :4417)
```

The briefing paragraph needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`); without it the cards still show.
The server refuses to start with `ANTHROPIC_API_KEY` set. Pepper is read from `http://127.0.0.1:4317` when it is
running; open PRs come from `gh`, logged in as me.

Optional: `JARVIS_DATA_DIR` (default `~/.jarvis`), `JARVIS_PORT` (4417), `JARVIS_PEPPER_URL`, `JARVIS_PEPPER_WEB_URL`,
`JARVIS_TAILNET_HOST`, `JARVIS_GITHUB_OWNERS` (the owners whose PRs count as work, comma separated; empty means all)
and `JARVIS_MY_FACTORIES` (the factories that are yours, comma separated).

Jarvis is a personal tool: it runs its agents on your own Claude subscription and reads only your own accounts. Run
your own copy; never host one for someone else.

After changing `server/src/schema.ts`, run `npm run db:generate`; migrations apply on server start.

## Keep it running

```bash
./ops/install.sh        # builds, then loads the LaunchAgent: starts at login, restarts if it dies
./ops/uninstall.sh      # stops it and removes the LaunchAgent; ~/.jarvis stays
```

`install.sh` uses the `node` on your PATH (run `nvm use` first) and records it for launchd; run it again after
changing Node versions. It creates `~/.jarvis/env` (0600) the first time: put `CLAUDE_CODE_OAUTH_TOKEN`,
`JARVIS_TAILNET_HOST` and `JARVIS_TAILSCALE_LOGIN` (your Tailscale login, so only your devices get in) there, then run `launchctl kickstart -k gui/$(id -u)/com.edos.jarvis`. Logs go to `~/.jarvis/logs/jarvis.log`.

On the Mac, open `http://127.0.0.1:4417` in Safari and use File → Add to Dock: Jarvis gets its own window and icon.

## On the phone (Android)

1. Install Tailscale on the Mac and on the phone, same account.
2. On the Mac: `tailscale serve --bg --https=443 http://127.0.0.1:4417`. It prints the address
   (`https://<mac>.<tailnet>.ts.net`); put that host in `~/.jarvis/env` as `JARVIS_TAILNET_HOST` and restart Jarvis.
3. On the phone, open that address in Chrome, then menu → Install app.
4. In Jarvis, Hoy → Avisos → Activar avisos.

It works from any network while Tailscale is on in the phone and the Mac is awake. From the phone, account numbers
show masked and Mac actions are off.

## Google (personal Gmail and Calendar)

Jarvis reads my personal Google account through my own OAuth client. Once:

1. At console.cloud.google.com, with the personal account: create a project and enable the Gmail API, the Google
   Calendar API and the Google Tasks API.
2. OAuth consent screen: External; add the scopes `openid`, `email`, `calendar.readonly`, `gmail.modify` and `tasks`;
   fill in Branding (name, support email, home page, privacy policy URL) and **Publish app**. In "Testing" Google
   expires the refresh token every 7 days.
3. Credentials → Create OAuth client ID → **Desktop app**.
4. Put `JARVIS_GOOGLE_CLIENT_ID` and `JARVIS_GOOGLE_CLIENT_SECRET` in `~/.jarvis/env` and restart Jarvis
   (`launchctl kickstart -k gui/$(id -u)/com.edos.jarvis`).
5. In Jarvis, Correo → Conectar Gmail personal, and accept Google's "unverified app" screen: it is your own app.

Jarvis only reads metadata (sender, subject, list headers), never a message body. It archives, marks read and moves
notifications and newsletters to the trash (Gmail keeps them 30 days); it never sends mail or deletes it for good.
Mail is grouped by rules: newsletters (list headers), invoices (subject), notifications (noreply senders, known tool
domains and Gmail's Updates/Social/Forums tabs; Promotions counts as newsletter) and people. "No es una persona" on a
person's mail adds its sender to `~/.jarvis/automated-senders` (the domain, or the full address on gmail.com and other
free providers); the file can be edited by hand too, one entry per line. A person's mail from the last two hours sends
a notification (09:00 to 21:00).

Google Tasks due today or overdue show in the agenda and in Today, with "Marcar hecha" (the one write Jarvis does to
Tasks). An account connected before Tasks was added asks to reconnect; its events keep showing meanwhile.

## Wallet (IBKR)

Positions come once a day from the IBKR Flex Web Service; prices 3 times a day (11:00, 14:30, 18:30, weekdays) from
Yahoo Finance. Once:

1. In the IBKR portal: Performance & Reports → Flex Queries → new Activity Flex Query "Jarvis positions", with the
   sections **Open Positions** (Summary) and **Cash Report**, each with **all fields selected** (Jarvis needs
   `listingExchange`, `subCategory` and `fxRateToBase`), format XML, period "Last Business Day". One account per query.
2. Flex Web Service Configuration → generate a token (longest validity).
3. Put `JARVIS_IBKR_FLEX_TOKEN` and `JARVIS_IBKR_FLEX_QUERY_ID` in `~/.jarvis/env` and restart Jarvis.

After each new Flex statement Jarvis rewrites **only** the IBKR table of section 1 of
`notes/Inversiones/cartera.md` and its `> Datos del broker al **…**` line:
- struck-through rows (`~~XYZ~~`) are kept;
- a ticker gone from IBKR is struck with a note;
- everything else in the file is left as it is.

It saves a backup in `~/.jarvis/backups/` first (the last 30 are kept), and refuses to write if the file's structure
changed. The other custodians stay manual; Jarvis reads their total from "Resumen por Custodio".

**Alerts:** a position that moves 5% or more in a day, or crosses a level set under "Niveles" (a stop, a target),
becomes a card in Today and a push.

**Yahoo symbols:** a listing that maps wrong can be fixed in `~/.jarvis/wallet-symbols`, one `TICKER=YAHOO` per line
(e.g. `VWCE=VWCE.DE`).

## News

RSS sources by topic (tech, markets, uruguay, venezuela) live in `~/.jarvis/news-feeds`, one `topic | name | url` per
line. The file is created with defaults the first time and read again on each refresh (every 2 h, 07:00 to 22:00).
Held stocks also get their own Yahoo headlines.

## Research ("Investigar" and the satellite pick)

"Investigar" (on a position, a move or a headline) and "Satellite pick del mes" run a Claude agent in the background.
- **Tools:** read-only only: web search, web fetch, and reading `notes/Inversiones`.
- **Investigar:** Sonnet, up to US$ 1.
- **Satellite pick:** Opus, up to US$ 5. It uses the `## PROMPT` section of `Satellite Prompt Mensual.md` as written.
- **Results:** shown under Análisis. "Guardar en notas" (Mac only) writes them to `notes/Inversiones/investigaciones/`
  or `satellite-picks-<mes>-<año>.md`, and never overwrites.

## Payments

Add them in Pagos: name, day of the month it is due, the link to pay it and, if you transfer, the destination account
to copy. They show in Hoy five days ahead, push a reminder (09:00 to 21:00) on the due day and while overdue, and
leave once marked paid for that month.

## Mac: deep cleanup (Mole)

"Limpieza a fondo" on the Mac page uses [Mole](https://github.com/tw93/mole). Install it once with `brew install mole`;
the page shows the version it found. Only from the Mac, never from the phone.

- **Uso del disco:** `mo analyze --json`, folder by folder. It only reads. A folder opens only if the last view listed
  it.
- **Limpieza profunda:** always a dry run first (`mo clean --dry-run`, about two minutes): sections, what each row
  would free, the biggest paths. "Limpiar" acts only on that preview, within 15 minutes, once. `mo clean` without a
  terminal deletes without asking, so this confirmation is the only one. Rows marked ⊙ (Docker, Hugging Face,
  `mo purge`) are only pointed at, never deleted. System caches stay out: they need sudo.
- **The Trash:** Mole empties it by default. If a preview would empty it, Jarvis refuses to clean. Protect it once:
  `mo clean --whitelist`, mark Trash, save. A saved whitelist replaces Mole's optional defaults, so review the list
  before saving. Without Full Disk Access Mole skips the Trash on its own.
- **Instaladores viejos:** Jarvis's own scan, with Mole's rules (`mo installer` is always interactive): `.dmg`,
  `.pkg`, `.mpkg`, `.iso`, `.xip`, two levels deep in Downloads, Desktop, Documents, `~/Library/Downloads` and
  `/Users/Shared`. They go to the Trash; a file that changed after the search stays where it is.

`mo optimize` and `mo uninstall` are not wired in.
