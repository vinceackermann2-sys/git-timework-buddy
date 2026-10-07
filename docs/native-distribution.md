# Native distribution status

Update, 7 October 2026: **Mac 1.1.24 is published** with accepted Apple
notarization, stapling, Gatekeeper, and anonymous-download checksum verification.
Windows 1.1.24.0 is submitted for certification in submission 11 and will publish
automatically after approval. Current artifacts and evidence are recorded in the
[1.1.24 release record](release-1.1.24.md).
Mac downloads use the independent public
[downloads repository](https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.1.24).
The remaining sections retain the 6 October build and submission history.

Checked 6 October 2026. Partner Center shows submission 8 as **Live**. Submission
9 is a saved artwork update draft with transparent logos and images captured
from the actual Timewarp app. No new product was registered. The Mac candidate
DMG has passed native startup and Developer ID signing checks; notarization,
stapling, Gatekeeper and the remaining [release checklist](production-readiness.md)
are still open.

## Windows

- Product: **TimeWarp Dev**, Store ID `9N6WRN6GN0KR`.
- Existing artwork draft: submission `1152921505702057240` (submission 9).
- Package identity: `TimeWarpDev.TimeWarpDev`.
- Publisher: `CN=B2BAE52B-CBF1-4A62-A0CD-60F8F262B802`.
- Publisher display name: `TimeWarpDev`.
- Package family: `TimeWarpDev.TimeWarpDev_m60bgk3k2x9p0`.
- Application ID: `TimeWarp`, checked against the installed previous package.
- New artifact: `timewarp/build/store/Timewarp-Store-1.1.22-x64.msix`.
- SHA256: `5db8d9ca30aee8dc1bed03f26fb9d923ed4e3f50f998f1724a0f3d7639e381d6`.

The replacement package was validated and submitted through the existing
listing; Partner Center subsequently showed submission 8 as live. The artwork
correction is saved in submission 9 and has not been submitted for certification.
Local package validation does not prove installed upgrade or live service
acceptance.

The new package passes local identity/version, ASAR/fuse, dependency audit and
all 1,059 payload SHA256 checks. All 127 application tests pass, and an empty
profile loads the staged native authentication screen and preload bridge.
This does not prove installation or migration from the existing Store app.
The installed previous app is named `timewarp`; the new native integration uses
the `Timewarp Energy` profile. Verify existing data and cloud restore explicitly
before publishing; no existing device data was moved or removed by the build.

[Microsoft signs MSIX/AppX submissions after certification](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-started-with-the-microsoft-store).
It does not provide a certificate for the standalone EXE. The existing unsigned
NSIS preview remains available for local acceptance. Direct EXE distribution
still requires an independent Authenticode certificate or signing service.
Store packages rely on Store updates rather than the embedded generic update
feed. The only requested capability is the existing `runFullTrust` capability.

