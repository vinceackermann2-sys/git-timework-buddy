# Building timework

The repository is named timework; the desktop product is named Timewarp.
This is an editable integration around the supplied Energy 0.8.20 Windows
runtime, rather than the complete upstream Electron application source.

## Source-only checkout

Install Node 24 and Deno 2.9.5, then run from `timewarp`:

```powershell
npm ci --ignore-scripts
npm run check
npm run test:portable
npm run verify:cloud-source
npm run test:email
deno check --frozen --config supabase/functions/auth-email-hook/deno.json cloud/index.ts supabase/functions/timewarp-energy/index.ts supabase/functions/stripe-billing/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/timewarp-workspaces/index.ts supabase/functions/contact/index.ts supabase/functions/auth-email-hook/index.ts
```

These are the GitHub Actions checks. `test:portable` explicitly excludes three
suites that read upstream bundles: agents, connector-browser and wire.integration.
`npm test` keeps the complete suite and requires the native build inputs below.
CI does not build, sign, deploy, charge cards, or use production credentials.

## Native build prerequisites

On Windows, supply the reviewed inputs from the existing Energy 0.8.20 distribution:

- `timewarp-runtime/app/`: bundled tools/resources and runtime files in the inventory.
- `timewarp-runtime/build/app.asar.pristine`: the original unmodified app archive.
- `timewarp-runtime/upstream.exe`: the original unmodified executable.

The editable `patch.js` and `fix-asar-integrity.js` are tracked. The upstream
binaries, generated archive, retired local server and user data are ignored.
Obtain and preserve the upstream distribution and its notices separately.
This repository does not establish redistribution rights for that distribution.

`timewarp/upstream-lock.json` pins the executable, archive and 1,056 runtime
files by size and SHA256. `npm run verify:upstream` rejects corrupt or different
inputs. Builds copy only the inventory; stray logs, archives and update files
cannot enter a release. Set `TIMEWARP_UPSTREAM_DIR` to another directory with
the same layout if needed. `pin-upstream.cjs` is a deliberate input-maintenance
operation, never part of a normal build; review provenance and its diff when
accepting a new vendor distribution.

All resource editors, renderer fixture dependencies and packaging tools are now
pinned locally in `timewarp/package-lock.json`. Install the official Electron
binary after a source-only install:

```powershell
node node_modules/electron/install.js
npm run verify:upstream
```

Release staging uses official Electron 43.7.7 with updated Chromium/Node, explicit
security fuses and Windows ASAR integrity. The legacy in-place development build
keeps its vendor runtime. Branding comes from tracked `timewarp/assets`.
An upstream distribution is still required; this repository does not contain
the complete original desktop source.

Close Timewarp, then run from `timewarp`:

```powershell
npm run build
npm test
npm run verify:build
npm run verify:contracts
```

The build replaces files in `timewarp-runtime/app` and creates local rollback
backups. Start `launch.cmd` in the repository root after successful verification.

## Isolated installers and release signing

Use `npm run installer:draft` to build an **unsigned internal preview** without
replacing the working app. Output is `timewarp/build/installer-draft`.
The preview has its own installation name, app identity and default profile
(`Timewarp Preview`); it does not carry an update feed.
`npm run verify:staged` validates code, icons, routing, fuses and integrity.
`node scripts/verify-native-startup.cjs` opens the staged app with an empty
verification profile and checks its auth screen/preload bridge, then closes it.
Other Timewarp instances must be closed for that loopback-port check.
`npm run verify:installer-preview` installs only the preview into a checked
temporary build directory, compares every installed file with staging, opens
the signed-out app, reinstalls the same version and uninstalls it. It checks
that long bundled paths and Windows registration are removed, then cleans up
its temporary directory. It refuses to change an existing preview installation.
This local check does not replace clean-machine or signed upgrade acceptance.
Bundled deep paths are written and removed using Windows extended paths. Setup
limits the installation root to 160 characters (reserving the product subfolder
in the directory UI) and rejects unsupported choices before replacing an app.

For a public build, copy `release.example.json` to ignored `release.json`. Set
the stable version, public HTTPS update URL and certificate publisher names.
Configure either `TIMEWARP_CERT_SHA1` (CurrentUser certificate with private key),
a local PFX in `WIN_CSC_LINK` plus `WIN_CSC_KEY_PASSWORD`, or a
`TIMEWARP_SIGN_SCRIPT` CommonJS module exporting `async function(file)` for a
signing service/hardware token. Keep credentials outside Git.

