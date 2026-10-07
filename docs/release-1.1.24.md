# Timewarp 1.1.24 release record

Checked 7 October 2026 (Europe/Stockholm).

## Source and validation

All existing branch tips are included in `main`. Local changes were committed as
`b9649bc` and pushed to the connected `git-timework-buddy` repository without
rewriting published history. Both platform configurations use version 1.1.24.
Commit `7bcc20a` declares the billing renderer's test dependency and separates
private-runtime browser tests from portable checks. These changes affect test
setup; the packaged application source remains the same.

Validation passed: 172 complete desktop tests, 153 portable tests, 18 email
tests, all seven cloud entry-point type checks, staged cloud-source comparison,
four website tests, website production build and all 21 packaged website assets.
The isolated model-picker and onboarding renderer checks passed, including paid
plan confirmation, Free completion, restart behavior, both themes and narrow
layouts. GitHub source and website checks passed for `7bcc20a`.

## Supabase

Production project: `mrqoeywofslgnquvzhuf`.

`stripe-billing` was redeployed as version **49**, ACTIVE. All seven downloaded
production files match local source. Existing authentication settings were kept.
`contact` version **42** already matches all five local source files, so another
deployment was unnecessary. Request-validation smoke checks returned the expected
401 for billing and energy, and 400 for malformed contact submissions.

No SQL migration was needed. The checkout and settlement-recovery migrations are
already recorded. The three accounting and persistence RPC bodies match the
effective ordered local SQL, including the monthly allowance update; their
service-role grants and denial of anonymous execution are intact. The active
minute-by-minute reconciliation Cron job is present. The existing support-ticket
schema and private image bucket also support the feedback flow. Historical
migrations with different production timestamps were not replayed; see the
[migration mapping](auth-hosting-20261006.md).

## Windows

Package: `timewarp/build/store/Timewarp-Store-1.1.24-x64.msix`.
Version: **1.1.24.0**, following 1.1.23.0.
Size: 342,198,543 bytes.
SHA256: `8b726836ba314b1a1d18ec2456be6330dc48632016bb4c44e30a605fa3ea6ce8`.

The existing Store identity, publisher, application ID and profile path are
preserved. All 1,059 payload hashes and 52 transparent shell icons passed
verification. The packaged runtime audit found zero vulnerabilities. Isolated
native startup verified Electron 43.7.7, version 1.1.24, ASAR integrity, the
authentication screen and preload bridge.

Microsoft validated the uploaded package in the existing TimeWarp Dev listing,
Store ID `9N6WRN6GN0KR`, submission **11** (`1152921505702063793`). It is submitted
for certification and configured to **publish automatically after approval**, as
requested. Pricing, markets and listing content are unchanged. Certification and
installed Store upgrade acceptance remain pending. Local screenshot evidence is
`timewarp/reports/store-submission-1.1.24.jpg`.

## macOS

Apple Silicon DMG: `Timewarp-1.1.24-arm64.dmg`, macOS 12 or later.
Size: 257,110,178 bytes.
SHA256: `da441843b391dc3690bca284e9803b48d1eb73f7cb40b336d8a6bd073764974b`.

Built from `b9649bc` in GitHub run **37605074986**. Developer ID/team,
hardened runtime, native tools, Git binding, signatures and isolated native
startup passed. Apple accepted submission
`e8aa9ea5-0d3d-49e2-a82d-a2131fa1c2bf`; stapling and Gatekeeper passed. The initial
run then failed on test setup. Recovery run **37605944913**, at `7bcc20a`, resumed
the same accepted artifact, verified final acceptance and passed all 153 portable
tests and the dependency audit. It completed successfully.

The public download is in the separate
[downloads repository](https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.24).
The website download configuration points to this release. Mac updates remain
manual. Clean-Mac installation, upgrade over an existing profile and live Mac
service acceptance are not verified by the isolated build checks.
