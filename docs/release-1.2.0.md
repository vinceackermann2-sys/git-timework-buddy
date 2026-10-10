# Timewarp 1.2.0 release record

Release work on 10 October 2026 (Europe/Stockholm). First release on
Timewarp's own desktop engine (`timewarp/app`, see [engine](engine.md)).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/4,
merged as `ebc0d0a` after all checks passed. It contains the engine's parity
work, level AI credits, the website's Intel Mac notice and version 1.2.0 for
the Store package and the Mac DMGs. The launch video project (`videos/`) is
left out on purpose: about 150 MB of music, sound effects and photos in a
public repository. Published Git history is preserved.

CI on the PR's first push failed one real-Codex test ("Stop while a chat's
first reply is starting") on the Windows runner. The cause was an existing
harness bug: Codex reporting "starting" for the first request ended the reply
being set up, so a Stop pressed meanwhile was lost. Fixed in `9dd45ec` with a
unit test; all checks then passed.

Local validation: 497 tests in `timewarp`, 23 of 23 engine end-to-end
scenarios, the independence audit, `npm run check`, 478 portable tests,
`verify:cloud-source`, 18 email tests, the Deno check of every cloud entry
point, `npm audit` (0 vulnerabilities), and the website's type check, tests,
build and `verify:website-build`.

## Supabase

Production project: `mrqoeywofslgnquvzhuf`.

Applied only `20261010120000_level_ai_credits.sql` with `supabase db query
--linked`, then recorded it with `supabase migration repair --status applied
20261010120000`; local and remote IDs now match. `db push` was not used: older
local migrations were applied earlier under different IDs and must not be
replayed. Before: snapshot of the constraint and both functions in
`timewarp/reports/release-1.2.0-db-before.json` (the subscriptions table was
empty). After: the constraint allows 0, 210–1750 (new) and 50–1000 (legacy)
monthly additions; allowances are Pro 280, Max 700, Ultra 1400; EXECUTE on
both functions is limited to `postgres` and `service_role`.

Redeployed with the Supabase CLI (`functions deploy --use-api`):
`timewarp-energy` **26**, `stripe-billing` **50**, `stripe-webhook` **46**. All
are ACTIVE with `verify_jwt = false` kept from `config.toml`. All 19 deployed
files downloaded from production match `main`. The health route answers;
anonymous `/account` and `stripe-billing` calls get 401 and an unsigned webhook
400. Previous sources are kept in `timewarp/reports/release-1.2.0-functions-before`.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.0-x64.msix`, version
**1.2.0.0** following 1.1.25.0, **346,056,986 bytes**, SHA256
`1a7b62d907f40b7c2303f68d7e4d1ca99fd291b4ae51d44660d935eba6eb5cfd`, built from
`9dd45ec` (identical to the merge's tree). Existing Store identity, publisher,
application ID and profile (`Timewarp Energy`) are kept; the build checks the
package's name, publisher and version. The staged app passed the smoke test:
sign-in after 6.3 s, 356 MB, a conversation through the bundled Codex in 222 ms.
Upload to Partner Center (Store ID `9N6WRN6GN0KR`) is done by the owner.

## macOS and website

Signed packaging runs from `main` (protected `desktop-release` environment).
The first signed run, **38065564828** on `ebc0d0a`, stopped at the engine
tests on both runners: one test gave a download a Windows path, which macOS
doesn't split into a base name (fixed in PR #5, `519a056`; the app code was
unchanged). An unsigned preview run on the fix branch, **38065871815**, passed
on macOS 14, 15 and Intel. The signed run **38066189541** on `4e3dfca` passed
the engine tests, signing, packaging and smoke tests on both architectures.

| | Apple Silicon | Intel |
| --- | --- | --- |
| Artifact | `Timewarp-1.2.0-arm64.dmg` | `Timewarp-1.2.0-x64.dmg` |
| Size | 270,318,804 bytes | 286,824,572 bytes |
| SHA256 | `320eb0d04829d070e7f669c0f3e88edd83304a6e468489b5b84146dabc9ffa55` | `05d55c3e5cff2eb2757cccbde518cfe92b3ebbbf67e9b1f64244a0103fb77afd` |
| Notarization | `00c39b8d-5536-4f4a-a3a8-dfb561dadeae`, Accepted | `b2e4b383-a8c3-4fae-91fc-35ca9e149221`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Minimum macOS | 12.0 (Electron Framework) | 12.0 (Electron Framework) |

The downloaded CI artifacts match the hashes CI recorded, and GitHub's asset
digests match them. Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.0,
with `SHA256SUMS.txt`. Both links answer 200 with the expected sizes.

The website offers both builds: `download-config.js` has `mac` (Apple Silicon)
and `macIntel`. A Mac whose GPU names its chip (Apple M…, or Intel, AMD,
NVIDIA graphics), or Safari with ASTC textures (Apple Silicon only), gets its
build directly; otherwise the dialog offers both. Windows continues to use the
Microsoft Store listing. Mac updates remain manual.

## Remaining limits

The new base prompt, turn context and background memory writer haven't been
through the live model evaluation yet (`engine:eval`). Clean-machine Windows
install, installed Store upgrade from 1.1.25, a real Mac run and an upgrade
from a profile with memory, automations and vault items are not established
by these checks. The Windows command sandbox is not set up in onboarding (see
[engine](engine.md#before-shipping)).