Build commands and CI selection are documented in [building](building.md#existing-microsoft-store-listing).
Generated package and startup evidence is in ignored `timewarp/reports` files.

## macOS

Apple issued **Developer ID Application: Vincent Ackermann (6XD78664VT)**,
certificate ID `2Y2GKN9487`, expiring 17 September 2031. Its public SHA256
fingerprint is `35b48167357f672c4ff1dc9a14c503ca7c0b7c427a7f455dbe2c15552c30a901`.
The certificate matches the generated RSA private key and was exported as an
encrypted PKCS#12 identity. The key and DPAPI-protected password remain in a
restricted local directory outside OneDrive and Git. At the user's authorization,
the encrypted signing identity and notarization credentials were stored in the
protected GitHub `desktop-release` environment. Credentials are excluded from
source, build artifacts and logs.

For a directly downloadable DMG, [Apple requires a Developer ID Application
certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
The certificate download does not contain the private key. Use the key created
with the CSR, retained securely on the build Mac or exported as a protected
PKCS#12 identity. Developer ID Installer is needed for a PKG installer, not
for this DMG route.

The Mac build now uses the matching upstream **0.8.20 arm64** DMG:
[official versioned download](https://static.getenergy.com/desktop/alpha/arm64/0.8.20/arm64.dmg).
DMG SHA256: `bf55d5006673deb036d7e9be7455343e66fbd58a2796202ca6e3bb02b5484701`.
The archive and 1,031 resource files are pinned in `timewarp/mac-upstream-lock.json`,
including original unpacked modules. The website's newer 0.8.28 distribution is
excluded because these patch contracts target 0.8.20.

The Mac archive passes shared application contracts and Timewarp-only service
routing checks. Its 130 shipped npm modules have zero reported audit findings.
Packaging uses official Electron 43.7.7, the Mac icon and native Git/browser/Codex
tools, ASAR integrity, hardened fuses and an isolated preview profile. The
`macos-15` hosted runner builds a DMG and checks cold startup, native tool
architecture, the Git binding, deep code signatures and entitlements.

The repository was made public at the user's request after scanning all three
tracked commits. The only scanner finding was the intended public Supabase
publishable key; private signing material is outside Git. GitHub secret scanning
and push protection are enabled. Public standard runners removed the earlier
billing block without changing account billing settings.

[Mac preview run 37494238772](https://github.com/vinceackermann2-sys/timework/actions/runs/37494238772)
passed on Apple Silicon macOS: pinned inputs, packaged contracts, ASAR integrity,
hardened fuses, cold signed-out startup, native tool architecture, the Git
binding, deep ad hoc signature and entitlements. All 116 portable tests passed,
and the shipped dependency audit reported zero vulnerabilities. The artifact is
`Timewarp-Preview-0.1.0-draft.1-arm64.dmg`; it is an isolated acceptance preview,
not a Developer ID signed or notarized release.

The signed candidate from [run 37499383055](https://github.com/vinceackermann2-sys/timework/actions/runs/37499383055)
passed native startup, approved Developer ID/team checks and hardened-runtime
checks. Its Apple submission `3acbade8-b9b3-4bb3-88c9-165332b0fab5` exceeded the
initial wait. The original unstapled DMG SHA256 is
`34f41b002a8d758fcdefb938c875c94c1a2b8aa40fb2c4ff9587650a7695ccf1`.
[Recovery run 37504330079](https://github.com/vinceackermann2-sys/timework/actions/runs/37504330079)
resumes that exact submission and candidate; it does not submit another build.
The initial job's green status did not establish Apple acceptance. Final release
validation now requires matching accepted-notarization, stapling, Gatekeeper and
DMG-checksum evidence, and a failed notarization wait fails the job.

Remaining before a public Mac release:

1. Require accepted notarization, stapling and Gatekeeper verification before
   distributing the release DMG, then verify the hosted artifact checksum.
2. Verify installation, existing-data migration and live Timewarp services on a
   clean Mac. This initial build targets Apple Silicon; Intel is not validated.

[Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
uses the notary service and `notarytool`; issuance and acceptance cannot be
assumed instantaneous. The signed build requires an Accepted result, staples the
ticket, and validates Gatekeeper before retaining the release DMG. The workflow
does not publish. Ad hoc previews are for local acceptance. Mac automatic
updates remain disabled while a reviewed Mac feed is absent. No accepted
notarization ticket or production DMG release is claimed yet.

## Website downloads

[Website PR 35](https://github.com/vinceackermann2-sys/Desktop-APP/pull/35) is merged
at `34e158d0734f45b9c254f864c58314cb2e9c79cf`. The updated Lovable preview links
the existing Microsoft Store listing and the intended Apple Silicon DMG at
`https://github.com/vinceackermann2-sys/timework/releases/download/v1.1.22/Timewarp-1.1.22-arm64.dmg`.
That DMG URL is reserved for the verified release and is not available yet.
The existing `timewarpdev.com` and `www.timewarpdev.com` domain registrations were
restored in Lovable using their already-matching DNS records. The production
root domain and sign-in page load over HTTPS; the published site still uses the
Mac waitlist until the release is available and publication is verified.

The website production build, type checks, lint, 1,895 portable tests and 12
native Electron browser tests pass locally. Wallet policy static verification
uses the repository's CI structural configuration and does not establish live
payment acceptance. Its dependency audit has no high or critical findings;
7 low and 14 moderate findings remain. Private-repository GitHub CI could not
start because of an account billing/spending restriction. The existing branch
has no protection requirements; none were changed or bypassed.
