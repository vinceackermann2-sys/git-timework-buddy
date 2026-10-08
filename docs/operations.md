# Timewarp production rollout and operations

Public release is held until the external acceptance gates in this document pass.
Local source, preview builds and fixture tests do not prove the deployed service.

## Service ownership and baseline

The desktop connects to Timewarp's configured Supabase project, currently
`mrqoeywofslgnquvzhuf`, and the branded website `timewarpdev.com`. Account,
billing, history and connector functions run in that Timewarp project. Azure,
Stripe, Supabase and Composio are service providers; there is no Energy-hosted
application backend dependency.

`timewarp-energy`, SQL/bucket names containing `energy`, `surface: energy`,
the OAuth target `energy-desktop`, local `app://energy` and the existing
`Timewarp Energy` profile are compatibility identifiers. Renaming them would
require data, OAuth and device-profile migrations. Stripe lookup keys and price
metadata such as `timewarp_energy_*` and `energy_monthly_extra_credits` are live
catalog identifiers; renaming them would create duplicate prices. Internal
engine identifiers (`energy://` links, `energy-git`, `ENERGY_*` variables and
agent role names) are stored in existing chats and agent definitions and stay
unchanged.

The upstream desktop archive is a build input, not a cloud server. Staged
package verification rejects Energy server URLs in executable app code,
including startup recovery code. Builds never download from Energy: Windows
inputs come from `TIMEWARP_UPSTREAM_BUNDLE_URL` and the Mac DMG from
`TIMEWARP_MAC_UPSTREAM_URL`, both Timewarp-controlled and SHA256-pinned. The
working app keeps no Energy update feed. Executable details, the macOS
copyright and the About panel name Timewarp first and keep the upstream notice.

The matching existing Timewarp service baseline must be versioned alongside this
integration before creating staging. The local website repository contains the
original reservation schema in `20260911120200_agent_ai_reservations.sql`;
the billing, organizations, Composio function and Google website are established
Timewarp services whose full definitions are outside this integration checkout.
Record their source revisions, applied migration versions, secret **names**,
provider/model deployment names, callback allowlists and Stripe product IDs.
Restore the baseline into a separate staging project, with test Stripe products
and secrets. Set the desktop's public configuration to staging for acceptance.

## Database and function cutover

1. Record a restorable backup and the current function releases. Prove that the
   backup can be restored into a separate project before production rollout.
2. In staging, apply the existing additive integration migrations in order,
   including the checkout guard `20261005220000_subscription_checkout_guard.sql`
   and `20261006100000_desktop_ai_settlement_recovery.sql`.
3. Enable Supabase Cron and apply
   `timewarp/supabase/ops/enable-ai-reconciliation.sql`. Verify the active job and
   successful executions before accepting traffic. Inspect
   `select public.timewarp_energy_ai_reconciliation_status();` as an operator.
4. Run `node scripts/stage-cloud.cjs`, `npm run verify:cloud-source` and the
   documented Deno checks. Deploy `stripe-billing` and `timewarp-energy` with
   their shared modules. Install database functions **before** deploying callers.
5. Complete the staged acceptance below. During production checkout cutover,
   pause new subscription checkouts and drain the old handlers before deploying
   the guard. Follow [billing deployment](building.md#billing-guard-deployment).
6. Re-enable traffic only after deployment version, billing and recovery checks
   pass. Keep the old deployment identifiers and backup reference in the release
   record. These steps have not been executed against production in this task.

## Credit recovery and alerts

`timewarp_desktop_ai_settlements` stores reservation ID, owner, model, token
counts, cost and desired outcome. It stores no conversation/tool/audio content.
The completing RPC commits that evidence even if a later ledger call fails;
partial ledger writes roll back. Cron retries known settlements idempotently,
with backoff, and moves repeated failures to operator review after 12 attempts.
Successful records stay as recovery evidence; choose and document retention for
completed queue rows without removing the financial ledger.

Unknown provider usage remains reserved and marked for review. The worker never
charges an estimate or silently releases it. Match provider request evidence and
ledger state before resolving a specific reservation. If usage is confirmed,
replay `timewarp_energy_complete_ai` with the verified counts and cost; if the
provider confirms no usage, replay with `released` and zero counts/cost. Replays
cannot charge a settled reservation twice. Document a support deadline and refund
policy for cases whose usage cannot be established; do not use row age as proof.

If the database cannot even save evidence, function logs include only reservation
ID, model, outcome, token counts and cost. Configure retained/exported logs and
alerts for `AI settlement evidence could not be saved`, queue `review > 0`,
pending work older than ten minutes, and `unrecordedStale > 0`. Verify that the
alert reaches the responsible operator and that usage-only log evidence can be
retrieved and replayed after a simulated database outage. A process/provider crash
before usage is received remains an unknown outcome requiring investigation.

Also alert on auth/edge failures, missing secrets/model deployments, Stripe
webhook failures or growing delivery delay, and history-sync errors. `/healthz`
is a liveness check; it does not prove database, payments or provider readiness.
Check Cron's job history and actual authenticated service requests separately.

## Required live acceptance

- Stripe **test mode**: successful payment through the signed webhook, duplicate
  delivery, concurrent checkout, lost response, cancel/retry, renewal, failed
  payment, cancellation and applicable refund handling. Assert one subscription
  per scope and exactly one entitlement/ledger grant per event.
- Google: complete approval through the branded website, desktop callback,
  restart/refresh, revoked session and fresh-device sign-in/history restore.
- Codex: a completed native tool-capable turn using an eligible account with
  allowance; confirm that rejected access never switches to paid credits.
- Timewarp models/voice: completed and interrupted streams, missing usage,
  ledger failure/retry, total database outage, personal-credit isolation and
  provider error recovery. Verify actual ledger balances and recovery alerts.
- Connectors: real authorization, callback, scoped tool execution, disconnect
  and account-switch isolation against the existing Timewarp Composio service.
- Windows: clean-machine install, launch, OS-protected credentials, restart,
  uninstall/reinstall preserving chosen device data, signed N to N+1 update,
  wrong-publisher/tampered/unsigned update rejection and unavailable verification
  tools. Include long installation paths, busy-file rollback and network paths
  where supported. Test the final artifact on every advertised Windows version.
- Recovery: restore a backup into isolation, recover pending billing/AI work,
  and rehearse the function and desktop rollback procedure.

## Signing, hosting and rollback

Provide the real certificate/service, expected publisher and Timewarp HTTPS
download/update location. Build with `npm run installer:release`, then validate
with `npm run verify:release`. Publish the verified installer and block map
first, then `latest.yml`; keep the previous installer available for recovery.
Confirm the hosted bytes match the verified metadata and correct content types.
The manual artifact workflow does not publish anything.

Updates require a valid timestamped matching signature and block verification
failures. Downgrades are disabled. For a desktop regression, pause publication
and ship a corrected version with a higher version number; manually reinstall a
previous signed artifact only under the documented support procedure with a
profile backup. Test data compatibility before either operation.

Keep additive checkout/recovery tables and RPCs during a function rollback.
Never restore an unguarded checkout handler while accepting new checkout traffic.
If reverting the AI caller, preserve and drain its recovery queue; the older
caller cannot record new evidence. Do not roll the database back over completed
payments or ledger entries. Record the actual tested rollback steps and timings.
