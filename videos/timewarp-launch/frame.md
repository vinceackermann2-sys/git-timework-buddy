---
version: 2
name: Timewarp — Launch Frame (app branding)
description: >
  Frame-scale design system for the Timewarp launch video, taken from the DESKTOP APP in this repo
  (timewarp/desktop/appearance.css, onboarding.css, auth.css, shared/appearance.cjs and the native
  captures in timewarp/reports/), not from the website. Segoe UI headings and UI, pale-lilac
  #E9D2FF as the primary fill with ink text, soft lavender-tinted grounds with a radial accent glow,
  white cards with hairline borders, the spirograph logo (purple #8C14FF → #E9D2FF + white strokes)
  and the Cosmo / Nova / Orbit mascots. v1 (website purple + Quadrant Text serif) was rejected by the
  user as "not our branding".
unit: the frame — 1920×1080 primary; 1080×1920 sibling project
principle: the app's own atoms are sacred · composition is free · every claim comes from the brief

colors:
  # grounds
  bg: "#FBFAFC"            # onboarding --journey-bg (the app's light canvas)
  shell: "#EFEBF5"         # app shell ground: Pale lilac tinted (appearance-light capture)
  panel: "#F6F7FB"         # main content panel inside the shell
  card: "#FFFFFF"
  # accent system (appearance.css)
  accent: "#E9D2FF"        # --theme-accent / --color-primary — buttons, active pills, selection
  accent-soft: "#F9F2FF"   # --color-accent (28% on white) — hovers, sidebar active row
  user-message: "#F6EDFF"  # --color-user-message (40% on white) — user chat bubble
  accent-ink: "#5E3C86"    # --timewarp-accent-ink — purple text on light (links, eyebrows)
  ring: "#8A5BB8"          # --color-ring — focus/selection outline, selected preset border
  # logo-only colors (never UI fills)
  logo-purple: "#8C14FF"
  logo-lilac: "#D1A2FF"
  # text
  ink: "#172033"           # --color-primary-foreground — button text, UI text
  heading: "#27232E"       # --journey-ink — big headings
  muted: "#817887"         # --journey-muted — subtitles on light grounds
  muted-ui: "#626B7C"      # UI secondary text
  line: "#E8E3EC"          # --journey-border — card borders
  done: "#648170"          # completed-step green (onboarding [data-complete]) / ✓ checks
  # dark variant (auth / dark theme) — only if a frame needs night
  dark-bg: "#0F121C"
  dark-ink: "#F5EFF9"

radii:
  pill: "100px"            # Begin button, progress chips, status pills
  button: "10px"           # "Start a new task", sidebar rows, "+ New Task"
  input: "8px"
  card: "16px"             # auth/org cards, dialogs
  card-lg: "18px"          # journey/import cards, tool cards
  panel: "14px"            # main panel inside the shell
  circle: "50%"

shadows:
  card: "0 1px 2px rgba(0,0,0,.05)"                                          # app cards
  float: "0 1px 2px rgba(23,32,51,.05), 0 24px 48px -28px rgba(94,60,134,.30)" # lifted UI in video
  glow: "0 0 0 6px rgba(233,210,255,.55)"                                    # approval/selection ring

typography:
  # Segoe UI is the app's typeface (Windows). Variable Display for big type, Text for UI.
  display-xl: { fontFamily: "Segoe UI Variable Display, Segoe UI", cqw: 5.2, weight: 600, lineHeight: 1.08, tracking: "-0.035em", color: "heading" }
  display:    { fontFamily: "Segoe UI Variable Display, Segoe UI", cqw: 3.9, weight: 600, lineHeight: 1.12, tracking: "-0.03em",  color: "heading" }
  h2:         { fontFamily: "Segoe UI Variable Display, Segoe UI", cqw: 2.7, weight: 600, lineHeight: 1.18, tracking: "-0.02em",  color: "heading" }
  subtitle:   { fontFamily: "Segoe UI Variable Text, Segoe UI",    cqw: 1.35, weight: 400, lineHeight: 1.5, color: "muted" }
  eyebrow:    { fontFamily: "Segoe UI Variable Text, Segoe UI",    cqw: 0.75, weight: 600, tracking: "0.18em", upper: true, color: "muted" }  # "YOUR TIME, RETURNED."
  prompt:     { fontFamily: "Segoe UI Variable Text, Segoe UI",    cqw: 1.45, weight: 400, lineHeight: 1.45, color: "ink" }
  ui:         { fontFamily: "Segoe UI Variable Text, Segoe UI",    cqw: 0.95, weight: 400, lineHeight: 1.45, color: "ink" }
  ui-strong:  { fontFamily: "Segoe UI Variable Text, Segoe UI",    cqw: 0.95, weight: 600, color: "ink" }
  wordmark:   { fontFamily: "Segoe UI Variable Display, Segoe UI", weight: 600, tracking: "-0.025em", color: "ink" }      # "Timewarp" beside the mark

components:
  shell:
    description: "Real app frame: ground {colors.shell} with a soft radial accent glow and a faint dot grid (2px dots, 20px pitch, ink at 5%); top bar with panel-toggle + back/forward icons; transparent sidebar on the ground; main content in a {colors.panel} panel, radius {radii.panel}, 1px {colors.line}."
  sidebar:
    description: "Org row (avatar + 'Personal' + chevron, search + bell icons); full-width '+ New Task' button ({colors.card}, radius 10); assistant groups: mascot avatar + assistant name (600), task rows beneath with relative time (e.g. '50m'); '+ Add assistant'."
  agent-header:
    description: "Top of a task: mascot avatar (Cosmo / Nova / Orbit) + agent name (600) + status line ('Working…' / 'Complete'), a small outline pill on the right ('Demo task' style)."
  user-message:
    background: "{colors.user-message}"
    rounded: "16px 16px 4px 16px"
    description: "User prompt bubble, right-aligned."
  activity-card:
    description: "'Browser activity' card: white, 1px {colors.line}, radius 14; muted title; rows prefixed with a ✓ in {colors.done}; muted footer ('Note saved successfully'). This is how the real app shows agent steps."
  browser-pane:
    description: "Built-in browser on the right: tab strip (globe icon + title + ×, '+' new tab), nav row (globe, ←, →, reload, mute) with the address centered in muted text, page below; separated from chat by a 1px {colors.line} rule."
  composer:
    description: "White, radius 16, 1px {colors.line}, soft shadow; placeholder in muted; round send button filled {colors.accent} with an {colors.ink} up-arrow."
  primary-button:
    background: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{radii.button} (or {radii.pill} for hero CTAs like 'Begin')"
    typography: "Segoe UI 600"
  approval-card:
    background: "{colors.card}"
    rounded: "{radii.card}"
    shadow: "{shadows.float}, {shadows.glow}"
    description: "Lock glyph in {colors.accent-ink}; request line; detail row on {colors.accent-soft}; footnote 'Stored on this device' muted; Deny (white, line border) / Allow ({colors.accent} fill, {colors.ink} text)."
  status-pill:
    description: "Pill, {colors.accent} fill with ink text for active; muted outline for idle; {colors.done} text for complete."
  orb:
    description: "The onboarding orb: a soft radial {colors.accent} glow (or a dotted sphere of lilac dots) that breathes (scale 1→1.2, opacity → .3). Use for atmosphere and transitions."
  logo:
    description: "Spirograph mark (timewarp-logo.svg) — never recolor; on light grounds as-is; on dark grounds the white strokes read. Wordmark 'Timewarp' in Segoe UI 600, −0.025em, ink."
  cursor:
    description: "Windows/mac arrow, ink with white outline, ~1.6cqw tall; press = scale 0.86 then release with back.out; soft lilac ring (0 → 2.5cqw, .5 → 0) on click."
---

# Timewarp — Launch Frame (app branding, v2)

## Overview

The video should look like the Timewarp desktop app: calm, light, lilac-tinted, rounded, with
Segoe UI everywhere. Big type is Segoe UI Variable Display Semibold with tight tracking, exactly
like the app's own hero lines ("Work at the speed of thought", "Make Timewarp yours.",
"Make room for what matters."). Pale lilac fills carry every action (send, Allow, Begin) with ink
text — never white text on purple. The only saturated purple is inside the logo.

