# Timewarp 1.2.6 release record

Release work on 14 October 2026 (Europe/Stockholm). 1.2.6 also carries
1.2.5 (PR #18, merged 13 October): 1.2.5's cloud rollout and Mac release
hadn't been published, so both ship now as part of 1.2.6.

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/19,
merged as `affbee3`. It was built in its own worktree (`timewarp-release-1.2.6`)
from `origin/main` at `9b60484`, merging six branches, each committed in its
own worktree:

- `security-fixes`:
  - agent commands don't inherit `TIMEWARP_*` tool tokens;
  - cloud AI holds count linked images and files, and an overrun is charged
    the hold;
  - migration `20261014120000` pins `scope_key` to its writer and limits
    direct `profiles` writes to the columns the apps write;
  - upload, file-type, MCP and share-list hardening.
- `auto-sandbox`: the command sandbox sets itself up at sign-in, is checked
  again after each Codex restart, and retries itself 1 day, then 7 days, after
  a failure.
- `anthropic-findings`:
  - workspace commits skip repo hooks, fsmonitor, signing and filters;
  - Sonnet 5.5 cache reads are billed at 0.05x;
  - a Claude reservation that gets a 402 retries with the counted tokens;
  - browser tool results drop invisible control characters.
- `agent-comms`: agents list, message and ask each other (`timewarp_team`),
  and read usage in credits, settings and status (`timewarp_app`); changing a
  setting needs an approval card.
- `first-steps`: a skippable guide after setup with a real browser run and
  four tasks to try.
- `import-prompt`: memory, projects and scheduled tasks from ChatGPT, Claude
  or Gemini on the web through a copy-paste prompt; imported automations
  start turned off.

Two conflicts came up, both additions to the same place (`app.css`, the
`check` script); the merge kept both sides. CI then failed two memory tests
in `engine-send-speed.test.cjs`, which had also failed on `main` since 1.2.5.
On the Windows runner, a test's outside edit landed in the same 15.6 ms clock
tick as Timewarp's read, so the file times didn't change. `60b779b` makes the
tests wait one tick; the app is unchanged.

Local validation on the merged branch:
- `npm run check`, 672 portable tests, 397 engine tests;
- the engine build and independence audit, `verify:cloud-source`, 19 email
  tests;
- the frozen Deno type-check of every cloud entry point, `npm audit` (0
  vulnerabilities);
- `engine:e2e`: 32 of 32 scenarios, including `firstSteps`, `teamAsk`,
  `appSettings`, `sandboxIsolation`, `filePatch` and `accounts`.

CI passed on the PR. The unsigned macOS preview **38598673783** passed on macOS 14, 15 and Intel.

## Supabase

The owner ran `timewarp/reports/deploy-1.2.6.ps1` on 14 October; the agent
wasn't allowed to apply migrations. Every step passed. The log is
`timewarp/reports/deploy-1.2.6.log` (not in git).

- Migrations, applied with `db query -f` plus `migration repair`:
  - `20261012150000_organization_shares` and `20261012160000_account_data_sync`
    (from 1.2.5);
  - `20261014120000_owner_scope_and_profile_columns`.
- The previous app writes `profiles` only through `user_id`, `email`,
  `name`, `interests`, `storage_preference`, `last_cloud_sync_at`,
  `work_stack` and `onboarded`, the columns that stay writable. No client
  reads the re-scoped tables directly; the cloud functions use the service
  role.
- Before this rollout, `timewarp-energy` was still the 1.2.4 deploy (12
  October). `timewarp-workspaces` (8 October), `auth-email-hook` (6
  October) and `contact` (7 October) were older.
- Deployed: `timewarp-workspaces` v46, `timewarp-energy` v31,
  `auth-email-hook` v43 and `contact` v44. The `timewarp-email-logo-v2.png`
  email logo was published.
- Backups are in `timewarp/reports/function-backup-before-1.2.6` (not in
  git). Before the deploy, all four live functions matched the 1.2.4 source.
- After the deploy:
  - the four downloaded functions match `main` file for file;
  - `/healthz` answers 200, calls without a session answer 401, and the
    logo answers 200;
  - the schema has the new tables, the new functions and the six scoped
    policies, and `profiles.created_at` is no longer writable.
- `stripe-billing`, `stripe-webhook` and `process-email-queue` have no changes
  since their last deploy.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.6-x64.msix`, built
from `e34b9c3`. It differs from the merge only in the test fix.

| | |
| --- | --- |
| Version | **1.2.6.0**, following 1.2.5.0 |
| Size | **346,123,572 bytes** |
| SHA256 | `559577a70ab3fda423dd8cc6f251c984652e85af2e13a4c41bce098ee8c7eaad` |
| Smoke test | sign-in after 6.7 s, 343 MB; a conversation through the bundled Codex in 218 ms |

The owner uploads it to Partner Center (Store ID `9N6WRN6GN0KR`).

## macOS and website

The signed run **38619478412** on `affbee3` passed on both architectures:
engine tests, signing, notarization, packaging and smoke tests.

| | Apple Silicon | Intel |
| --- | --- | --- |
| DMG | `Timewarp-1.2.6-arm64.dmg`, 270,411,478 bytes | `Timewarp-1.2.6-x64.dmg`, 286,905,409 bytes |
| DMG SHA256 | `c8205f112f4fcbb00c3bc60e803790b130af8e6304120845e1b329155ba2afa1` | `6aa317416be68b70d4d20a1e05d961742a628a662b5b759f7408781b8d67b5ad` |
| Notarization | `bbac39eb-27c1-469a-8869-c090c5551eb4`, Accepted | `e8a92a47-6d49-4e94-823b-8742cf65f0d2`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Update zip | `Timewarp-1.2.6-arm64-mac.zip`, 269,254,330 bytes | `Timewarp-1.2.6-x64-mac.zip`, 285,987,946 bytes |
| Zip SHA256 | `9f57183b812e8c79ac4b0e5622450409e73abc0a0846963a6f400c404613b818` | `c180111340a9d2f1afbd0f6cb44c9ab43d387c2824e456a21a924ab59ecb499c` |

Checks on the downloaded files:
- they match the hashes CI recorded;
- the SHA-512 in each `latest-mac-<arch>.yml` matches its zip;
- `merge-mac-update-info.cjs` joined the two into `latest-mac.yml`;
- `sha256sum -c SHA256SUMS.txt` passes.

Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.6.
It has the two DMGs, the two update zips, `latest-mac.yml` and
`SHA256SUMS.txt`. Through GitHub's redirect,
`releases/latest/download/latest-mac.yml` gives version 1.2.6, and both zips
and both DMGs answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.6
DMGs. Windows continues to use the Microsoft Store listing. This change also
brings the 1.2.4 release record (PR #17).

## Remaining limits

- 1.2.5's Mac build (signed run 38369216857) was never published; Macs go
  from 1.2.4 straight to 1.2.6.
- No real Mac has updated from 1.2.4 to 1.2.6 through the updater yet.
- Account sync, sharing and the new account calls haven't been exercised
  live with a signed-in account.
- The first-steps tour and the assistant import haven't been tried on a PC
  without MXC; the sandbox's automatic setup there is untested.
