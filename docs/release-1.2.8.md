# Timewarp 1.2.8 release record

Release work on 25 October 2026 (Europe/Stockholm).

## Source and validation

Release PR: https://github.com/vinceackermann2-sys/git-timework-buddy/pull/25,
merged as `63f6946`. It was built in the worktree
`release-apps-infrastructure-a199b6` from `origin/main` at `74cfaa9`, merging
six branches, each committed in its own worktree:

- `claude/logging-ui-required-fields-90cff7`, on top of PR #24
  (`claude/agent-id-onboarding`, which closed as merged with #25):
  - Agent ID in the app: one Agent page (mail, phone, wallet, card, computer,
    vault, connectors, automations, activity), the chat tools
    `agent_id_tools` and `agent_id`, and the Agent ID window for owner pages,
    the website sign-in (`POST /v1/account/web-session`) and identity checks;
  - backend connectors through Composio, synced automations (migration
    `20261024160000`) and a public `GET /v1/mcp/tools`;
  - request and action cards in the chat: MCP forms and agent questions,
    `[request]` log lines, cards for send, pay and delete (connected apps,
    Agent ID, page buttons, Enter in message boxes), a wallet card, a sidebar
    bell and `app_action`.
- `claude/agent-chat-login-performance-ed393f`: sign-ins started in a chat
  open as a tab of its pane; memory goes as three turn-context entries;
  snapshots skip repeated text; quiet automation runs skip the memory
  writer; prompt fixes for `composio_execute` and choice cards.
- `claude/cross-device-data-persistence-93a5d9`: non-UUID message ids
  (Claude's `msg_…`) map to stable UUIDs, so those chats sync; a chat
  continued on another computer comes back and its agent catches up; faster
  sync triggers.
- `claude/agent-chat-tools-fix-305f09`: `scripts/sign-mac.cjs` signs Codex's
  `codex`, `codex-app-server` and `codex-code-mode-host` with
  `assets/entitlements.codex.mac.plist` (allow-jit plus
  allow-unsigned-executable-memory), so GPT code-mode tools run on Intel
  Macs; the smoke test runs a code tool call.
- `claude/search-bar-visibility-chat-9e25a8`: the pane's new-tab button sits
  after the newest tab.
- `claude/supabase-timewarp-cleanup-ba49f5`: dead old-app code removed from
  `timewarp-workspaces`, `stripe-billing`, `stripe-webhook` and
  `_shared/credits.ts`; `timewarp-agent-mail-webhook` in the repo, trimmed to
  delivery reports; migration `20261024120000_remove_old_app_objects.sql`
  (see `docs/supabase-cleanup-2026-10-24.md`).

One merge conflict: the chat sign-in branch changed the old agent page's
reconnect in `Pane.jsx`, which the Agent ID work had moved to `AgentId.jsx`;
the change was applied there (`conversationId` passed to `ConnectorsView`).

Commits on top:
- `602c45e` sets 1.2.8 in `store.json` (after 1.2.7.0) and
  `mac-release.json`;
- `8a0835d` Electron 43.8.3, undici 6.29.1 and fast-uri 3.1.9: `npm audit`
  had started failing on advisories published after 1.2.7 (Electron's
  eMudhra certificate mitigation GHSA-jr5w-w6x2-84p9 among them);
- `7ba6167` removes a second `TIMEWARP_FIXTURE_DUMP` write the Agent ID
  branch had added to the preview fixture; it ignored `%n` and broke the
  `memoryContext` scenario.

Local validation on the merged branch:
- `npm run check`, 468 engine tests, the engine build and independence
  audit, 91 Agent ID CLI/SDK tests, `verify:cloud-source`, 19 email tests,
  the frozen Deno type-check of every cloud entry point (now including
  `timewarp-agent-mail-webhook`), `npm audit` (0 vulnerabilities);
- 831 portable tests, run two files at a time: with every file at once the
  PC (about 1 GB of free memory) failed whole files on
  `WebAssembly.Memory(): could not allocate memory` and `spawn UNKNOWN`;
- website: `tsc`, 129 tests, the build and `verify:website-build`;
- `engine:e2e`: 36 of 37 scenarios on the first run, then `memoryContext`
  after the fixture fix (and `accounts` again): all 37 have passed.

CI passed on the PR's last commit (source and website). The unsigned macOS
previews **40181783166** (Electron 43.7.7) and **40182205143** (43.8.3) passed
on macOS 14, 15 and Intel, including the new code-tool smoke step.

## Supabase

Live functions were backed up first (`timewarp/reports/live-before-1.2.8`,
not in git); each matched `74cfaa9`'s source.

Applied with `db query --linked -f` plus `migration repair`, all additive:
`20261021200000` (Bridge KYC), `20261021220000` (mascots, SEPA, KYB),
`20261021230000` (free compute), `20261022100000` (vault),
`20261022120000` (models), `20261022140000` (vault save),
`20261022160000` (ask first), `20261023100000` (model kind),
`20261023120000` (trace), `20261024160000` (automations).

Deployed with `--use-api`, JWT checks unchanged: `agent-id` v8,
`stripe-billing` v56, `stripe-webhook` v52, `timewarp-workspaces` v51,
`timewarp-agent-mail-webhook` v42. `timewarp-energy`, `auth-email-hook` and
`contact` have no changes and stay as deployed.

Checked live: `agent-id` healthz, 41 MCP tools including
`connectors_list`, `connector_tools`, `connector_run` and
`automations_list`, `/v1/config` with connectors available; the mail and
Stripe webhooks refuse unsigned requests (401 and 400).

Not run: the old-app removal (`20261024120000`, 13 functions, 47 tables,
3 buckets, 14 secrets). It runs through `cleanup-old-app.ps1`, which backs
everything up first.

## Windows

Package: `timewarp/build/engine-store/Timewarp-Store-1.2.8-x64.msix`, built
from `7ba6167` (the same tree as the merge).

| | |
| --- | --- |
| Version | **1.2.8.0**, following 1.2.7.0 |
| Size | **346,343,512 bytes** |
| SHA256 | `f286803cbb4b3bd5c0a4379703add5ddfc33cbc030cadab32945a71a0a999d48` |
| Smoke test | sign-in after 7.2 s, 332 MB (the PC had about 1 GB free); a conversation through the bundled Codex in 389 ms; a code tool call in 823 ms |

The owner uploads it to Partner Center (Store ID `9N6WRN6GN0KR`).

## macOS and website

The signed run **40184095292** on `63f6946` passed on both architectures:
engine tests, signing, notarization, packaging and smoke tests, which now
include a code tool call in the signed app (Intel: 291 ms; Apple Silicon:
157 ms). Stapling on the Intel runner needed retries (Error 68) and then
passed.

| | Apple Silicon | Intel |
| --- | --- | --- |
| DMG | `Timewarp-1.2.8-arm64.dmg`, 271,020,328 bytes | `Timewarp-1.2.8-x64.dmg`, 287,192,874 bytes |
| DMG SHA256 | `968af30e4ef9ee6d8d628e51568b93ffcc7ad0694f8068cbd5a31037d4204e21` | `484e9adf2ad8d41e9e233fd5c9d32ccfd4af8c4d4b6863aa78e8bde4aa3e0ba1` |
| Notarization | `f2315081-e68d-4777-8656-ee883b3bc0dc`, Accepted | `74759b21-6ec7-4521-805b-b2f7d12d9aa5`, Accepted |
| Stapled, Gatekeeper | yes, accepted | yes, accepted |
| Update zip | `Timewarp-1.2.8-arm64-mac.zip`, 269,900,656 bytes | `Timewarp-1.2.8-x64-mac.zip`, 286,295,265 bytes |
| Zip SHA256 | `9b7fd0ed98da1ad088393a0fbed71dcb4e51d8b4f45910bb6308d97c85974839` | `f701ee401847dbc04e3b5076aec635ec7b5f046ded8598a55b9acd48a0bccac6` |

Checks on the downloaded files:
- they match the hashes CI recorded;
- the SHA-512 in each `latest-mac-<arch>.yml` matches its zip;
- `merge-mac-update-info.cjs` joined the two into `latest-mac.yml`;
- `sha256sum -c SHA256SUMS.txt` passes.

Published release (latest):
https://github.com/vinceackermann2-sys/timewarp-releases/releases/tag/v1.2.8.
It has the two DMGs, the two update zips, `latest-mac.yml` and
`SHA256SUMS.txt`. Through GitHub's redirect,
`releases/latest/download/latest-mac.yml` gives version 1.2.8, and both zips
and both DMGs answer 200 with the expected sizes.

The website's `download-config.js` points `mac` and `macIntel` at the 1.2.8
DMGs. Windows continues to use the Microsoft Store listing.

## Remaining limits

- Real Composio calls from Agent ID connectors, and failed website
  automation requests, haven't been tried against live accounts.
- The chat sign-in and token savings haven't been measured with a live
  model.
- No real Mac has updated from 1.2.7 to 1.2.8 through the updater yet.
