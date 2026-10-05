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

On Windows, supply these files from the existing Energy 0.8.20 runtime:

- `energy-testv1/app/`: the complete unpacked Windows application, including
  `energy testv1.exe`, `resources/app.asar`, unpacked native modules and the
  runtime's bundled tools/resources.
- `energy-testv1/build/app.asar.pristine`: the original unmodified app archive.

The editable `patch.js` and `fix-asar-integrity.js` are tracked. The upstream
binaries, generated archive, retired local server and user data are ignored.
Obtain and preserve the upstream distribution and its notices separately.
This repository does not establish redistribution rights for that distribution.

The current native tooling also reads `config.json.brandSource` to locate an
external development checkout. Set it to that checkout's
`public/timewarp-logo.svg`; the external checkout must supply:

- `node_modules/electron-winstaller/vendor/rcedit.exe` for Windows PE resources;
- `electron`, `esbuild`, `react` and renderer dependencies for visual verifiers.

The actual logo used by the build comes from the tracked
`timewarp/assets/timewarp-logo.svg`. The absolute `brandSource` dependency still
needs replacement with pinned local tooling before a reproducible release.
Do not expect `npm run build` to work on a source-only clone.

Close Timewarp, then run from `timewarp`:

```powershell
npm run build
npm test
npm run verify:build
npm run verify:contracts
```

The build replaces files in `energy-testv1/app` and creates local rollback
backups. Start `launch.cmd` in the repository root after successful verification.

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

The `verify:*` acceptance scripts may create live fixture accounts, checkout
sessions and model requests. Read the relevant script before running it; these
scripts are intentionally excluded from CI.
