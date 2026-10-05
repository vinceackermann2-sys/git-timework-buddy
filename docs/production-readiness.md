# Production readiness review

Reviewed 5 October 2026. Verdict: **hold a public production release**.
The existing local build has useful functional and security coverage, but the
release and acceptance gaps below remain.

## Release blockers

1. **No signed installer or working update feed.** The executable is unsigned
   (`reports/build.json`, `signed: false`). `desktop/runtime.cjs` disables
   automatic update checks. Build signing, install/uninstall, clean-machine
   startup, signed upgrades and rollback need acceptance before distribution.

2. **A clone cannot reproduce the desktop build.** `scripts/build.cjs` reads a
   privately supplied Energy archive/runtime and locates `rcedit.exe` through
   an absolute external `config.json.brandSource` path. Several visual verifiers
   load dependencies from that external checkout. Pin and provision the upstream
   input with integrity checks and local build tooling. Source CI is now present,
   but it does not substitute for a native packaging job.

3. **Billing acceptance stops before a paid transaction.** Existing local
   `billing-cloud.json` and `checkout-payment.json` reports cover real checkout
   amounts, unpaid denial, ownership and unsigned webhook rejection. The README
   explicitly records that no payment was submitted. Complete an approved Stripe
   test-mode payment through the signed webhook, and exercise duplicate delivery,
   subscription renewal, cancellation, failed payment and applicable refund
   handling with ledger assertions. No real payment was made during this review.

4. **Owner authentication/inference acceptance remains incomplete.** The
   recorded `chatgpt-desktop.json` has `liveInference.completed: false` and
   `lastCompletedAt: null` because the connected account reached its usage limit.
   Unit tests verify the provider flow and no paid fallback, but do not prove a
   completed live Codex turn. Record a successful turn with an eligible account
   and available allowance. The Google routing checks stop at Google's sign-in
   page; record full browser approval, desktop callback, session refresh and
   fresh-device recovery too.

## Operational and repository gaps

- The database migrations extend an existing platform. They reference billing,
  organization and reservation objects whose definitions are outside this repo.
  The Composio function and branded Google website implementation are external.
  A new-environment deployment needs the matching service baseline.
- Requests with missing usage or provider timeouts become `uncertain` AI
  reservations. This source records that state, but contains no reconciliation
  worker. Verify the external service's resolution process and user-visible
  recovery, including a failed settlement RPC, before taking production traffic.
- Add tested backup/restore, deployment rollback, service health/error alerts and
  an incident runbook. Their operation was not verified in this review.
- The zero-finding npm audit below covers this integration's npm dependency
  graph. It does not audit every module embedded in the inherited Electron
  archive or the Deno dependency graph. Audit the shipped runtime separately.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run check` | Pass |
| `npm test` | 86 tests pass, no skips |
| `npm run test:email` | 18 tests pass |
| Deno check, editable and staged cloud plus all five other edge entry points, using email JSX config | Pass |
| `npm run verify:contracts` | Pass against the existing extracted native build |
| `npm run verify:build` | Pass against the existing packaged executable/archive |
| `npm audit --json` | Zero reported vulnerabilities in this npm graph |
| Export of exactly the staged source, followed by a fresh `npm ci --ignore-scripts` and all CI commands | 72 portable tests and 18 email tests pass; syntax, cloud-copy, type and audit checks pass |

The existing app was running, so this review did not overwrite it or perform a
fresh native build. Historic local acceptance reports were inspected as evidence;
their live cloud scenarios were not rerun. Generated reports are ignored because
they can contain account identifiers, session material or fixture credentials.

## Repository preparation

The private timework repository contains the editable desktop/cloud integration,
shared modules, assets, mascot sources, migrations, tests and upstream patch
tools. Git ignores runtime binaries, dependencies, device state, backups,
Supabase CLI temporary credentials and all generated acceptance reports.
GitHub Actions runs portable Node tests, email tests, syntax/type checks, npm
audit and a check that deployable cloud copies match the editable modules.

The full native suite remains available as `npm test`. Its three upstream bundle
suites are deliberately outside source-only CI and must pass for a release build.
