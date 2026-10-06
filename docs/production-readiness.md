# Production readiness review

Reviewed 6 October 2026. Verdict: **hold the public production release**.
An unsigned Windows preview installer and an MSIX update are built and verified
locally. Partner Center shows the existing TimeWarp Dev submission 8 as live;
the corrected artwork is saved in submission 9 as a draft. An Apple Silicon Mac
preview DMG now passes native startup and package checks on GitHub Actions.
Mac Developer ID signing/notarization, deployment and live acceptance remain
outstanding for the remaining release changes.

## Backend clarification

The configured application backend is **Timewarp's Supabase project**, with the
Timewarp Google website bridge. Energy's original desktop distribution is a
build input. Names such as `timewarp-energy`, `surface: energy`, database/bucket
identifiers and the existing device profile are compatibility names, not an
Energy-hosted server dependency.

The staged package check now rejects Energy server URLs in executable app code.
It caught and fixed two startup-recovery URLs missed by the earlier repack.
The inherited update file is excluded from release inputs and the inherited
updater cannot override Timewarp's feed or install policy.

## Fixes completed locally

- Subscription/customer lookup failures stop checkout. Stable customer retry
  keys, a durable checkout attempt, exact immutable Stripe parameters and scope
  locks prevent concurrent/retried requests from creating duplicate subscriptions.
  Lost responses and legacy open sessions/subscriptions are checked across all
  pages. Twenty-one regression scenarios use the actual migration in PostgreSQL
  via PGlite with mocked Stripe, including lookup/save failures, concurrency,
  cancellation, ownership, role isolation and retries after Stripe key expiry.
- The native build no longer depends on an absolute path into another desktop
  project. Local tools are pinned, and SHA256/size checks verify the pristine
  archive, executable and 1,056 supplied runtime files. A bundle export and manual
  Windows artifact workflow provision those inputs without publishing anything.
- Isolated staging builds an NSIS preview installer with a separate install
  name, app identity and device profile. The working app is preserved. Release
  staging uses official Electron 43.7.7 instead of the vendor's 43.2.0, with
  hardened fuses and Windows ASAR integrity. Shipped YAML/HTTP dependencies were
  patched; the installed npm inventory is now separately audited.
- Preview installation verifies every staged file after extraction. Installer
  handling preserves deeply nested files, removes them during uninstall, and
  rejects unsupported installation roots before removing an existing app.
- The Microsoft Store update preserves the existing package/publisher/application
  identity and raises version 1.1.21.0 to 1.1.22.0. All 1,059 MSIX payload files
  match staging. Partner Center shows the saved replacement as validated in the
  existing submission, which Partner Center subsequently showed as live. A
  separate artwork correction is saved in submission 9; no new listing was
  created. External app updates are
  disabled for the Store package, which Microsoft signs after certification.
- Public builds require a stable version, HTTPS Timewarp feed, expected publisher
  and signing configuration. Main executable, installer and uninstaller signing
  is enforced; artifact checks require valid timestamped matching signatures and
  correct update-file checksums. Runtime verification fails closed if PowerShell
  cannot verify a signature. Updates reject downgrades and ask for an explicit
  restart. Development/preview updates remain disabled.
- AI completion stores immutable usage-only evidence before ledger settlement.
  A failed ledger call rolls back partial charges and leaves known usage queued
  for idempotent retry. Database-local Cron setup, bounded backoff, operator-review
  status and aggregate recovery checks are included. Streaming handles terminal
  events without a newline and preserves known usage after transport errors.
  If the database cannot persist evidence, usage-only function logs support
  operator recovery. Unknown provider usage stays reserved for review; it is
  never automatically charged at an estimate or released by age.
- Apple Developer ID Application was issued for team `6XD78664VT` and matches
  the securely retained private key. The Mac build pins the matching 0.8.20
  arm64 DMG and 1,031 native resources. Shared archive contracts pass, and the
  130 shipped Mac npm modules have zero reported audit findings. The Mac DMG
  workflow includes native startup, signatures, notarization, stapling and
  Gatekeeper checks. Making the repository public removed the earlier runner
  billing block. The Mac preview DMG passed packaged contracts, ASAR/fuse checks,
  native startup, native arm64 tools, the Git binding, deep ad hoc signatures,
  entitlements, all 116 portable tests and the shipped dependency audit. Developer
  ID signing and notarization have not run.

