# Timewarp 1.1.25 release record

Release work on 8 October 2026 (Europe/Stockholm).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/3,
merged as `f82de2749e2a6430313ed8adf861c34864929985` after all checks passed.
Source commit `c280159` contains the existing desktop harness, model-picker,
history synchronization and organization security changes. Commit `7f69a5e`
removes a duplicate organization copy replacement caught during packaging.
Both platform configurations use 1.1.25. Published Git history is preserved;
unrelated video edits are excluded.

Local validation passed: 228 desktop tests, 209 portable tests, 18 email tests,
seven cloud entry-point type checks, all 11 staged cloud source modules, four
website tests, production website build and all 21 packaged website assets.
Website and desktop dependency audits reported zero vulnerabilities.

The PR's first source run passed; a later merge-check run timed out in the
unchanged real Windows Authenticode probe (208 of 209 tests passed). That failed
job passed on rerun without disabling or changing the trust check.

## Supabase

Production project: `mrqoeywofslgnquvzhuf`.

Applied `20261008133105_organization_membership_security.sql`, recorded remotely
as **20261008175702 / organization_membership_security**. This timestamp mapping
is intentional; do not replay the local migration because of the different ID.
Anonymous roles have no access to the three organization tables; authenticated
roles retain row-scoped SELECT only. Both new transactional RPCs grant EXECUTE
only to the service role and database owner.

Redeployed `timewarp-workspaces` as **44** and `timewarp-energy` as **25**. Both
are ACTIVE and preserve their existing custom authentication configuration.
All six workspace files and eleven energy files downloaded from production
match local source. Other functions were unchanged.

All eleven live membership security checks passed with disposable accounts,
including denied direct admin promotion, last-owner protection, recipient-only
acceptance, replay rejection and active-organization switching. All fixture
accounts and organizations were cleaned up. Evidence:
`timewarp/reports/release-1.1.25-membership-live.log`.

## Windows

Package: `timewarp/build/store/Timewarp-Store-1.1.25-x64.msix`.
Version **1.1.25.0**, following 1.1.24.0. Size: **342,207,225 bytes**.
SHA256: `7806fda8b1360effb59d7359c4d3d0f528bab28c832785618694dfd277df3c21`.

Existing Store identity, publisher, application ID and profile path are retained.
All 1,059 payload hashes and 52 transparent shell icons passed verification.
The packaged runtime audit found zero vulnerabilities. Isolated native startup
passed with Electron 43.7.7, ASAR integrity, preload bridge and authentication
screen; the packaged model-picker, task-activity, native-contract and browser
checks also passed.

Store ID: `9N6WRN6GN0KR`. Submission 12: `1152921505702064182`.
Microsoft validated the uploaded package, and it is **submitted for certification**
with **automatic publication after approval**. Pricing, markets and listing
content are unchanged. Store 1.1.24 was confirmed live before this update.
Certification and installed Store upgrade acceptance remain pending.

## macOS and website

Signed Mac packaging must run from the protected environment's allowed `main`
branch. The initial branch run `37820499583` was rejected by this protection
before execution. No protection settings were changed. Main-branch signed build
run **37821560392** targets merge commit `f82de27` and completed successfully.
Signed packaging, portable tests, runtime audit, startup and release verification
passed. Apple notarization submission `ab4c9762-21af-416a-882a-2dcee79a28b4`
was Accepted; the DMG is stapled and Gatekeeper accepted it.

Artifact: `Timewarp-1.1.25-arm64.dmg`, **257,153,925 bytes**.
SHA256: `d851ddd579848b3fbe4eae073d1fc95c90899213f5f8a41e6c7a66aebfafc75c`.
Downloaded CI evidence passed the local release verifier, and GitHub's uploaded
asset digest matches. Published release:
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.25.
Both website download configurations point to this verified artifact. Windows
continues to use the existing Microsoft Store listing. Mac updates remain manual.

## Remaining limits

This release does not isolate the local vault between Timewarp accounts using
the same OS profile. Existing security-advisor warnings remain: three intentional
authenticated membership helpers and disabled breached-password protection.
See [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and the [security review](app-membership-security-review-2026-10-08.md).
Clean-machine install, installed Store upgrade and live Mac account acceptance
are not established by the isolated build checks.
