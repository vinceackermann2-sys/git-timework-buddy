# Timewarp 1.2.2 release record

Release work on 11 October 2026 (Europe/Stockholm). Adds Claude and GPT-6
models to the paid plans, shows credit balances as credits everywhere and
removes the task panel above the chat (see
[model picker](model-picker.md) and
[engine](engine.md#comparison-with-the-previous-app)).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/9,
merged as `b3d68ac`. It was built in its own worktree from `main`, from two
finished but uncommitted changes: the paid models (worktree `claude-models`)
and the credits and task panel fix (shared folder). The shared folder's
launch-video work in `videos/` is not part of the release.

- Paid plans (Pro, Max, Ultra): Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and
  Haiku 5.5, and GPT-6 Astra, GPT-6.1 Sol (the default) and GPT-6 Luna. Claude
  runs through the cloud's translation from Codex's Responses API to Anthropic
  Messages, in the same Codex harness and sandbox. Opus Fast travels as
  `anthropic/claude-opus-5-5-fast`; GPT-6 Fast as `service_tier: priority`.
- Free keeps GPT-5.6 Sol and Luna; the connected ChatGPT catalog is unchanged.
  The cloud returns 403 to Free accounts that ask for a paid model.
- The picker rates intelligence, speed and low cost as percentages of the best
  Timewarp model, from Artificial Analysis data in
  `shared/model-benchmarks.json`.
- The sidebar's usage card shows the credit count instead of dollars; only
  plan and credit pack prices are in USD.
- The task panel above the chat is gone; workers open from "Waiting for …".

Two CI fixes came with it: the Deno lockfile CI type-checks with
(`supabase/functions/auth-email-hook/deno.lock`) gained
`npm:@anthropic-ai/sdk@0.128.0`, and the engine audit accepts JSON data in
`shared/`.

Local validation: 526 tests, of which the 11 old-pipeline tests that need
untracked build artifacts fail in a fresh worktree, as before (CI doesn't run
them); 271 engine tests, the portable tests, `npm run check`, the independence
audit, `verify:cloud-source`, the frozen Deno type-check, the email tests and
`npm audit` (0 vulnerabilities). CI passed on `d9c2cb3` (source and website,
for the push and the PR). The unsigned preview **38134595477** passed on
macOS 14, 15 and Intel.

## Supabase

No migration: `migration list --linked` shows `20261010120000` as the latest
and only the known local-only IDs, and the release adds no SQL.

Before the deploy, the live `timewarp-energy`, `auth-email-hook`,
`stripe-billing` and `stripe-webhook` were downloaded to
`timewarp/reports/function-backup-before-1.2.2`. The live `timewarp-energy`
matched `main` before the release in all 11 files; the other three matched the
repository (`auth-email-hook` apart from line endings, its `deno.lock` serves
CI only), so only `timewarp-energy` was deployed, from `d9c2cb3`.

`ANTHROPIC_API_KEY` was set by the owner on 11 October. The GPT-6 deployment
secrets (`GPT_ASTRA_MODEL`, `GPT_SOL_6_1_MODEL`, `GPT_LUNA_6_MODEL`) are not
set, so the default deployment names apply.

Live check after the deploy, with a throwaway account on a temporary Pro row
(both deleted afterwards; 0.03 credits of included usage):

| Request | Result |
| --- | --- |
| Free account, Claude Haiku 5.5 | 403, "part of the paid plans" |
| Claude Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 5.5 | 200, replied (1.5–2.2 s) |
| GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna | 200, replied (2.2–4.0 s) |
| GPT-6.1 Sol with priority, Opus 5.5 Fast | 200, replied |
| GPT-5.6 Luna (1.2.1's name) | 200, replied |

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.2-x64.msix`, version
**1.2.2.0** following 1.2.1.0, **346,072,059 bytes**, SHA256
`1924755c7ced6a00ec620b0db93a0b175476f503366e0ecc7965fbadd5428170`, built
from `d9c2cb3` (the merge's tree). The staged app passed the smoke test:
sign-in after 5.7 s, 345 MB, a conversation through the bundled Codex in
214 ms. Upload to Partner Center (Store ID `9N6WRN6GN0KR`) is done by the
owner.

## macOS and website

The signed run **38139595252** on `b3d68ac` passed the engine tests on
macOS, signing, notarization, packaging and smoke tests on both architectures.

| | Apple Silicon | Intel |
| --- | --- | --- |
| Artifact | `Timewarp-1.2.2-arm64.dmg` | `Timewarp-1.2.2-x64.dmg` |
| Size | 270,324,538 bytes | 286,850,936 bytes |
| SHA256 | `e76a5f25f6d0396af9ae53d1e15a58ae404d10437d9341214f2781122cddca7c` | `2c70548e4b256d79834fc318b20d37c685471a9dcd0a5168786c58d031f3643b` |
| Notarization | `a00e9e63-4c71-4e0d-b736-4896a9900cb0`, Accepted | `66756834-776a-4cc4-a5c6-46436866ae00`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Minimum macOS | 12.0 (Electron Framework) | 12.0 (Electron Framework) |

The downloaded CI artifacts match the hashes CI recorded, and GitHub's asset
digests match them. Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.2,
with `SHA256SUMS.txt`. Both links answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.2
DMGs; Windows continues to use the Microsoft Store listing. Mac updates
remain manual.

## Remaining limits

The paid models have had one short reply each in production, not a full live
evaluation with tools (`engine:eval`). The signed DMGs have not been run on a
physical Mac.