The checkout guard, AI migration/callers and Cron setup have **not been deployed**.
Windows direct signing and update hosting remain pending. Mac signing identity
preparation and native preview acceptance passed. Protected signing transfer
and notarization credentials are still pending. No paid transaction was
submitted and no production service was changed.

## Remaining public-release gates

1. **Signing and distribution:** complete acceptance of the existing Microsoft
   Store release and submit the saved artwork draft when ready. Direct EXE
   downloads still require a signing identity/service and HTTPS update hosting.
   For macOS, the native preview DMG and approved Developer ID identity are now
   prepared. Authorize protected signing transfer, supply notarization
   credentials, then build, sign,
   notarize and test the DMG. See [native distribution](native-distribution.md).
2. **Staged deployment:** version the matching existing Timewarp service baseline,
   use a separate staging project, apply the checkout/AI migrations, enable and
   verify the recovery Cron job, then deploy matching function versions. Drain
   old checkout handlers during production cutover.
3. **Live acceptance:** complete signed Stripe test-mode payment/webhook lifecycle,
   duplicate delivery and ledger assertions; full Google approval/callback and
   fresh-device restore; a completed Codex turn with available allowance; real
   connector and Timewarp model/voice flows, including failed settlement and
   database-outage recovery. Historic reports stop short of these outcomes.
4. **Windows release acceptance:** clean-machine install/uninstall/reinstall,
   protected credentials, signed N to N+1 upgrade, rejected tampered/unsigned or
   wrong-publisher updates, and rollback/data compatibility on supported systems.
   The unsigned preview passes install, installed startup, same-version reinstall
   and uninstall on this development machine. Clean-machine acceptance and the
   signed upgrade/security cases remain unproven.
5. **Operations:** rehearse backup/restore and rollout rollback; configure retained
   recovery logs, actionable service/webhook/credit alerts, responsible operator
   and a support deadline for unresolved reservations. Verify alert delivery and
   recovery against deployed services.

The precise rollout, alert conditions and acceptance checklist are in
[operations](operations.md). Commands and signing/CI configuration are in
[building](building.md#isolated-installers-and-release-signing).

## Verification performed

| Check | Result |
| --- | --- |
| `npm run check` | Pass |
| `npm test` plus the three new Mac input tests | 130 pass, no skips |
| `npm run test:portable` | 116 pass, no skips |
| `npm run test:email` | 18 pass |
| Deno check, editable/staged cloud plus all other edge entry points | Pass |
| `npm run verify:cloud-source` | All 11 staged modules match |
| `npm run verify:upstream` | Archive, original executable and runtime inventory verified |
| `npm run verify:staged` | Packaged code/routing, disabled inherited updater, icons, fuses and ASAR integrity pass |
| `npm run verify:contracts` | Original desktop schemas accept restored data/settings |
| Native startup in an empty test profile | Auth screen/preload bridge load using Electron 43.7.7 |
| NSIS preview installer build | Pass, unsigned internal artifact |
| Preview install, installed startup, reinstall and uninstall | Pass on this development machine; all 1,060 installed files match staging, unsupported roots are rejected, and deep files/registration/test directory are removed |
| Existing Microsoft Store MSIX update | Version 1.1.22.0; all 1,059 payload hashes pass; Partner Center validation passes; submission 8 is live; installed upgrade acceptance is still pending; artwork correction is saved in submission 9 |
| Apple Silicon Mac preview DMG | GitHub run 37494238772 passed native startup, packaged contracts, ASAR/fuses, architecture, Git binding, deep ad hoc signature, entitlements and 116 portable tests; Developer ID signing/notarization still pending |
| Root npm audit | Zero reported vulnerabilities |
| Shipped installed npm inventory/audit | 120 modules, zero reported vulnerabilities |
| Account/callback visual verifier using local dependencies | 16 layouts and associated UI checks pass |
| Workspace visual verifier using local dependencies | Light/dark/narrow layouts, tabs, tools, browser actions and profile isolation pass |
| Independent adversarial review of final hardening | No remaining concrete P1/P2 findings; live signing/log retention still required |

The npm inventories do not enumerate every compiled-in library or every native
binary/Deno import; they are scoped evidence, not a claim of total vulnerability
coverage. The GitHub Mac preview workflow passed; Developer ID signing,
notarization and clean-machine acceptance have not run. Generated reports,
verification profiles, binaries and signing credentials
are ignored. The original local build and production configuration were preserved.
