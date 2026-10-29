---
name: ogm-light
description: Lightweight mobile player client for Open Game Master
colors:
  bg: "#14120f"
  panel: "#1e1b16"
  border: "#2a2620"
  border-strong: "#3a352c"
  text: "#e8e2d5"
  dim: "#8d8577"
  primary: "#c9a35c"
  on-primary: "#14120f"
  segment: "#262219"
  danger: "#b04a3a"
  player-bubble: "#26303f"
  dm-name: "#9fb37a"
typography:
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "1.5"
  narration:
    fontFamily: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: "1.5"
  title:
    fontFamily: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "1.2"
  compact:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.3"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "1.2"
  stat:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "1.1"
rounded:
  sm: "8px"
  tail: "4px"
  md: "12px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "14px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "14px"
  segment-inactive:
    backgroundColor: "{colors.segment}"
    textColor: "{colors.dim}"
    rounded: "{rounded.pill}"
    padding: "7px 0"
---

# Design System: ogm-light

## Overview

**Creative North Star: "Traveler's Lamp"**

A player's phone at a candlelit table: the screen is a dark room, and the
only light in it is warm and brass. The interface nearly vanishes — panels
are one step off-black, text is parchment, and a single brass accent marks
everything that matters (the active mode, the send button, the DM's name is
the one deliberate exception in moss green). Density stays low and type
stays 15–16px so it reads at arm's length in the dark.

The one flourish is reserved for the fiction: DM narration is set in a
serif, like a book being read aloud. Everything mechanical stays system UI.

**Key Characteristics:**
- One accent color, used sparingly, always meaning "active" or "go"
- Two typefaces total: system sans for mechanics, Georgia serif for narration
- Flat surfaces, 1px borders, no shadows except the sheet drawer
- Full-viewport screens (`100dvh`), no scrolling chrome

## Colors

Warm near-black with parchment text and one brass voice. Cool tones appear
only where they carry meaning: the player's own bubble (slate blue) and the
DM's name (moss green).

### Primary
- **Brass** (#c9a35c): the accent — active composer mode, send button, Play
  button, DM message authors, sheet values, campaign scroll icons. Gold
  fill means "press me / this is on."

### Neutral
- **Snuffed Lantern** (#14120f): page background; also the text color on
  brass fills.
- **Worn Tabletop** (#1e1b16): panels — bars, composer, inputs, cards, drawer.
- **Parchment** (#e8e2d5): primary text.
- **Dust** (#8d8577): secondary text, inactive segments, OOC text.
- **Seam** (#2a2620) / **Input Seam** (#3a352c): 1px borders, quietest first.

### Semantic
- **Ember Red** (#b04a3a): errors only.
- **Ink Blue** (#26303f): the player's own speech bubble — the only cool surface.
- **Moss** (#9fb37a): the DM's name label; narration body stays Parchment.

### Named Rules
**The One Lamp Rule.** Brass is ≤10% of any screen. If two elements on a
screen are gold, one of them is lying.

## Typography

**Body Font:** system-ui stack (no webfont)
**Narration Font:** Georgia, serif

**Character:** The system sans keeps the chrome invisible and native-feeling;
Georgia marks the DM's voice as the fiction, not the interface.

### Hierarchy
- **Title** (600, 17px, sans): screen bar titles (Tables, table name).
- **Display** (600, default-size, letterspaced, sans, Brass): login `h1` only.
- **Body** (400, 16px, 1.5): everything interactive and player-written.
- **Narration** (400, 15.5px, Georgia): DM message bodies.
- **Label** (700, 13px, sans): message author names; Brass for DM/players,
  Dust for OOC.

### Named Rules
**The Serif Is The DM Rule.** Georgia appears only on DM narration and the
sheet/branding flourishes. Never for buttons or controls.

## Layout

One full-viewport screen at a time (`height: 100dvh`, flex column). Structure
is always: bar → scrolling middle → composer/footer, with safe-area insets
top and bottom. The transcript is a single-column feed; messages cap at 92%
width, player messages right-aligned. Sheet drawer overlays from the right
at `min(88vw, 380px)`. No breakpoints: the design is one phone size.

## Elevation & Depth

Flat by default. Depth is tonal (panel over background) plus 1px seams; the
only shadow in the system belongs to the sheet drawer
(`-8px 0 24px rgb(0 0 0 / 0.5)`), because an overlay must separate from the
page it covers.

### Named Rules
**The Drawer Casts the Only Shadow Rule.** If a new surface casts a shadow,
it had better be an overlay.

## Shapes

Generous rounded corners on containers and inputs (12px), full pills for
chips and the "new messages" bubble (999px). Player bubbles have an
asymmetric tail: `14px 14px 4px 14px` — pointed toward the speaker. Borders
are always 1px seams, never 2px+ outlines; focus is a 1px Brass outline.

## Components

### Buttons
- **Shape:** 12px radius; pill radius for segments.
- **Primary:** Brass fill, Snuffed-Lantern text, 700 weight, 12px padding
  (Play, send).
- **Ghost:** no background; icon-only chrome buttons in the bar (back, TTS,
  sheet), 6px padding. Active state = Brass text, never a fill.
- **Segmented:** pill row of `do`/`say`/`ooc`; inactive = Dust text on
  #262219, active = Brass fill with dark text.

### Cards
- **Campaign card:** full-width, Worn Tabletop, 1px Seam border, 12px
  radius, 14px padding. Brass scroll icon prefixes the title; secondary
  line in Dust.

### Inputs / Fields
- Worn Tabletop fill, 1px Input-Seam border, 12px radius, 10×12px padding.
- Focus: 1px Brass outline. No glows.

### Transcript Messages
- **Player:** right-aligned, Ink Blue bubble, rounded-tail 14/14/4/14.
- **DM:** left-aligned, no bubble — Parchment serif text with a Brass
  "DM" label; the lack of a bubble is what makes it narration.
- **System/OOC:** centered dim text / italic Dust, no bubble.

### Sheet Drawer
- Right overlay, Worn Tabletop, 1px Seam border, single shadow in the
  system. Brass HP readout at 26px/700; key-value rows separated by seams,
  labels in Dust 600.

### Narration (settings flyout)
- **Narration pills:** Off / On demand / Auto — same segmented style as the
  composer pills, stacked vertically. One flash line appears briefly on
  change, then fades; nothing persists.
- **Play (per line):** small Brass ▶ beside the speaker's name on hearable
  replies (DM narration, GM whisper replies). While playing it shows a
  pause glyph; Off mode hides them entirely.

### Playback Bar
- Slides in above the composer only while a track plays: play/pause toggle
  plus a bare seek slider (no time readouts). Fades out at track end.

## Do's and Don'ts

### Do:
- **Do** use Brass for exactly one "active/go" element per state.
- **Do** set DM narration in Georgia and player content in system sans.
- **Do** keep iconography mixed-purpose: Heroicons (outline, 1.5 stroke) for
  UI chrome, RPG Awesome for game-flavored marks (swords, scrolls, speech).

### Don't:
- **Don't** introduce a second accent or a cool background color.
- **Don't** bubble the DM's messages — the plain serif block *is* the DM.
- **Don't** add shadows outside overlays.
