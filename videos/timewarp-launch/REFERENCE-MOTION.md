# Reference motion doctrine — Timewarp launch

Distilled from frame-by-frame analysis of every frame of the six reference films the user chose:
Muse sizzle (24 fps, 82.6 s), Claude Fable 5.1 (24 fps, 27.4 s), Cursor Origin (30 fps, 30.9 s),
Lovable launch (30 fps, 80.4 s), Lovable SEO (30 fps, 51.2 s), Claude Design (24 fps, 81.5 s).
All frame counts below are converted to **our 30 fps**. W/H = frame width/height.

## 1. Sync — what lands on the music

- Only the drops are hard musical syncs (Claude Design reveals its app on the drop at 0 f offset;
  Lovable cuts its title on the drop). Our drops: **6.860** and **41.158**.
- A beat of **silence before each big reveal** is in five of six references (Muse 37.0 s, Lovable
  8.0 s / 49.2 s, Lovable SEO 45.0 s, Fable 25 s). Ours: **5.145–6.43** and **39.443–40.73** —
  hold the picture still or nearly still there.
- Cuts land **on the onset or 1 frame after, never before** (Lovable SEO). Word pops and swaps sit
  on 8th notes (our 8th = 6.43 f).
- **Every click has a sound within ±1 frame** (Claude Design, Muse). SFX follow picture, not beats.

## 2. Camera

- Default is a flat 2D camera (scale + translate) over a big UI canvas (Claude Design, Muse). Holds
  on floating UI keep a tiny drift (0.2–0.5 %/f) so nothing is dead-still; locked-off is allowed
  while an agent works (Lovable SEO).
- **Push to read:** 1→1.6–2.2× over 12–14 f, `power3.inOut` (or `expo.inOut` for ×3+), aimed at the
  next element to appear (Muse: "the push target is always the next element").
- **Pull-back reveal:** ×2–3 → 1 over 10–12 f, `expo.out` (Claude Design reveal, Lovable SEO hero).
- **Accelerate into the cut:** push `power2.in`, cut at peak speed, the next shot keeps decelerating
  4–8 f `expo.out` — reads as one move (Claude Design, Cursor smash-zoom ×1.34 in 10 f → cut ×4.6).
- Whip-continuation cuts: exit `power2/3.in` 7–12 f, cut mid-motion, next subject enters from the
  same direction `expo.out` (90 % settled by 10 f) (Cursor ×5, Lovable).

## 3. Cursor & clicks

- macOS arrow, white with dark outline; becomes a hand on buttons. Lives in canvas space — it
  scales with the camera (≈4 % H wide shots, ≈20–25 % H in button close-ups).
- Enters from the **bottom or bottom-right edge**, travels 6–10 f `power3.out`, arrives and
  **dwells 6–10 f** before clicking. Exits straight down 3–4 f `power2.in`.
- Press: target (and cursor) **scale 0.86 over 3 f** `power2.out`, hold 2–3 f, release 4–6 f
  (Cursor: no overshoot; Lovable: ×1.03–1.04 overshoot). Our brand: release with `back.out(1.6)`
  to 1.0 — a tiny friendly bounce. Cut on the release frame when the shot ends.

## 4. Type

- Quadrant Text display, ink, centered; one size tier per line (Cursor uses one size everywhere;
  Lovable two tiers 5 % H and 12–31 % H). Ours: display 4.2cqw for sentences, display-xl 5.6cqw for
  the tagline/wordmark.
- **Word build:** words pop into a **pre-centered line** (no reflow) on 8th notes; each word rises
  5 % H over 5 f `power2.out`, opacity in 3 f (Muse + Cursor).
- **Inline sticker:** neighbours part 3 f, icon/glyph scales 0→1 over 5 f `back.out(1.4)`,
  −15°→0 (Muse). Chips are 1.6–1.8× cap height (Cursor, Lovable SEO).
- **Holds:** first read ≥ 24 f; 6–8 f per word; repeats can be 4–5 f per changed word.
- **Exits:** rise 4–6 % H and fade in 3 f, reading order, `power2.in` (Muse), or whole block
  whip-up 7 f `power3.in` into a cut.
