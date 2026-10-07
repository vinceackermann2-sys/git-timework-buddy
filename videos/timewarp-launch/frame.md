---
version: alpha
name: Timewarp — Launch Frame
description: >
  Frame-scale design system for the Timewarp launch video, taken from the live site
  (timewarpdev.com, captured 2026-10-07) and the desktop app. White and lavender-tinted
  grounds, one saturated purple (#8C14FF) for action and emphasis, ink #172033 headlines in
  Quadrant Text (400 only), Inter for every UI and chrome string, soft purple-tinted
  shadows on floating app cards, generous radii, the spirograph logo and three mascots.
  Seeded from the blue-professional preset, then rewritten by hand because the automatic
  remap put body copy in the serif and the muted grey in purple.
unit: the frame — 1920×1080 primary; 1080×1920 sibling project
principle: brand atoms are sacred · composition is free · every claim and number comes from the brief

colors:
  bg: "#FFFFFF"            # universal ground
  bg-lav: "#FAF6FF"        # lavender-50 tinted ground (hero washes, app sidebar)
  lav-100: "#F4EAFF"       # chips, user message bubble, selected rows
  lav-200: "#E9D2FF"       # the logo's pale lilac — glows, soft panels
  lav-300: "#D1A2FF"
  lav-400: "#BA71FF"
  primary: "#8C14FF"       # the one action color: buttons, send, cursor halo, highlights
  primary-ink: "#6A0FC4"   # purple text on light tints (eyebrows, links)
  text: "#172033"          # headlines + primary UI text
  text-muted: "#626B7C"    # body, secondary UI text
  text-light: "#9AA1AE"    # placeholders, timestamps
  line: "#EBE6F3"          # hairlines + card borders
  warm: "#FFF1D6"          # rare warm accent (the site's "your evening" bar) — max one use per frame
  done: "#3F8F62"          # success ticks only
  ui-grey: "#F1F0F5"       # neutral app chrome (pre-Timewarp "old way" montage)

radii:
  pill: "100px"
  window: "20px"           # app windows / browser frames
  card: "16px"             # floating cards, dialogs
  bubble: "18px"           # chat bubbles
  button: "10px"           # app buttons (site primary button)
  chip: "8px"
  circle: "50%"

shadows:
  float: "0 1px 2px rgba(23,32,51,.04), 0 24px 48px -24px rgba(106,15,196,.28)"   # the site's own shadow
  lift: "0 2px 6px rgba(23,32,51,.06), 0 40px 80px -30px rgba(106,15,196,.35)"    # hero window
  glow: "0 0 0 6px rgba(140,20,255,.10)"                                           # focus/approval ring

typography:
  # Display — Quadrant Text has ONE weight (400). Never bold it.
  display-xl: { fontFamily: "Quadrant Text", cqw: 5.6, weight: 400, lineHeight: 1.04, tracking: "-0.015em", color: "text" }
  display:    { fontFamily: "Quadrant Text", cqw: 4.2, weight: 400, lineHeight: 1.08, tracking: "-0.01em",  color: "text" }
  h2:         { fontFamily: "Quadrant Text", cqw: 3.0, weight: 400, lineHeight: 1.12, tracking: "-0.01em",  color: "text" }
  stat:       { fontFamily: "Quadrant Text", cqw: 7.5, weight: 400, lineHeight: 1.0,  tracking: "-0.02em",  color: "primary" }
  # UI + chrome — Inter (stand-in for the site's SF Pro; same neutral grotesk role)
  prompt:     { fontFamily: "Inter", cqw: 1.55, weight: 500, lineHeight: 1.35, color: "text" }
  ui:         { fontFamily: "Inter", cqw: 0.95, weight: 500, lineHeight: 1.4,  color: "text" }
  ui-small:   { fontFamily: "Inter", cqw: 0.75, weight: 500, lineHeight: 1.4,  color: "text-muted" }
  eyebrow:    { fontFamily: "Inter", cqw: 0.8,  weight: 600, tracking: "0.02em", color: "primary-ink" }
  caption:    { fontFamily: "Inter", cqw: 1.1,  weight: 500, lineHeight: 1.4,  color: "text-muted" }

components:
  app-window:
    background: "{colors.bg}"
    border: "1px solid {colors.line}"
    rounded: "{radii.window}"
    shadow: "{shadows.lift}"
    description: "The Timewarp desktop window: lavender-50 sidebar (New Task, agents Cosmo / Nova / Orbit), main pane with chat; optional built-in browser pane on the right with tab strip."
  float-card:
    background: "{colors.bg}"
    border: "1px solid {colors.line}"
    rounded: "{radii.card}"
    shadow: "{shadows.float}"
    description: "Any UI fragment lifted out of the app and floated on the ground (task step list, file card, approval dialog, sheet)."
  prompt-box:
    background: "{colors.bg}"
    border: "1px solid {colors.line}"
    rounded: "{radii.card}"
    shadow: "{shadows.float}"
    description: "Composer: typed prompt in {typography.prompt}; bottom row of chips (Browser · Files · Email) in ui-small; round {colors.primary} send button with a white up-arrow."
  user-bubble:
    background: "{colors.lav-100}"
    rounded: "{radii.bubble}"
    description: "User message, right-aligned, ink text."
  agent-row:
    description: "Mascot avatar (Cosmo / Nova / Orbit PNG, circular crop) + name in ui 600 + status pill (Working… in lav-100/primary-ink, Done in done-green tint)."
  step-list:
    description: "Checklist of agent actions; pending = hollow circle text-light, active = spinning lavender ring, done = solid {colors.primary} circle with white tick. Rows 1px {colors.line} separated."
  file-card:
    description: "Icon tile (sheet = green, doc = blue, pdf = red, all soft tints) + filename in ui 600 + 'Saved to …' ui-small."
  approval-card:
    background: "{colors.bg}"
    rounded: "{radii.card}"
    shadow: "{shadows.lift}, {shadows.glow}"
    description: "Permission moment: lock/vault icon, one-line request, detail row (card •• 4242 · amount), two buttons — Deny (white, line border) and Allow ({colors.primary}, white text)."
  primary-button:
    background: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{radii.button}"
    typography: "Inter 600"
  chip:
    background: "{colors.lav-100}"
    textColor: "{colors.primary-ink}"
    rounded: "{radii.pill}"
    typography: "{typography.eyebrow}"
  cursor:
    description: "macOS-style black arrow with white outline, ~1.6cqw tall; on click it scales to 0.88 for 3 frames and emits a {colors.lav-300} ring (0 → 3cqw, opacity .6 → 0, 10 frames)."
  logo:
    description: "Spirograph line-art mark (assets: timewarp-logo.svg / timewarp-logo-512.png) + wordmark 'Timewarp' in Inter 600 ink. The mark may rotate slowly (≤ 20°/s) — never recolor or distort it."
  atmosphere:
    description: "Soft radial lavender glow ({colors.lav-200} → transparent) behind hero objects; faint spirograph line art at 6–10% opacity as a background motif on title/end frames only."
---

# Timewarp — Launch Frame

## Overview

Light, calm and precise — the visual language of the references the user chose (Muse,
Cursor Origin, Claude Design, Lovable) carried in Timewarp's own brand. White space does
the work; one purple carries every action; the product UI floats as clean cards with
soft lavender-tinted shadows; headlines are big Quadrant Text serif in ink.

## Fonts

Paste into every frame's `<head>`/`<template>`:

```html
<style>
@font-face{font-family:'Quadrant Text';src:url("assets/fonts/captured-quadrant-text-regular.ttf") format('truetype');font-weight:400;font-style:normal}
@font-face{font-family:'Inter';src:url("assets/fonts/inter-latin-400-normal.woff2") format('woff2');font-weight:400;font-style:normal}
@font-face{font-family:'Inter';src:url("assets/fonts/inter-latin-500-normal.woff2") format('woff2');font-weight:500;font-style:normal}
@font-face{font-family:'Inter';src:url("assets/fonts/inter-latin-600-normal.woff2") format('woff2');font-weight:600;font-style:normal}
@font-face{font-family:'Inter';src:url("assets/fonts/inter-latin-700-normal.woff2") format('woff2');font-weight:700;font-style:normal}
</style>
```

Quadrant Text has only weight 400 — never set `font-weight` above 400 on it (no faux bold).

## The Frame

- 1920×1080 primary, authored in `cqw`/`cqh` against a `container-type: size` ground.
- Safe area 5cqw sides; keep load-bearing text ≥ 1.4cqw (UI text inside a floating card may be
  smaller only when the camera pushes in so it renders ≥ 1.4cqw on screen).
- 9:16 sibling: same atoms; one focal element per moment, camera follows it; display type
  re-stepped (display ≈ 7.5cqw, prompt ≈ 3.2cqw on a 1080-wide frame).

## Colors

White or lavender-50 grounds on every frame. `primary` is the only saturated color: send
buttons, Allow, progress, cursor click rings, highlight words in headlines (one word per
headline at most). Headlines stay ink. The "old way" montage may desaturate to `ui-grey`
chrome so Timewarp's arrival reads as color returning.

## Depth & Surface

Floating cards use `shadows.float`; the hero app window uses `shadows.lift`. Background glows
are lavender radial gradients, never hard shapes. No outlines heavier than 1px, no hard offset
shadows, no gradients on text.

## Composition Rules

### Do

- One focal idea per moment; let the UI card be the hero and the type be the narrator.
- Put a small inline icon or chip inside a sentence when a line names an app or object
  (e.g. "Timewarp [icon] researches for you").
- Keep mascots as small avatars inside the UI (agent rows), except the end card where
  all three may appear together.
- Use real Timewarp UI structure: sidebar with New Task + agents, chat, built-in browser,
  step list, file cards, approval dialog.

### Don't

- No invented statistics, testimonials or time savings; illustrative companies, prices and
  people are fine and stay generic (Lumen Co., Northwind, etc.).
- No dark mode frames; no neon, no glitch, no heavy motion blur.
- Don't bold Quadrant Text; don't color whole headlines purple.
- Don't show real people's emails, card numbers beyond a •• 4242 stub, or real account data.

## Approved Entities

Timewarp (logo, wordmark, icon), mascots Cosmo / Nova / Orbit, and generic app glyphs the
app itself shows (browser, files, email, sheet). Third-party brand logos (Gmail, Stripe,
Google Sheets) only as small neutral glyphs and only where the app genuinely connects to
them (Tools catalog: Gmail, Google Sheets, Stripe confirmed in store captures).
