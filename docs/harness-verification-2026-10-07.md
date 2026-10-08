# Agent harness verification — 7 October 2026

## Findings and fixes

- **Browser execution failure reproduced in the installed app.** The live agent
  reported `Program 'browser.exe' failed to run: Åtkomst nekad`. Direct execution
  of the Store-packaged launcher returned `EPERM`. The native browser itself
  passed its interaction tests. The failure is at the WindowsApps executable
  boundary, before the authenticated browser gateway.
- **Launcher preparation implemented.** Windows startup copies only the shipped
  browser, nango, and rg launchers into a content-addressed harness directory,
  verifies existing copies, preserves multicall executable names, and places
  this directory first on PATH. Existing versions are retained for running
  processes. Sandbox and gateway authentication remain in force.
- **Installed-app PATH workaround proved insufficient.** Live replay showed
  the old desktop overrides `shell_environment_policy.set.PATH` on the Codex
  command line. That takes precedence over config.toml. Launcher preparation
  alone therefore does not repair ordinary `browser` commands in Store 1.1.24.
  The corrected build changes that command-line PATH at its source. The launcher
  verification now reproduces this command-line configuration, not merely a
  config-file override. `repair-installed-browser.cjs` now prepares binaries
  without claiming that an installed-app restart fixes command selection.
- **Task-completion instructions added to the build.** They require read-back
  evidence before success, preservation of user stop conditions during handoff,
  bounded recovery, links to created files, and accurate capability claims.
  The instructions are stable and idempotent to avoid growing repeated context.
  Their effect on model behavior still needs a successful live replay.
- **Windows browser instructions corrected.** A live browser worker used `&&`
  under Windows PowerShell 5, so parsing failed before browser execution. The
  rebuilt browser role receives platform-specific shell instructions. The
  unconditional browser-delegation rule now allows an explicit user request
  to work directly; the old build's rule contradicted that acceptance test.
- **One-hour native authentication failure corrected.** The local token
  endpoints returned rotating cloud JWTs to native clients. Those cached tokens
  stopped authenticating against the local bridge after refresh. Both endpoints
  now return the existing device capability, which survives same-user refresh
  and is revoked on sign-out. An integration test advances the clock through
  JWT expiry and verifies both behaviors. This fix is in the staged build.
- **Cache accounting corrected in source.** Streaming settlement now preserves
  provider cache read/write counts. Supported Sol/Luna pricing partitions input
  into ordinary, cached, and cache-write tokens rather than charging all input
  at the ordinary rate. Budget reservation covers worst-case cache writes, and
  durable settlement retries preserve the calculated cost. Cloud source is
  staged but was **not deployed** by this verification.
- **Connector failure reporting corrected in source.** Explicit inactive status
  now takes precedence on both cards and tool access; status-only active accounts
  work consistently. A provider's `successful: false`, `success: false`, or
  `isError: true` is propagated as an MCP error rather than a successful action.
- **MCP tab failure reproduced and routing corrected.** The installed app showed
  `No "query"-procedure on path "product.integrations.mcps.list"`. The renderer
  sent this hosted-list query to the native router, which does not expose it.
  The build now routes that exact read query to the authenticated local bridge's
  existing empty hosted-list response. Native MCP server discovery remains in
  the device manager. A regression test verifies the response and authentication
  without contacting the cloud; build acceptance verifies the renderer route.

Pricing references: [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching),
[Azure caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching).
Verified rates on the review date: cache reads 0.1 times and cache writes 1.25
times ordinary input. Existing long-context multipliers remain in effect.

## Validation

- Full desktop test suite: 186 passing, including cache accounting, launcher
  upgrades, connector status consistency, and provider-declared failures.
- Patched package integrity and native wire-schema checks passed.
- Packaged browser acceptance passed: shared app/harness state, navigation,
  snapshots, input, clicks, hidden-page access, profile isolation, and gateway
  authentication. It now exercises the prepared launcher path.
- A real Codex `command/exec` with a **read-only sandbox** successfully executed
  the prepared Store launcher and reached its authenticated gateway boundary.
  The test uses the desktop's command-line PATH override and performs no
  inference or user-account access.
