# ogm-light

Minimal mobile-first player client for Open Game Master (OGM). Built for
marathon solo play on a phone: transcript, actions, sheet, and DM narration
read aloud. No build step, no framework, one dependency-free Node server.

## Run (on the OGM host)

```sh
OGML_PORT=3222 node server.js
```

Serves the app on :3222 and proxies `/api/*` same-origin to the OGM server on
:3005. Same-origin proxying means OGM's cookie auth and the SSE event stream
(`/api/campaigns/[id]/events`) work exactly as the full web app sees them —
no CORS, no bearer-token plumbing.

Open `http://<host>:3222` on your phone. Log in with your OGM account.

## What it does

- **Transcript** — latest 30 messages, older history loads on demand; live
  updates over SSE with automatic reconnect and Last-Event-ID replay.
- **Actions** — `do` / `say` / `ooc` composer; Enter sends, Shift+Enter newlines.
- **Sheet drawer** — HP/class/level/AC at a glance.
- **TTS toggle** — browser `speechSynthesis` reads DM narration aloud; no
  server TTS dependency.
- **Sleep recovery** — returning to the app after the phone slept refetches a
  fresh message page instead of replaying hours of SSE.

## What it deliberately does not do

No campaign creation, no character editing, no maps, no dice UI, no admin.
The seat is the player seat; everything else stays in the full app.

## Files

```
server.js        static files + streaming /api proxy (node, no deps)
public/
  index.html     shell
  app.js         client logic (vanilla)
  styles.css     dark mobile-first theme
```
