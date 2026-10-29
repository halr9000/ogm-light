# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A solo player running self-hosted Open Game Master (OGM) campaigns on
his home server (the OGM host). Primary situation: marathon solo D&D 5e play sessions
from a phone browser, on the home LAN. He is also the operator who deploys
and maintains the app.

## Product Purpose

ogm-light is a lightweight, mobile-first player client for OGM. The full OGM
web app is heavy on a phone; this client gives the player seat only what a
player needs mid-session: the live transcript, taking actions, glancing at
the character sheet, and hearing DM narration read aloud. Success is: open
the phone, be at the table in seconds, stay in sync for hours.

## Positioning

The player seat, nothing else — served by a single dependency-free Node
proxy that keeps `/api/*` same-origin so OGM's cookie auth and SSE event
stream work exactly as the full app sees them. A neighboring client could
copy the screens; it could not copy the no-build, no-CORS, one-file-proxy
delivery that makes the client trivially self-hostable beside OGM.

## Operating Context

- Runs on the OGM host (the OGM host) beside the OGM container; reaches it via
  localhost HTTP. Deployed at `http://ogmhost.example:3222` and via the Caddy
  HTTPS portal route `https://ogmhost.example`.
- Used on phones in a browser during long play sessions; the phone sleeps
  and wakes mid-session, and the app must recover cleanly.
- Auth reuses OGM accounts; the proxy rewrites OGM's `odm_session` cookie to
  `ogml_session` to isolate it from any stale cookies in device jars.

## Capabilities and Constraints

- Transcript: latest 30 messages, on-demand older history, live SSE with
  reconnect and Last-Event-ID replay.
- Composer: `do` / `say` / `ooc` actions; Enter sends.
- Sheet drawer: HP/class/level/AC at a glance.
- TTS: browser `speechSynthesis` reads DM narration; no server TTS.
- Sleep recovery: visibility-change refetches a fresh page instead of
  replaying hours of SSE.
- Deliberately excluded: campaign creation, character editing, maps, dice
  UI, admin. The seat is the player seat.
- No build step, no frontend framework, no npm dependencies.

## Brand Commitments

- Name: ogm-light (the L is for light).
- Favicon: simplified OGM d20 mark — gold hexagon + inverted triangle +
  cream serif "20" on the dark arcane background.
- Palette kinship with OGM's dark arcane-night look: near-black warm
  background, parchment text, single gold accent.

## Evidence on Hand

- Working deployment at `:3222`, verified end-to-end (login, tables,
  transcript, composer, sheet) from real browser and user's phone.
- User screenshots (2026-10-29) confirm login, table list, and composer
  render correctly on a phone.
- Full git history in `the local checkout`, pushed to
  github.com/halr9000/ogm-light.

## Product Principles

- Phone first: every screen must work one-handed, in the dark, mid-combat.
- The seat is the player seat: refuse feature creep toward the DM seat.
- Boring tech: vanilla JS, one Node file, no build step — deployable in
  one command next to any OGM instance.
- Never break the same-origin auth/SSE contract for cosmetic wins.

## Accessibility & Inclusion

- Large touch targets and 100dvh screens suited to one-handed phone use.
- High-contrast dark theme; no formal WCAG audit performed yet.