- Native agent creation passed: mascot selection, create payload, upload
  switching, busy/reset behavior, and light/dark/narrow layouts.
- Connector routing/MCP tests passed: cards and account state mapping, native
  authorization surface, ownership/access checks, cancelled startup, and errors.
  These are fixture tests, not proof that every user's third-party account is
  authorized or every remote provider is healthy.
- Cloud type check and editable/staged source parity passed.

Local detailed results: `timewarp/reports/harness-tests.txt`,
`browser-native.json`, `harness-launcher.json`, and `agents-ui.json`.

## Live checks and remaining limits

The initial live chat correctly reported the browser failure, but attempted
additional diagnostics despite a stop-on-first-error instruction. After Codex
reconnection, another live test stopped accurately on the PowerShell parse
error. A corrected-shell replay stopped accurately on Access denied. Neither
reached the verification page or created the requested file. The independent
fixture still records zero visits. These are failed baselines, not end-to-end
passes. Subsequent chat delivery encountered the native token expiry defect.

The installed build exposes browser, shell, and file tools but **no native
Windows desktop GUI-control tool**. Native computer use requires a supported
Windows automation integration and separate acceptance; it is not fixed by the
browser launcher repair.

Launching the preview against the existing profile encountered unreadable
encrypted settings and required sign-in. The preview was stopped; encrypted
files/backups were preserved and the Store app reopened. Timewarp sign-in and
Codex reconnection later completed. Future preview checks must use an isolated
profile. No auth dialog was automated. The corrected app build is local; the
Store package and cloud have not been republished. Installed-app logs also show
the background memory worker requesting `gpt-6.1-sol`, which this connected
account rejects. That background-model issue remains unresolved.

Live connector UI checks confirmed the Tools dropdown and catalog render,
Gmail appears in Connected, and the catalog has Featured/All/Connected tabs.
The MCP tab failed as described above. No account access was changed and no
message was sent through a connector. These observations do not validate remote
provider execution or the corrected MCP tab in the installed Store build.

**Conversation metadata recovery completed on the actual profile.** Initial
checks were misleading because Codex's MSIX filesystem virtualization exposed
a private overlay of Timewarp's roaming profile. Its stale database/WAL files
did not represent the installed Timewarp process's files. Do not use those
earlier checks as evidence of the current physical profile's integrity.

Timewarp was stopped and its actual databases, WAL/SHM files, agent definitions,
and transcripts were backed up via a detached Windows process to
`timewarp/backups/physical-harness-20261007-2205`. Offline checks confirmed that
`state_5.sqlite` was malformed and `thread_history_1.sqlite` was healthy.
Rebuilding a separate home from that backup successfully read all 39 saved
conversation metadata records, with 94 active-chat turns and 627 items. All
archived conversations remained archived in the test.

Only the physical `state_5.sqlite` and its sidecars were moved aside to
`original-state-index` in that backup. Timewarp rebuilt the metadata index from
its original transcripts on restart. The previously failing Elon conversation
then opened in the live UI without the red native-details error. The healthy
history database, transcripts, and credentials were preserved. Saved originals
remain available for recovery; no conversation transcripts were deleted.

The final UI replay was interrupted by the computer-control helper error
`foreground window did not report a process id`, repeated after a fresh window
lookup. No further native inputs were issued. Therefore the full live browser,
file-link, and connector execution acceptance remains unfinished.

## Repeatable commands

Run from `timewarp`:

```powershell
node --test tests/*.test.cjs
node scripts/build.cjs --stage
node scripts/verify-build.cjs --staged
node scripts/verify-contracts.cjs
node scripts/verify-browser.cjs
node scripts/verify-harness-launcher.cjs
node scripts/verify-agents.cjs
node scripts/verify-history-recovery.cjs --source backups/physical-harness-20261007-2205
deno check --config cloud/deno.json cloud/nativeResponses.ts
node scripts/verify-cloud-source.cjs
```

`node scripts/harness-fixture.cjs` starts a temporary loopback-only page. Ask an
agent to read its random code, fill the field, click Verify task, read the status,
save that status to a disposable workspace file, and show the file link. The
fixture records the actual browser submission independently of the agent's
completion text. It expires after 30 minutes.