`npm run installer:release` requires signing configuration. It stages the app,
checks the package and shipped npm dependency inventory, signs the main executable
and builds a signed NSIS installer/uninstaller. It requires valid timestamped
Authenticode signatures matching the configured publisher and verifies the
installer size/SHA512 in `latest.yml`. Outputs are in `timewarp/build/release`.
`npm run verify:release` repeats those checks. The release build and artifact
verifier do not publish or install.
The PFX/service path still requires real-certificate acceptance; no certificate
was available for this workspace review.

Release updates use only the embedded Timewarp feed, reject downgrades and fail
closed if signature verification cannot run. Downloaded updates prompt for an
explicit restart. The inherited updater is disabled so startup/account changes
cannot reset the feed or policy. Development builds keep updates disabled.

`.github/workflows/native-release.yml` adds a manual Windows artifact job. Use
`npm run export:upstream` to prepare a ZIP and SHA256 of just the pinned inputs,
then provision its HTTPS location in secret `TIMEWARP_UPSTREAM_BUNDLE_URL` and
its hash in variable `TIMEWARP_UPSTREAM_BUNDLE_SHA256` in the `desktop-release`
environment. The job verifies the ZIP and every extracted input before building.
Signed runs also require `TIMEWARP_RELEASE_CONFIG_JSON`,
`TIMEWARP_SIGNING_PFX_BASE64` and `TIMEWARP_SIGNING_PFX_PASSWORD` in that protected
environment. It stores artifacts for review and never publishes them.
See [operations](operations.md) for deployment and live acceptance gates.

## Existing Microsoft Store listing

The Store route uses the existing **TimeWarp Dev** listing (`9N6WRN6GN0KR`),
not the separate EXE/MSI draft. `timewarp/store.json` records its package name,
publisher, package family and application ID. These were checked in Partner
Center and against the installed 1.1.21.0 package. Version 1.1.22.0 preserves
that identity. Increment the three-part `version` for subsequent updates and
set `previousPackageVersion` to the highest version already submitted.

```powershell
cd timewarp
npm run installer:store
npm run verify:store
```

The unsigned `build/store/Timewarp-Store-1.1.22-x64.msix` is for Store submission.
Microsoft signs the package after certification; it is not a signed EXE or a
package for direct installation. The builder preserves the working desktop,
uses the stable Store version and existing application ID, retains the local
profile, and disables the external updater. It verifies manifest identity and
every staged payload file against the MSIX contents. Store signing needs no
local PFX, update URL or new product registration. The workflow's `store` input
selects this artifact; `store` and `signed` cannot both be true.

Upload to the existing product update draft and inspect Partner Center's package
validation before saving. Package validation is separate from certification,
installed upgrade acceptance and production readiness. Preserve the previous
package until the replacement is accepted. Do not change pricing, markets or
publication timing merely to replace a package. For the current review request,
publication is explicitly held until Publish now is selected so certification
can proceed while production acceptance remains open. See
[native distribution](native-distribution.md) for account findings and macOS
prerequisites.

## Cloud prerequisites

`config.json` contains the current public Supabase URL, publishable key and
Google bridge URL. Provider keys, Supabase service-role keys, Stripe secrets,
email credentials and Composio credentials belong in server-side secret stores.

These are additive desktop-integration migrations, not a bootstrap of all
Timewarp services. They require existing billing, subscription, credit ledger,
AI reservation, rate-limit and organization database objects. In particular,
`timewarp_agent_ai_reservations` and `timewarp_reserve_agent_ai` are referenced
but not created by these migrations. The `composio` edge function and branded
Google website bridge are also external services.

Do not apply these migrations to an empty database and assume a complete service
has been installed. Archive the versioned service baseline and document its
secret names, deployment order, backup and restore procedure first.

For the existing configured services, edit `timewarp/cloud`, run
`node scripts/stage-cloud.cjs`, then `npm run verify:cloud-source` before
deploying `timewarp/supabase/functions/timewarp-energy`. Other edge functions
have their own source under `supabase/functions`. Email template consumers need
the email hook's JSX compiler configuration when type checking.
The source staging script preserves `supabase/config.toml`; it never selects or
resets a deployment project. Link the intended staging/production project
explicitly and verify the project reference before any deployment command.

