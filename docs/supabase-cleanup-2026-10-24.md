# Supabase cleanup after the rebuild

Reviewed 24 October 2026 against production project `mrqoeywofslgnquvzhuf`.
The project still carried everything the previous Timewarp app (the
`Desktop-APP` repository, last released 28 September) had deployed. This change
removes what neither the desktop app, the website, Agent ID nor the kept edge
functions use.

## How "unused" was decided

- Every table, database function and bucket was searched for in this
  repository's desktop, cloud, website and Agent ID code, then followed through
  live function bodies, triggers and row policies. Objects reached only from
  the old app's functions are removed; anything a kept object reaches is kept.
- Live activity agrees: none of the removed tables changed after 28 September,
  while the desktop's history, settings and account tables changed on 24
  October. Most removed tables are empty; the rest hold the old app's test data.
- A dependency check against the live catalog found nothing outside the removal
  list that depends on it, apart from two tables' realtime publication entries,
  which go with the tables.

## Removed

| Kind | What |
| --- | --- |
| Edge functions (13) | `ai-proxy`, `stripe-connect-webhook`, `timewarp-agent-payments`, `timewarp-cloud-agents`, `timewarp-cloud-sync`, `timewarp-mcp`, `timewarp-personal-agent`, `timewarp-wallet-earnings`, `timewarp-wallet-fiat`, `timewarp-wallet-gateway`, `timewarp-wallet-swap`, `timewarp-webhooks`, `twilio` |
| Cron jobs | `timewarp-agent-jobs` and `timewarp-desktop-sweep`, which called `timewarp-personal-agent` every minute (2,880 calls a day), and the old cloud-agent tick if it is ever scheduled |
| Tables (47) | Old cloud agents, jobs, runs and desktop sessions; cloud sync, snapshots and memory; MCP OAuth; Twilio; agent cards and payments; wallet checkout; Company Base; the old agent and chat shares; outgoing webhooks; and `timewarp_energy_agents`, `_conversations` and `_runs`, the rebuild's first cloud conversations that the local harness replaced. The full list is in the migration. |
| Database functions (49) | The functions those tables used, plus credit auto-recharge, `timewarp_spend_credits`, `timewarp_record_ai_cost`, `timewarp_settle_credit_usage` and `timewarp_update_member_guarded` |
| Storage | Buckets `agent-artifacts` (empty), `timewarp-company-base` (673 files) and `timewarp-user-data` (33 files), and the four policies of `timewarp-user-data` |
| Vault secrets | The old job runner's `agent_job_worker_key`, `timewarp_cloud_agent_runner_url` and `timewarp_cloud_agent_runner_secret` |
| Function secrets (14) | `CLOUD_AGENT_MODEL`, `CLOUD_AGENT_RUNNER_SECRET`, `CLOUD_MCP_ENCRYPTION_KEY`, `GPT_TERRA_MODEL`, `JUPITER_API_KEY`, `JUPITER_REFERRAL_ACCOUNT`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `TIMEWARP_MCP_BASE_URL`, `TIMEWARP_OAUTH_ISSUER`, `TIMEWARP_OPERATION_RUNNER_SECRET`, `TIMEWARP_SOLANA_RPC_URL`, `TWILIO_CREDENTIALS_ENCRYPTION_KEY`, `TWILIO_WEBHOOK_BASE_URL`, `TWILIO_WEBHOOK_SIGNING_SECRET` |
| Code paths | `timewarp-workspaces`: Company Base, `shareAgent`, `listAgentShares`, `acceptAgentShare`, `shareChat` and `updateMemorySharingPreferences`. `stripe-billing`: `scopes` and `auto-recharge`. `stripe-webhook`: the agent card setup and auto-recharge payment events. Agent ID no longer checks new mail addresses against the old app's agents. |

## Kept

- From this repository: `agent-id`, `timewarp-energy`, `timewarp-workspaces`,
  `stripe-billing`, `stripe-webhook`, `auth-email-hook` and `contact`.
- `timewarp-agent-mail-webhook` is Resend's delivery-report endpoint for every
  email the queue sends. Its trimmed source now lives here; the old copy also
  stored mail for the old app's agents.
- `composio` (connected apps, called by `timewarp-energy`) and
  `process-email-queue` (the email queue, run by cron every minute) are still
  deployed from `Desktop-APP`. That repository stays their source until they
  move here.
- The email queue tables, `email_unsubscribe_tokens`, profiles, organizations,
  shares, billing, credits, account sync, desktop history and all Agent ID
  objects. `timewarp_energy_ai_reconciliation_status()` stays as the operator
  check in [operations](operations.md).

## Rollout

`timewarp/reports/cleanup-old-app.ps1` (not in Git) runs after the merge:

1. backs up the removed functions' code, every removed table's rows and
   columns, the removed database functions and the bucket files into
   `timewarp/reports/old-app-backup`;
2. deploys the trimmed `timewarp-agent-mail-webhook`, `timewarp-workspaces`,
   `stripe-billing` and `stripe-webhook`, and stops if a deploy changed a
   function's JWT check;
3. applies `20261024120000_remove_old_app_objects.sql` and records it;
4. empties and deletes the three buckets through the Storage API;
5. deletes the 13 functions and 14 secrets, then prints what remains.

Outside Supabase, a Stripe webhook endpoint for `stripe-connect-webhook` should
be deleted in the Stripe dashboard if one exists. If the old `Desktop-APP`
Lovable project is still connected to this Supabase project, publishing it
would deploy the old functions again.
