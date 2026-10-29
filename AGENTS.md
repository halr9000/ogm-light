# ogm-light agent contract

ogm-light is a thin player client for Open Game Master (OGM). It consumes
OGM's HTTP and SSE API through its own same-origin proxy and renders what
comes back. That is the whole job. Keep it that way:

- **Never touch OGM from here.** No config changes, no env vars, no admin
  settings, no database writes, no upstream code edits — from any script,
  server, or agent working in this repo. Upstream tuning (TTS provider,
  models, ports, feature flags) belongs to OGM's operator. If something
  upstream needs changing, that is a separate task in the OGM repo, not a
  side effect of work here.
- **Never assume upstream internals.** Play whatever media the API hands
  over; render whatever fields the API returns. Do not reach for provider
  names, env keys, or file paths that belong to OGM. If upstream changes
  its shape, adapt this client — never the other way around.
- **Same-origin only.** All API access goes through `server.js`'s `/api`
  proxy with OGM's cookie auth. No tokens, no CORS workarounds, no direct
  cross-origin calls from the browser.
- **No build step, no framework, no npm packages.** Vanilla files under
  `public/`, one Node file for the proxy.