- **Slam** (tagline only): scale 1.18→1 over 10 f `expo.out` — a brand-calm version of Lovable's
  ×2.3 slam.

## 5. Agent work theater

- Typing prompts: 1 char/f (fast enough to keep beats short), slowing on the last word; caret
  6 f on / 4 f off; one soft key tick every 2–3 chars.
- Send → user bubble rises 8 % H over 6 f `power3.out` (Muse) → agent row with mascot + status pill.
- Status: a pill whose verb changes every 17–18 f with a shimmer band (Claude Design), or a step
  list where each item ticks (strike/grey 2 f → check fill 2–3 f, `back.out(3)`), 3–4 f stagger,
  **last item held ~20 f** then ticked on a downbeat.
- Data: tables fill **column by column, 2–3 f apart, all rows of a column together**; values arrive
  tinted then turn ink over 8 f; a 1.5-column shimmer band crosses every 24 f while working
  (Lovable SEO).
- Result: a file card / success pill lands with `back.out(1.6)` + soft chime; check circle draws
  in 3 f (Muse).

## 6. Approval moment (Muse + Claude Design)

1. Card rises 12–19 % H over 6–9 f `expo.out`, rows build 3–4 f apart, ending in [Deny | Allow].
2. Push to Allow 1→1.8× over 9 f `power3.out`; cursor glides in, dwells.
3. Press 0.86 → release `back.out`; SFX on the press frame.
4. Resolve: labels fade 2 f → card height −64 % in 5 f `power3.in` → thin shimmer bar 4 f →
   success state wipes in 5 f; or the card retracts upward 7 f `power2.in`.

## 7. Transitions used in this film

- **Porthole flip-book** (Fable): circular mask, content hard-cuts inside it; hold ladder
  accelerates 8 → 6 → 4 → 2 f; mask moves on twos (`steps`) for a hand-cranked feel;
  1–2 px chromatic fringe at the rim optional.
- **Collapse-to-dot → bloom on the drop** (Claude Design): the last frame of the dot is locked
  to the drop downbeat at 0 f offset.
- **Whip-continuation** between text and UI (Cursor).
- **Results streak into light** (our own "speed of light" beat, built from Lovable's light-leak
  and Muse's shrink-to-point).

## 8. Color & depth

- Light grounds throughout (Muse, Claude Design, Cursor); depth from soft tinted shadows, radial
  glows, never grain. One luminance event per act at most (we keep the whole film light — the
  "stop" frames become near-white rather than black).

## 9. End card

- Lockup builds (logo turns in, wordmark letters 2 f apart), mascots pop with 3 f stagger,
  hold ≥ 60 f while the music fades; the last 0.5–1 s may be silent (Claude Design, Lovable).

## Per-reference one-liners

- **Muse:** almost one continuous camera; no cursor (clicks = push + 0.87 squash); "AI that [icon]
  … for you" slot lines; mascot as sticky chat header; cursorless permission card.
- **Fable:** porthole mask as through-line; cut-rate ladder; one 11.8 s uncut move to end on the
  first frame; type revealed by occlusion, never tweened.
- **Cursor Origin:** words hard-pop into pre-centered lines; inline UI chip in the sentence; smash
  zoom into the real button; click squash 0.86; whip-continuation cuts; lavender gradient end card.
- **Lovable launch:** two type tiers with scale-slams; snap-shrink; 1 char/f typing; prompt pill
  morphs into the app window; match-on-shape transitions; silence holes before both drops.
- **Lovable SEO:** cuts on/after onsets; omnibox macro typing; table builds column-wise with a
  shimmer loop; "Thought for Ns" state; rim-light card lift; fly-through the logo after silence.
- **Claude Design:** prompt → status-pill verbs → collapse-to-dot → reveal on the drop; flat
  camera that accelerates into cuts; 28-frame control modules; checklist ticks with last item held;
  every click has SFX ±2 f; end lockup holds in silence.