The `verify:*` acceptance scripts may create live fixture accounts, checkout
sessions and model requests. Read the relevant script before running it; these
scripts are intentionally excluded from CI.

## Billing guard deployment

The subscription checkout guard requires migration
`20261005220000_subscription_checkout_guard.sql` and the updated `stripe-billing`
function, including `_shared/subscriptionCheckout.ts`. Deploying only the function
fails closed because the required database functions will be missing.

1. Validate against a staging database with the existing service baseline.
   Use Stripe test-mode secrets and matching test products/prices.
2. Suspend new subscription checkout requests and drain the old billing handlers.
   An older handler cannot observe the new guard, so mixed-version checkout
   traffic must not run during cutover.
3. Inventory legacy open subscription Checkout Sessions. Finish or expire them
   through Stripe, with appropriate owner handling. The new function blocks
   these sessions from being duplicated; it does not silently cancel them.
4. Apply the migration, then deploy `stripe-billing` with its shared modules.
   Existing subscriptions, customer mappings and credit balances are preserved.
5. Verify concurrent checkout, cancel/retry, subscription retrieval failure,
   lost responses and signed test-mode payment/webhook delivery. Confirm one
   payable subscription per scope and that repeated delivery grants no extra
   entitlement. Then restore checkout traffic.

Keep the guard table when rolling back unrelated changes. If reverting to an
unguarded billing function, keep subscription checkout disabled until a guarded
version is restored. Database row age alone is not permission to discard a
pending attempt; verify the corresponding Stripe session first.

Local regression tests use bundled PostgreSQL via the pinned PGlite development
dependency. `node --test tests/subscription-checkout.test.cjs` exercises the actual
new migration and billing handler without credentials or live Stripe requests.

## macOS DMG

Use an Apple Silicon Mac with Node 24 and Xcode command-line tools.
The preparation helper extracts the pinned DMG with macOS file modes intact.
It never downloads from Energy. Place the pinned DMG at
`timewarp/build/upstream-mac.dmg`, or set `TIMEWARP_MAC_UPSTREAM_URL` to
Timewarp's private HTTPS copy (plus `TIMEWARP_MAC_UPSTREAM_TOKEN` when that
storage needs a bearer token, such as a private GitHub release asset API URL).
The same names are repository secrets for the macOS workflow. The DMG SHA256 in
`mac-upstream-lock.json` is checked before anything is extracted.

    cd timewarp
    npm ci --ignore-scripts
    node scripts/prepare-mac-inputs.cjs

Set TIMEWARP_MAC_RESOURCES to build/mac-upstream-resources on a local Mac;
Actions sets it automatically. Then run:

    npm run installer:mac:draft

The ad hoc preview uses the Timewarp Preview profile. It verifies application
contracts, native architecture/Git/signatures, dependency audit and cold startup.
The DMG is under build/mac-preview; evidence is in reports/mac-*.json.

For a signed release, supply CSC_LINK (encrypted Developer ID PKCS#12),
CSC_KEY_PASSWORD and TIMEWARP_NOTARY_KEYCHAIN_PROFILE from protected storage.
A separate keychain also needs TIMEWARP_NOTARY_KEYCHAIN. Then run:

    npm run installer:mac:release

The release uses mac-release.json and requires the approved Developer ID,
hardened runtime and no debugger entitlement. It submits the DMG with notarytool,
requires Accepted, staples the ticket and validates Gatekeeper. It never publishes.
The macOS workflow's desktop-release job uses protected environment secrets:
TIMEWARP_APPLE_P12_BASE64, TIMEWARP_APPLE_P12_PASSWORD, TIMEWARP_APPLE_ID and
TIMEWARP_APPLE_APP_PASSWORD. It validates the certificate fingerprint, uses a
temporary keychain and removes signing files afterward.

Run the Apple identity helpers with pwsh on Windows. They retain the private key
outside OneDrive, encrypted, with its password protected by DPAPI:

    pwsh -File scripts/prepare-apple-signing.ps1
    pwsh -File scripts/export-apple-signing.ps1 -Certificate <downloaded-certificate.cer>

Only the public CSR is uploaded to Apple. A P12 and its password are signing
credentials and must remain in protected storage. App-specific passwords must
be created and entered by the user directly into the keychain or protected secret.
