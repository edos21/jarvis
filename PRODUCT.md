# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Runs as a Safari "Add to Dock" window on the Mac and as an installed Chrome PWA on Android, over Tailscale.

## Users

One user: the owner, a software engineer who built it for themselves. There is no other audience: the code is public,
but each running Jarvis is one person's own, never deployed or exposed.

Two reading situations:

- **First open of the day.** On the Mac, usually. The owner wants to understand the day in seconds.
- **Glances during the day.** Several times a day, on the Mac and on the phone, for a few seconds each. The owner wants
  to know whether anything needs them now.

## Product Purpose

Jarvis is the first thing the owner opens each day. It summarizes the day in natural language, shows only what asks for
an action, ordered by urgency, and lets the owner clear the personal side (payments, mail, wallet, notes, bank
statements) without jumping between ten apps. Work is summarized and linked out to Pepper (a local ticket board) and
the build factories, never duplicated.

Success: the day is understood in seconds, and personal chores get dispatched from one place.

Failure, even if everything works:

- it turns into another dashboard of columns that has to be walked through;
- it exposes mail, account numbers or the portfolio to the internet;
- it duplicates Pepper, so the owner maintains two boards;
- Today is slow or fails whole because one source is down.

## Positioning

A written account of the owner's own day, composed from their own machine: Gmail, Calendar, IBKR, the Mac itself,
Pepper and the factories. It reads and summarizes; it does not pay, trade, reply to mail or manage tickets.

## Operating Context

- **What leads depends on the moment.** On the first open of the day the briefing leads. On later glances, what needs
  action now leads.
- **Phone companion.** Today, pending tasks, the wallet percentage, news with "Investigar", and the work summary. Full
  account numbers, destructive Mac actions, Notes and Statements stay on the Mac.
- **Adjacent tools.** Pepper (ticket board, local), the build factories (cloud), Gmail for replying, an expense-splitting
  app for uploading the CSV by hand.
- **Light at rest.** The Mac has little memory and runs several agent sessions. No aggressive polling.

## Capabilities and Constraints

- **Today:** greeting, briefing (with optional voice), action cards by urgency, side column with agenda, wallet, work
  and Mac.
- **Tareas, Correo, Cartera, Noticias, Análisis, Notas, Cuentas, Pagos, Mac:** Google Tasks, mail triage in bulk,
  read-only portfolio with alerts and research, RSS news, agent reports in Markdown, a Markdown notes reader, bank
  statement import to an editable table, recurring payment reminders, and Mac health with previewed cleanup.
- **Command bar** on ⌘K, Mac only.
- **Degrades per source:** each source fails alone and Today names what it could not read.
- **Copy:** UI in neutral Latin American Spanish, never voseo.
- **Local only:** the server binds `127.0.0.1`; requests through the tailnet host are "remote".
- **Agents are read-only.**

Non-goals: not a mail client, not a payment or trading tool, not a Pepper replacement, not a Slack replacement.

## Brand Commitments

- Name: Jarvis, the personal assistant. Pepper analyzes tickets, the factories build them.
- "It is where the owner works every day": a cared-for interface is a requirement, not a detail.
- The written briefing is the product's signature; Today reads as an account of the day, not as a grid of widgets.

## Evidence on Hand

Real data only, from the owner's own sources. Design and phase plans live in `.superpowers/` (not versioned). There are
no testimonials, users or metrics, and none should be invented.

## Product Principles

1. **Legible at a glance beats dense.** When density and the reading requirements below conflict, reading wins; show
   less or scroll.
2. **Only what asks for action.** Today earns each item it shows. Everything else lives one step away.
3. **Say it, then let it be done.** Natural language first, the action next to it.
4. **One failure never hides the rest.** Partial truth, clearly labeled, always beats a blank page.
5. **Private by construction.** Every design that surfaces data respects the remote and local split.

## Accessibility & Inclusion

The owner reads with corrected vision on both the Mac and the phone, and small, thin or low-contrast text costs them.
These are hard requirements, in both themes and at both widths:

- body text 15px or larger; metadata never under 13px; no thin or light weights;
- prose at about 70 characters per line, generous line height and air between blocks;
- no text dimmed with opacity; contrast of at least 4.5:1;
- in dark mode, off-white on dark gray, never pure white on black (halos);
- meaning never by color alone: an icon and a word.
