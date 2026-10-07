---
format: 1920x1080
fps: 30
duration: 56.5s
message: "Anything you can do on a computer, Timewarp does for you — safely."
arc: Hook (time spent working) → Product intro → Promise → Demo 1 (leads) → Demo 2 (invoices) → Demo 3 (coffee + approval) → Trust (vault) → Tagline → CTA
audience: independent professionals and owner-led service businesses who already use AI chat
mode: collaborative
music: none
music_edit: >
  Host track assets/music/do-it-for-you.mp3 (≈140 BPM; beat 0.4287 s, bar 1.7149 s, 8th 0.2144 s).
  Three bar-aligned segments joined with 15 ms crossfades:
  A = track 43.082–63.661 (bars 25–36: 4-bar breakdown, 2-beat silence at 48.23–49.08, drop at 49.942) → video 0.000–20.579
  B = track 70.521–84.240 (bars 41–48: groove) → video 20.579–34.298
  C = track 97.959–119.6 (bars 57–68: 4-bar dip, 2-beat silence at 103.10–103.96, drop 2 at 104.819) → video 34.298–56.5, fade-out 54.88–56.5
key_hits: >
  0.000 breakdown in · 5.145 music stops (silence) · 6.431 pickup · 6.860 DROP 1 · 8.575 full drop ·
  20.579 groove (splice) · 34.298 dip (splice) · 39.443 music stops (silence) · 40.729 pickup ·
  41.158 DROP 2 · 48.018 bar 65 · 51.448 bar 67 · 54.877 fade begins
references: >
  Motion language synthesized from frame-by-frame analysis of Muse, Claude Fable, Cursor Origin,
  Lovable launch, Lovable SEO, Claude Design (see REFERENCE-MOTION.md).
---

# Timewarp — Launch (16:9)

All times are absolute video seconds. Beat-grid positions are named so the build can snap to them.
The 9:16 sibling reuses this plan; `layout_9x16` notes say how each frame re-lays out.

## Decisions

- **Spine:** one lilac point carries the film — the porthole collapses to it (F1), it blooms into
  the logo on drop 1 (F2), the same purple marks every action the agents take (send, Allow), and
  the three results streak back into light before the tagline (F8).
- **Format:** 1920×1080 (sibling 1080×1920), 56.5 s, 30 fps, no voiceover, music + soft SFX, no captions.
- **Brand:** `frame.md` — from timewarpdev.com (captured 2026-10-07) and the repo: white / lavender-50
  grounds, purple #8C14FF for action only, ink #172033, Quadrant Text (400) display, Inter UI,
  float shadow tinted #6A0FC4, radii 20/16/10.
- **Truthfulness:** the app UI is rebuilt from Timewarp's own design source (the site's app window +
  native store captures); companies, people, amounts and the café are illustrative. Vault facts are
  verified in code; "Agents ask before they pay" confirmed by the user.
- **Bans:** no dark frames, no neon/glitch, no invented stats or time savings, no bolded Quadrant
  Text, no slideshow beats (every frame moves its focal within 0.2 s), no screensaver motion.
- **Held frames:** the stop at 5.145–6.43 (silence, a single dot) and the approval hold at
  39.443–40.73 (silence, camera on Allow).

## Changes from v1 (user, 2026-10-07)

- End card: remove Cosmo / Nova / Orbit and the "Free with your ChatGPT plan" line.
- Vault line "Agents ask before they pay." confirmed true — keep.

## Frame 1 — The work

- type: hook
- duration: 6.86s
- transition_in: cut
- poster: 4.2
- status: built
- blueprint: kinetic-type-beats (+ Fable-style porthole flip-book)
- scene: "For 45 years, a third of your waking hours go to work." builds left while a round porthole flips through a blur of computer chores, accelerating, then everything stops dead.
- asset_candidates: brand/timewarp-logo.svg (faint bezel motif only)
- music_section: A, bars 25–28 (breakdown), silence 5.145–6.43
- sfx_plan: soft key ticks on porthole cuts (−26 dB), a mouse click pair at 2.2, a tape-stop "thup" at 5.145 as the image freezes, room-tone silence after
- layout_9x16: headline top third (3 stacked lines, display ≈ 7.5cqw); porthole below, ⌀ 78% W, centered at 62% H

**On screen.** White ground. Left half: Quadrant Text headline building line by line —
"For 45 years," (0.00) / "a third of your waking hours" (bar 26, 1.715) / "go to work." (bar 27, 3.430);
words pop on 8th notes, line pre-centered (no reflow). Right half: a circular porthole ⌀ 66% H at
(66% W, 50% H) with a thin lavender bezel and 60 faint clock ticks around it — time as the frame.

