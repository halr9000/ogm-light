# ogm-light

A second chair at your own table. ogm-light is a phone-first player client
for [Open Game Master](https://opengamemaster.com): the live transcript, a
composer for talking to the DM, your character sheet, and the DM's
narration read aloud. It plays the player's half of a D&D session and
nothing else.

Open it on your phone, log in with your OGM account, and you're at the
table in seconds. Stay there for hours; the app keeps itself in sync,
recovers when your phone sleeps, and reads comfortably at whatever text
size your eyes want.

## At the table

**The transcript is the table.** The latest 30 messages load instantly,
older history is a tap away, and new turns stream in live. Everything the
DM says lands in the same stream, including whispers, which render quieter
and set apart so they read as whispered. Private stays visible, just quiet.

**Talk in four registers.** The composer handles *do*, *say*, and *ooc*,
with a slide-out control for whispering privately to the GM. Enter sends,
Shift+Enter makes a newline, and the whisper box tucks itself away after
you send.

**Your sheet, one tap.** The drawer reads the real OGM sheet: HP, ability
scores, proficiencies, spell slots, features, condition, equipment, notes.
Tap a feature, spell, or inventory item and its rulebook text unfolds right
there, exact matches only: if the rulebook has no page for it, nothing
pretends otherwise.

**Hear the DM.** Narration comes in a serif, set like prose rather than
chat, and every hearable line carries its own play button. Turn on auto
mode and the DM reads the scene to you as it unfolds. The server's own
rendered takes play first when they exist; your browser's voice covers the
rest.

**Switch characters without leaving the table.** Tap your name on a table
card and pick from the characters you own there.

**Built for the long session.** If your phone sleeps for an hour, the app
notices when it wakes and fetches fresh history instead of replaying a day
of events. Text size has four settings with a hard floor, so nothing ever
renders too small to read.

**Know where you are.** The footer names your server and shows whether
it's up. A small exit chip on each table and character row deep-links into
the full OGM app when you need the DM's half: editing characters, making
campaigns, maps.

## Screenshots

The table and the sheet, at phone size:

| Table | Sheet |
| :---: | :---: |
| <img src="docs/screenshot-main.png" width="250" alt="The table, mid-scene"> | <img src="docs/screenshot-sheet.png" width="250" alt="The character sheet"> |

## What it won't do

No campaign creation, character editing, maps, dice UI, or admin. That is
the DM's half of the app; this is the player's chair.

## Running it

On the machine that runs OGM:

```sh
node server.js
```

That serves on 0.0.0.0:3222 and proxies to 127.0.0.1:3005. Open
http://\<host\>:3222 on your phone and log in with your OGM account.

Environment variables, all optional:

| var | default | what it does |
|---|---|---|
| `OGML_PORT` | 3222 | port this server listens on |
| `OGML_HOST` | 0.0.0.0 | bind address |
| `OGML_OGM_URL` | `http://127.0.0.1:3005` | base URL of the OGM service to proxy to |

https URLs work. The L stands for "light": the `OGML_` prefix keeps these
settings away from anything OGM itself defines.

## Under the hood

One dependency-free Node file serves the static app and proxies `/api/*`
to OGM, which keeps every API call same-origin. OGM's cookie auth and its
SSE event stream then work exactly as the full app sees them, without CORS
or token plumbing. The proxy also rewrites OGM's `odm_session` cookie to
`ogml_session` on the way out and back, so a stale cookie left in some
device's jar by an old build can never shadow a live session.

`public/` holds `index.html`, `app.js` (vanilla), and `styles.css`, plus
vendored assets: RPG Awesome for the game-flavored marks (swords, scrolls,
speech), Heroicons inlined as SVG for the UI chrome, and the three
narration faces (Lora, Cormorant Garamond, IM Fell English) as woff2 under
`vendor/fonts/`. No CDN calls; the app works with the network cable pulled.

`PRODUCT.md` and `DESIGN.md` sit at the repo root for the impeccable design
tooling. The look is "Traveler's Lamp": a dark room, one brass accent, and
a serif reserved for the DM's voice.