## Fonts

Segoe UI is installed on the render machine (C:\Windows\Fonts: SegUIVar.ttf, segoeui*.ttf,
seguisb.ttf). Use the family names directly:

```css
font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; /* display */
font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;    /* UI/body */
```

## The Frame

- 1920×1080, authored in `cqw` against a `container-type: size` ground; 1080×1920 sibling.
- Safe area 5cqw; load-bearing text ≥ 1.4cqw on screen (UI inside the app may be smaller only
  while the camera is pushed in so it renders ≥ 1.4cqw).

## Grounds & depth

- Title/type frames: {bg} #FBFAFC with a radial {accent} glow at 14–25% (the onboarding look).
- App frames: the real shell — {shell} ground + faint dot grid + {panel} content panel.
- Cards are white with a 1px {line} border and a very soft shadow; lifted elements in the video
  may take {shadows.float}. No heavy outlines, no hard shadows, no gradients on text.

## Composition rules

### Do
- Rebuild the UI from the app's real structure (shell, sidebar, agent header, activity card,
  built-in browser, composer) — see timewarp/reports/browser-demo/complete.png and
  alien-assistants.png.
- Use the mascots as the agents (agent header avatars, sidebar assistants).
- Keep one focal idea per moment; push the camera in to make UI text readable.

### Don't
- No #8C14FF fills or purple buttons with white text; no serif type; no dark frames unless a beat
  is deliberately "night".
- No invented statistics, testimonials or time savings; demo companies, people and amounts are
  illustrative.
- Never recolor or distort the logo.
