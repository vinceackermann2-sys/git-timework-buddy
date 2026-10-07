# Timewarp 1.1.23 release record

Checked 7 October 2026 (Europe/Stockholm).

## Source

All five local branches are included in `main` and their tips are pushed to
`vinceackermann2-sys/git-timework-buddy`. Published history was preserved.
Desktop version changes are committed as `33d42b1` in that repository.
The same desktop and Mac workflow changes are committed as `8bc2697` in the
existing desktop repository, `vinceackermann2-sys/timework` (currently private).
The accepted Mac artifact was built from connected-repository commit
`6fb8a44565a39a197ea7327639608d8b775b2127`.

The Mac and Microsoft Store configurations both use version **1.1.23**;
the Store package version is **1.1.23.0**, following **1.1.22.0**. Release tests
and Mac notarization recovery now read the configured version.

## Supabase

Production project: `mrqoeywofslgnquvzhuf` (TimeWarp Production).
All six checked-in edge functions were redeployed. Their downloaded production
source matches all 37 local files, including shared modules and email templates.

| Function | Deployed version | Status |
| --- | --- | --- |
| timewarp-energy | 24 | ACTIVE |
| stripe-billing | 48 | ACTIVE |
| stripe-webhook | 45 | ACTIVE |
| auth-email-hook | 41 | ACTIVE |
| contact | 41 | ACTIVE |
| timewarp-workspaces | 43 | ACTIVE |

Unauthenticated/malformed request checks returned their expected 401/400
responses. Existing gateway JWT settings were retained; handlers enforce their
own authentication or webhook verification.

SQL changes are already present. The checkout and recovery migrations are
recorded as `20261005220000` and `20261006100000`. Earlier migration timestamp
mapping remains documented in [authentication hosting](auth-hosting-20261006.md).
The accounting/persistence migration is not separately recorded under local
version `20261005130000`; its three deployed RPC bodies were compared against
the effective ordered SQL, including the later monthly-credit allowance update,
and match. Historical migrations were not replayed over the newer definitions.
Preference writes permit the service role and deny anonymous execution.

The minute-by-minute `timewarp-desktop-ai-reconciliation` Cron job is active;
the ten most recent executions in the inspected ten-minute window succeeded.
Recovery status showed zero pending, review, and unrecorded-stale items.

## Website

Lovable project: `cbb636a5-6463-4d72-8642-2660fb02af3e`.
Publication was triggered through Lovable. Both
<https://git-timework-buddy.lovable.app> and <https://timewarpdev.com> return
the Timewarp website over HTTPS. The Windows download configuration points to
the existing [Microsoft Store listing](https://apps.microsoft.com/detail/9N6WRN6GN0KR).
The Mac download points to the verified signed 1.1.23 DMG in the separate public
[`timewarp-releases` repository](https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.23).
This download remains available independently of source-repository visibility.

## Windows

Artifact: `timewarp/build/store/Timewarp-Store-1.1.23-x64.msix`.
SHA256: `de94812cf0a2b4243aad5077677750ff4cb200776bc4a4639093139ca80e1244`.
Size: 341,353,486 bytes. The existing Store identity, publisher, application ID,
and local profile are preserved. The external updater is disabled.

Local manifest/version and all 1,059 payload hash checks passed. All 136 desktop
tests passed. Native startup on Electron 43.7.7 verified the empty-profile auth
screen, preload bridge, and ASAR integrity for version 1.1.23. The shipped
dependency audit reported no vulnerabilities. Installed Store upgrade acceptance
has not been performed.

The package passed Partner Center validation and was saved in the existing
TimeWarp Dev listing, Store ID `9N6WRN6GN0KR`, submission **10**
(`1152921505702059624`). It was submitted for certification on 7 October.
Partner Center shows **Update in certification**, **Submission: Complete**, and
**Pre-processing: In progress**. Certification approval remains pending.
Existing pricing, markets, listings, and publication timing were preserved:
the product starts publishing only when **Publish now** is selected.
Screenshot evidence is saved locally as
`timewarp/reports/store-submission-1.1.23.png`.

## macOS

Making the connected source repository public cleared GitHub's earlier billing
block. [Build 37583238300](https://github.com/vinceackermann2-sys/git-timework-buddy/actions/runs/37583238300)
succeeded on 7 October. The final Apple Silicon DMG is signed with Developer ID
Application: Vincent Ackermann (team `6XD78664VT`). Apple accepted submission
`4ccc3e8d-564a-41ac-85f7-665fd31fbc36`; ticket stapling, stapler validation,
and Gatekeeper assessment passed. The final acceptance verifier passed again
against the downloaded workflow artifact.

Artifact: `Timewarp-1.1.23-arm64.dmg`, 256,875,161 bytes.
SHA256: `328b41cc409d42e1b2ff5ac534decbe8330f272cf24014da9a0d97a847affbcc`.
The [public release](https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.23)
includes the DMG, checksum, and acceptance summary. A complete anonymous
download matched the accepted final DMG's size and SHA256.

The public downloads repository contains installers and release documentation;
it does not require the source repository to remain public. Supabase's current
plan rejected a larger storage file limit, so its existing 50 MiB limit was
preserved and the installer is hosted on GitHub.

All 122 portable tests passed; the shipped dependency audit found no
vulnerabilities. Native startup verified version 1.1.23, the authentication
screen, preload bridge, and empty profile. The app requires Apple Silicon and
macOS 12 or later. Intel, installation over an existing Mac profile, and live
Mac service acceptance have not been verified. Mac automatic updates remain
disabled; this release is installed manually from the DMG.

The existing protected Apple signing identity and notarization credentials are
configured for the connected repository's `desktop-release` environment, limited
to the `main` branch. They remain outside source and artifacts.

The public artifact is versioned as `v1.1.23`; the website enables the Mac
download only after the accepted artifact and anonymous download were verified.

## Other validation

Website TypeScript checks, four website tests, the production build, all 18
hosted asset comparisons, and the existing platform/download checks passed.
All seven cloud entry points passed Deno checking; all 18 email-template tests
passed. Generated detailed evidence remains in the ignored `timewarp/reports`
and `.temp` directories.