Inside the porthole, a flip-book of desaturated (ui-grey) computer chores rebuilt as simple UI:
a cursor double-clicking, a doc with a caret typing, a spreadsheet with cells flicking, an inbox
count rising, browser tabs multiplying, a calendar week filling solid, "Proposal_v4_FINAL.docx",
copy → paste → copy, a clock reading 23:48. Hold ladder accelerates like Fable: 8f holds
(bar 25) → 6f (bar 26) → 4f (bar 27) → 2f (first half of bar 28). The bezel's tick ring spins faster
with the cuts.

**The stop (5.145).** Music cuts to silence: the flip-book freezes, the headline rises out (6f),
the porthole iris-closes to a single lilac dot ⌀ 24px at frame center over 10f (power3.in).
Near-white silence; the dot breathes once at the 6.431 pickup.

- handoff_out: lilac dot (#D1A2FF) ⌀ 24px at x=960 y=540, scale 1→1.15 pulse at 6.431, opacity 1, static.

## Frame 2 — Introducing Timewarp

- type: product_intro
- duration: 3.43s
- transition_in: cut
- poster: 9.4
- status: built
- blueprint: logo-assemble-lockup
- scene: On the drop the dot blooms into the spirograph logo with rings of light; "Introducing" then "Timewarp" lands on the full drop.
- asset_candidates: brand/timewarp-logo.svg
- music_section: A, bars 29–30 (drop)
- sfx_plan: soft airy bloom/whoosh at 6.860, gentle shimmer at 8.575
- layout_9x16: logo ⌀ 34% W at 42% H; "Introducing" above; wordmark below the logo (stacked lockup)
- handoff_in: lilac dot ⌀ 24px at x=960 y=540, opacity 1.

**On screen.** 6.860: the dot blooms into the spirograph logo — scale 0→1 with a −120°→0° turn
over 18f (expo.out) while two thin lavender rings expand outward and fade and a soft lilac radial
glow fills the ground. 7.289 (+1 beat): "Introducing" (Inter 600, primary-ink, 1.6cqw) rises above.
8.575 (full drop): the logo slides left and the wordmark "Timewarp" (Quadrant Text, display-xl)
lands to its right (scale 1.15→1, 10f expo.out) — a horizontal lockup centered. Logo keeps a slow
rotation (≤15°/s); whole lockup pushes 1.00→1.04. Exit at 10.08: lockup scales to 0.9 and fades (6f).

## Frame 3 — The promise

- type: product_intro
- duration: 3.43s
- transition_in: cut
- poster: 13.2
- status: built
- blueprint: kinetic-type-beats
- scene: "Anything you can do on a computer, Timewarp does for you." — words pop on the beat, "for you" in purple.
- asset_candidates: brand/timewarp-logo.svg (inline glyph)
- music_section: A, bars 31–32
- sfx_plan: soft tick on each word (−28 dB)
- layout_9x16: four centered lines: "Anything you can do" / "on a computer," / "Timewarp" / "does for you."

**On screen.** White ground with the spirograph at 7% opacity, huge, slowly turning behind.
Line 1 (Quadrant Text display, centered): "Anything you can do on a computer," — words pop on 8th notes
from 10.290. Line 2 at 12.005 (bar 32): "[logo glyph] Timewarp does for you." — the glyph pops
inline (scale 0→1, back.out 1.6, 5f), "for you" in primary purple. Hold to 13.35, then the block
rises out fast (power3.in, 7f) — the app window arrives from below on the cut (whip continuation).

- handoff_out: text block exiting upward at ~120 px/frame, opacity 1 → cut.

## Frame 4 — "Find business leads for me"

- type: feature_showcase
- duration: 8.574s
- transition_in: cut
- poster: 19.6
- status: built
- blueprint: prompt-type-submit-generate → agent-progress-theater
- scene: In the Timewarp app, the prompt types; Cosmo searches the web in the built-in browser, reads café sites, and fills leads.xlsx; done.
- asset_candidates: brand/cosmo-512.png, brand/nova.png, brand/orbit.png, brand/timewarp-logo.svg, ../screenshots/scroll-000.png (UI reference)
- music_section: A bars 33–36 (drop) → B bars 41–42 (groove) — splice at 20.579
- sfx_plan: window whoosh-in 13.72, key ticks while typing, click on send, soft pops on steps, 8th-note page-flick ticks in the browser, data-fill shimmer, done chime at 20.579
- layout_9x16: window shown as a single column (chat pane full width); the browser/sheet pane slides up OVER the chat as a card (92% W) instead of sitting beside it
- handoff_in: app-entering-from-below — window starts at y +18% H, scale 0.9.

**On screen.** Lavender-50 ground with a soft glow. The Timewarp window (1500×860, site design:
lavender sidebar with + New Task and Agents Cosmo / Nova / Orbit; main pane greeting
"Time to carpe the diem"; composer with Browser · Files · Email chips and the round purple send)
rises and scales 0.9→1 (18f power3.out). Camera pushes ×1.6 onto the composer (14f power3.inOut);
the prompt types at 1 char/frame: **"Find business leads for me — independent cafés in Austin."**
Cursor enters from bottom-right, click squash on send (0.86, on a beat). Camera pulls back to the
full window (7f expo.out). Chat: user bubble (lav-100) → Cosmo row with "Working…" pill → step list
checking off on beats: Searching the web ✓ · Reading 38 café sites ✓ · Building your sheet ✓.
Right pane = built-in browser: a search page, then café sites flicking on 8th notes (illustrative
names), then the pane becomes **leads.xlsx** filling column by column (Business · Website · Contact ·
Why it fits) with rows landing every 2f and a lilac shimmer band. 20.579 (groove): file card
"leads.xlsx — 20 leads · Saved to Files" lands in chat with a green "Done" pill; hold, slight push.

- handoff_out: full window 1500×860 centered (x=960 y=540), scale 1, opacity 1, static.

## Frame 5 — "Three clients haven't paid. Chase them."

- type: feature_showcase
- duration: 10.29s
- transition_in: cut
- poster: 28.6
- status: built
- blueprint: agent-progress-theater
- scene: New task with Nova: it checks Stripe, finds three overdue invoices, drafts friendly reminders in Gmail; you hit Send all.
- asset_candidates: brand/nova-512.png, brand/nova.png, brand/cosmo.png, brand/orbit.png, brand/app-capture-tools.png (Stripe + Gmail glyph reference)
- music_section: B bars 42–48 (groove)
- sfx_plan: click on + New Task, key ticks, send click, pop per invoice row, paper-slide per draft card, click on Send all, three soft whooshes, done chime
- layout_9x16: invoices and drafts appear as stacked full-width cards under the chat; camera follows vertically
- handoff_in: full window 1500×860 centered, scale 1, opacity 1.

**On screen.** Same window. Cursor clicks + New Task; Nova becomes the active agent. Push onto the
composer; types **"Three clients haven't paid. Chase them."** Send on bar 43 (24.009). Nova "Working…":
Checking Stripe ✓ — right pane shows an invoices table (neutral, Stripe glyph small): #1042
Northwind Studio $1,800 · #1047 Harbor & Pine $1,200 · #1051 Fieldwork Co. $950, each with a warm
"Overdue" pill popping 2f apart. Drafting reminders ✓ — three email draft cards fan out (Gmail glyph,
subject "Quick reminder: invoice #1042", first line of a polite note). Nova: "3 friendly reminders
are ready. Send them?" with [Review] [Send all]. Camera pushes to Send all (×1.6, 9f power3.out),
click on bar 47 (30.869); the cards slide away one by one (3f stagger) → "Sent ✓ 3 reminders".
(All names and amounts are illustrative.)

- handoff_out: full window centered, scale 1, opacity 1, static.

## Frame 6 — "Get me an oat latte"

- type: feature_showcase
- duration: 8.574s
- transition_in: cut
- poster: 38.6
- status: built
- blueprint: cursor-ui-demo (cursorless approval push, Muse)
- scene: Orbit orders a coffee in the built-in browser; checkout asks to use a card from the Vault; the camera pushes onto Allow as the music stops.
- asset_candidates: brand/orbit-512.png, brand/orbit.png, brand/timewarp-logo.svg
- music_section: B bar 48 → C bars 57–60 (dip) + silence 39.443–40.30
- sfx_plan: click on + New Task, key ticks, send click, add-to-cart pop, card slide-up for the approval dialog, low soft riser into 39.443, then silence; one hover tick
- layout_9x16: approval card fills 88% W at center; push is ×1.4
- handoff_in: full window centered, scale 1, opacity 1.

**On screen.** New task, Orbit active. Prompt: **"Get me an oat latte from Bean There."** Send on
bar 57 (34.298) as the music thins. Orbit "Working…" — browser pane: Bean There Coffee menu
(illustrative café) → "Oat latte $5.40" → Add to cart → Checkout (pickup in 10 min). 37.728 (bar 59):
an **approval card** slides up over the window: lock icon · "Orbit wants to pay with a card from
your Vault" · VISA •• 4242 · Bean There Coffee · $5.40 · footnote "Stored encrypted on this device" ·
[Deny] [Allow]. 39.443 the music stops: everything holds, the camera pushes onto Allow
(1→1.8, 9f power3.out), the cursor glides in and hovers. 40.729 (pickup): press-down squash 0.86.

- handoff_out: Allow button at ×1.8 camera, centered at x=960 y=600, pressed (scale 0.86), opacity 1.

## Frame 7 — Safe by design

- type: benefit_highlight
- duration: 5.145s
- transition_in: cut
- poster: 44.8
- status: built
- blueprint: titlecard-reveal (with UI)
- scene: On drop 2 the press releases — "Paid ✓ Oat latte, ready 9:40" — then the card tucks into the Vault and the line "Your cards and logins stay in an encrypted vault on your computer." lands.
- asset_candidates: brand/orbit.png, brand/timewarp-logo.svg
- music_section: C bars 61–63 (drop 2)
- sfx_plan: click release + bright soft chime at 41.158, lock "clack" (soft) when the card enters the vault at ~42.4, gentle swell
- layout_9x16: vault panel top half; line below in 3 lines
- handoff_in: Allow button pressed at ×1.8 centered x=960 y=600.

**On screen.** 41.158: release (scale 0.86→1.04→1, back.out) + a lilac ring burst; the dialog
turns into a success state "Paid ✓ — Oat latte, ready at 9:40". Camera pulls back (×1.8→1, 8f
expo.out). 42.4: the card shrinks into a **Vault** panel (lock icon, "On this device · Encrypted"
badge) listing VISA •• 4242 · Google Ads login · Stripe login, each with a small lock. 42.873
(bar 62): line (Quadrant Text h2) builds to its right: **"Your cards and logins stay in an
encrypted vault on your computer."** 44.588 (bar 63): sub-line (Inter, muted): **"Agents ask before
they pay."** (confirmed true by the user 2026-10-07). Exit 45.95: whole frame rises out (power3.in, 7f).

## Frame 8 — Work at the speed of light

- type: branding
- duration: 5.145s
- transition_in: cut
- poster: 50.0
- status: built
- blueprint: kinetic-type-beats
- scene: The three results flash in as chips, streak into light, and "Work at the speed of light." lands.
- asset_candidates: brand/timewarp-logo.svg
- music_section: C bars 64–66
- sfx_plan: three soft pops on 46.303 / 46.732 / 47.161, a light "zip" whoosh at 47.59, airy impact at 48.018
- layout_9x16: chips stacked vertically; tagline in 3 lines ("Work at / the speed / of light.")

**On screen.** White ground. Three result chips pop in a row on beats: "leads.xlsx ✓" ·
"3 reminders sent ✓" · "Oat latte ordered ✓" (float-card style, mascot avatar each). 47.59: they
stretch horizontally into thin lavender light streaks and zip into the center. 48.018 (bar 65):
**"Work at the speed of light."** (Quadrant Text display-xl) lands with scale 1.18→1 (10f expo.out);
a soft light sweep crosses the word "light" (lav-200 → white). Hold with a slow push 1.00→1.03.

## Frame 9 — End card

- type: cta
- duration: 5.052s
- transition_in: cut
- poster: 54.0
- status: built
- blueprint: logo-assemble-lockup
- scene: Logo + Timewarp wordmark, "Available for Mac & Windows", timewarpdev.com. (No mascots, no pricing line — user request.)
- asset_candidates: brand/timewarp-logo.svg
- music_section: C bars 67–68 + 1.6 s fade-out
- sfx_plan: soft shimmer as the wordmark lands; music fades 54.877→56.5
- layout_9x16: stacked: logo, wordmark, line, URL pill

**On screen.** Lavender-50 ground with a soft lilac glow and the spirograph at 6% opacity, huge,
turning slowly behind. 51.448 (bar 67): logo + "Timewarp" lockup centered (logo turns in −90°→0°,
wordmark letters rise 2f apart). 52.3: line (Inter 500, muted): **"Available for Mac & Windows"**;
52.7: a purple pill **"timewarpdev.com"** rises in. Hold to the end while the music fades.
