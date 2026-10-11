# Timewarp 1.2.3 release record

Release work on 11 October 2026 (Europe/Stockholm). Makes replies, streaming,
browser actions and launch faster, moves more of every request onto the prompt
cache, and adds app updates with an Update button (see
[engine](engine.md#speed-and-memory)).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/12,
merged as `53bfc88`. Built in its own worktree (`perf-inference`) from
`origin/main` at `b3d68ac`; the shared folder's unfinished work is not part of
it.

- Faster sends: the AI funding balance is kept for 30 seconds instead of
  fetched from the cloud before every thread start, turn start and model
  request (a balance that would refuse usage is always read again, and the
  cloud still enforces credits); a new chat started from Home takes a Codex
  thread prepared while the user types; connected apps load when a chat
  opens; titles have their own queue; large model requests go gzipped.
- Smoother chat: streamed events apply once per frame, rows are memoized and
  only the unfinished end of a streaming reply is parsed again; highlight.js
  and the signed-in interface load after the sign-in screen (entry bundle
  880 KB → 226 KB).
- Browser tools wait for a page to settle instead of fixed pauses, capped at
  the old waits (a click that changes nothing: about 1,020 → 175 ms).
- Store: WAL with `synchronous = normal`, cached statements, an index on
  Codex threads, a background trigram index for search (same results), and
  history sync that keeps its state between launches (before, every launch
  re-sent and re-fetched every chat, since the cloud's jsonb key order made
  each one look changed).
- Updates: an Update button in the sidebar once an update is ready, and
  Settings → General shows the version with Check for updates / Restart to
  update. Mac builds update themselves from this release's files (below); the
  Microsoft Store version opens its Store page, where the Store installs it.

Measured with `npm run engine:perf` (cloud calls slowed to the 280 ms round
trip from the reference PC), 5-run medians, before → after:

| | Before | After |
| --- | --- | --- |
| Launch to the main screen | 2,022 ms | 1,089 ms |
| New chat from Home: Enter to first word | 2,117 ms | 826 ms |
| Follow-up: Enter to first word | 1,148 ms | 880 ms |
| Cloud calls before the first word | 3–4 | 1 |
| Script time while a long reply streams (release build) | 1,088 ms | about 100 ms |
| Short browser task | 4,253 ms | 2,044 ms |
| Memory after start (working set) | 472–616 MB | 436–470 MB |

Local validation: 312 engine tests, the portable tests, the full suite (only
the 11 old-pipeline tests that need untracked build artifacts fail, as
before), `npm run check`, the independence audit, `verify:cloud-source`, the
frozen Deno type-check, the email tests and `npm audit`. End-to-end: 27
scenarios (new: `browserSettle`, `updates`); in 8 full runs of the speed
changes one run's `interrupt` failed ("Codex did not answer turn/interrupt in
time"), as once in the 1.2.1 runs, and it passed in every rerun. CI passed on
`506350e` (source and website, for the push and the PR); the unsigned macOS
preview **38165398286** passed on macOS 14, 15 and Intel.

## Supabase

`timewarp-energy` was redeployed on 11 October from the release branch (the
deployed copy before it matched `b3d68ac`; a backup is in
`timewarp/reports/function-backup-before-perf`, not in git). No migration.

- One prompt cache key per account and model instead of Codex's per-thread
  key, so a new chat reads what the account's earlier chats cached; Claude
  gets a cache breakpoint for its tools and base instructions.
- Codex's approval reviews (`codex-auto-review`) run on GPT-5.6 Luna with at
  most 4,096 output tokens (they ran on Sol).
- Encrypted reasoning is forwarded so it can carry across tool steps, with
  a one-time retry without it when Azure refuses it.
- The body upload overlaps the session check; the paid-plan check runs
  alongside the credit reservation, and no model is called before it passes.
- Gzip request bodies are accepted (the 2 MB limit applies unpacked); images
  are reserved by their pixel size, not their base64 bytes; Fast-mode
  refusals are remembered; the Anthropic SDK loads with the first Claude call.

Live check after the deploy, three runs by the owner with a throwaway account
on a temporary Pro row (both deleted afterwards; about 0.1–1 credit per run):

| Check | Result |
| --- | --- |
| Health, GPT-5.6 Luna reply, gzip with and without the header | 200 |
| Free account asking for Claude or GPT-6 | 403 |
| A second chat with the same instructions (Luna) | 16,815 of 16,830 input tokens cached (the first: 0) |
| A second Claude chat (Haiku 5.5) | 29,091 of 29,111 input tokens cached |
| Approval review | answered, billed as `openai/gpt-5.6-luna` |
| GPT-6 Luna, GPT-6.1 Sol Fast, Opus 5.5 Fast | 200 |
| A tool step and the step after it (Luna, then Sol) | 200; once of three, Sol's stream ended without a reply or a usage record |

Luna at low effort returned no reasoning items, so carrying encrypted
reasoning across steps wasn't exercised by the check.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.3-x64.msix`, version
**1.2.3.0** following 1.2.2.0, **346,074,826 bytes**, SHA256
`3ffb7316d38e5aac8eed096844fca82f91cea43fdc64401f7f34e56e29690073`, built
from `506350e` (the merge's tree). The staged app passed the smoke test:
sign-in after 7.9 s, 334 MB, a conversation through the bundled Codex in
225 ms. Upload to Partner Center (Store ID `9N6WRN6GN0KR`) is done by the
owner; the Store installs it for existing users.

## macOS and website

The first signed run (**38165809561**, on `53bfc88`) stopped at packaging:
electron-builder has no `zip` section, so naming the update zip there failed
its configuration check ("unknown property 'zip'"); the unsigned previews
don't build the zip. PR
https://github.com/vinceackermann2-sys/git-timework-buddy/pull/13 (merged as
`0f0fcb7`) names it in the `mac` section instead and adds a test that checks
the signed and draft configurations against electron-builder's schema.

The signed run **38166395833** on `0f0fcb7` passed the engine tests on
macOS, signing, notarization, packaging and smoke tests on both architectures.

| | Apple Silicon | Intel |
| --- | --- | --- |
| DMG | `Timewarp-1.2.3-arm64.dmg`, 270,357,518 bytes | `Timewarp-1.2.3-x64.dmg`, 286,834,077 bytes |
| DMG SHA256 | `e5622fd0df1a60384e78c7beda7b41e3f22cfe54ccbe3e6f26df516f23ba73bc` | `d7ee72df7d5983bd5ca88b49e94caa90eea96cdabbda947b6d7a93c89d5f2aa0` |
| Notarization | `1091ce14-91b6-4eb5-96bb-7589e36aa58a`, Accepted | `fb22fb4b-0e5a-47be-8360-c97bb7800ec8`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Update zip | `Timewarp-1.2.3-arm64-mac.zip`, 269,208,101 bytes | `Timewarp-1.2.3-x64-mac.zip`, 285,941,679 bytes |
| Zip SHA256 | `76353848fcba669d5fc3de47e556113b299a92888adcf9384badffdbd3431efa` | `78dceaed8642868bcfa1d9866babf2ec5d75f9e9ebe1707322497d646f79d640` |

The downloaded CI artifacts match the hashes CI recorded, and the SHA-512 in
each `latest-mac-<arch>.yml` matches its zip. `merge-mac-update-info.cjs`
joined them into `latest-mac.yml`. Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.3,
with the two DMGs, the two update zips, `latest-mac.yml` and
`SHA256SUMS.txt`. The update feed answers through GitHub's redirect:
`releases/latest/download/latest-mac.yml` gives version 1.2.3, and both zips
and both DMGs answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.3
DMGs; Windows continues to use the Microsoft Store listing.

Mac users install 1.2.3 from the DMG once; earlier versions have no updater.
From 1.2.3 on, a Mac downloads a newer release in the background and shows
the Update button. Every later Mac release must publish its zips and
`latest-mac.yml` as a full (not draft or pre-) release, since the feed
follows GitHub's latest release.

## Remaining limits

An update from 1.2.3 to a later version hasn't happened yet on a real Mac,
and the signed DMGs haven't been run on a physical Mac. The update zips hold
the same signed app as the DMGs; only the DMGs are stapled, and Squirrel.Mac
checks the update's signature itself. The live model evaluation
(`engine:eval`) wasn't run against the new cloud: creating its production
account from the agent was blocked, and the owner ran the shorter live check
instead.
