# Jarvis

My personal assistant panel: the first thing I open each day. It summarizes the day, lets me clear the personal
side (payments, mail, wallet, notes, bank statements) and links out to Pepper and the build factories for work. The
code is public; a running Jarvis is not a product: never deploy it, expose it publicly, or share an instance. The
Claude subscription auth it relies on is for personal use: whoever runs it uses their own.

The design and the phase plans live in `.superpowers/` (not versioned).

## Layout

| Path | What |
|---|---|
| `server/src/` | Hono server on `127.0.0.1:4417`. Collects every source and owns SQLite |
| `web/src/` | Vite + React + Tailwind UI on `127.0.0.1:4418` in dev; `/api` is proxied to the server |
| `shared/` | Types shared by server and web (the API contract) |
| `~/.jarvis/` | Local data (SQLite, VAPID keys, logs). Override with `JARVIS_DATA_DIR` |

## Commands

```bash
npm run dev        # server + web
npm run typecheck
npm test
npm run build && npm start   # one process on :4417, what launchd runs
```

## Rules

- Code, names, comments, logs and commits in English. UI copy in neutral Latin American Spanish, never voseo.
- Local only: the server binds `127.0.0.1`. The only other Host it answers is `JARVIS_TAILNET_HOST`
  (`tailscale serve`), and requests from it are "remote" (`isRemote`): no full account numbers, no destructive
  Mac actions.
- Pepper is read server-side (`GET /api/board`, no Origin) and never started or exposed by Jarvis.
- Every source is collected on its own; one failing source never breaks the Today view.
- Agents (Claude Agent SDK) are read-only: `permissionMode: "dontAsk"`, `settingSources: []`. The server refuses
  to start with `ANTHROPIC_API_KEY` set.
- Light at rest: no aggressive polling.
