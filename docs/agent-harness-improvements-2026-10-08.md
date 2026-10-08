# Agent harness implementation and verification — 8 October 2026

## Delivery scope

Implemented in the desktop source and an isolated **Timewarp Preview** staging build. The installed app, working app, published Git history, and production cloud function have not been replaced. The cloud changes are staged, backward compatible, and type checked; they still need deployment to affect production traffic.

## Changes

- **Visible subagents:** a collapsible panel in chat lists workers, their current state, and recent activity. Selecting a worker opens its existing detailed activity pane. The Activity button exposes the authenticated Tree/Waterfall inspector without requiring the debug feature flag. JSON/debug export retains its separate gate.
- **Consistent state:** working, needs input, failed, stopping, stopped, and finished remain distinct. The panel explains that a finished worker turn is not proof of task success. Disconnects show reconnecting. Counters are scoped to the current session; unavailable dollar cost is not reported as zero.
- **Bounded execution:** parent Stop interrupts its workers. A direct “Stop after the first tool error” instruction is enforced at the native notification boundary. Repeated tool failures, a 200-event tool budget, and a 20-minute run budget interrupt runaway work. These defaults are configurable in the controller. The UI keeps the reason visible.
- **Native event compatibility:** the controller consumes `item/toolCall/completed`, nonzero command exits, and `subAgentActivity` announcements. This matters because a blocked command can have no normal execution item, and a worker can start without a separate `thread/started` event. Completion announcements cannot restart a finished worker or leave its task timer running. Historical token totals are not counted as new usage after resume, and interrupted requests label their token totals partial.
- **Approval failures:** a denied review or native guardian failure now stops the whole task tree immediately. Workers cannot spend further turns trying alternate commands or keyboard actions after that rejection. The stopping reason points to the existing activity details.
- **Privacy false-positive fix:** native `client_metadata` is discarded on-device before privacy scanning. Live diagnostics proved that a 13-digit `turn_started_at_unix_ms` timestamp sometimes passed Luhn and caused approval review to fail. The cloud also discards that unused field for older clients. Prompts and tool results retain the same payment-data and secret checks; those checks were not relaxed.
- **Task instructions:** simple browser work can run directly; substantial independent work can use workers. Instructions require preserving user constraints, using a small worker count, reusing workers, using `wait_agent`, avoiding status polling, verifying results, and reporting unfinished work accurately. Independent workers are instructed to use `fork_turns: "none"`. The session concurrency limit is four including the parent.
- **Windows fixes:** workspace-write requests use the native named `:workspace` permission profile while retaining the selected approval reviewer. Browser guidance covers PowerShell 5 syntax and quoting `@e1` selectors, which PowerShell otherwise treats as splatting. Page-text guidance avoids an unnecessary extra interactive-only snapshot.
- **Background work:** memory requests resolve to a supported Luna where available, with low reasoning effort and no priority tier. A terminal AI error triggers a one-minute background cooldown without blocking foreground chat. Funding does not silently fall back from a connected subscription to paid credits.
- **History:** metadata manifests replace repeated full downloads on supporting servers. Only changed conversations are fetched, and only new/changed entries are uploaded. Renames can upload metadata alone. Failed deltas retry. Older cloud servers retain compatibility. Privacy mode and owner filters remain enforced.
- **Cloud efficiency:** the Responses entry point now preserves the prompt cache key and bounded caller output limit. Reservation and execution use the same output limit. Streaming and nonstreaming settlement preserve cache usage details. The existing conservative input reservation remains in place.

## Measured results

The deterministic 1,000-message history fixture measured **772,628 bytes for a full snapshot versus 738 bytes for the new-message delta**, a **99.90% reduction** for that update. An unchanged one-chat fixture returned a 105-byte manifest rather than a 758-byte full response. Unchanged manifests triggered no message fetch.

These are network payload measurements, not inference-cost savings or end-to-end latency benchmarks. They do not include HTTP framing. Metadata manifests still scan all pages; this is not a revision-cursor implementation. Existing append/merge and deletion semantics remain unchanged.

## Automated and native verification

- **207 automated tests passed**, including the existing regression suite and new controller, history, routing, privacy, approval-stop, native completion evidence, and cloud-boundary checks. Output: `timewarp/reports/harness-tests.txt`.
- The exact staged ASAR passed build parity/integrity checks and the original desktop schema contracts.
- The staged executable started successfully with an empty profile; its authentication screen, preload bridge, Electron version, and ASAR integrity passed native startup acceptance.
- The cloud mirror passed source parity for all 11 modules and Deno type checking with `--node-modules-dir=none`.
- The browser launcher ran through the real native read-only command sandbox. A native thread creation probe confirmed that the adapted workspace permission is actually `workspaceWrite` with the `:workspace` profile.
- Packaged browser acceptance passed navigation, typing, clicking, shared app/harness tab state, profile isolation, hidden-page access, and a **quoted browser ref executed through PowerShell**. One earlier concurrent run suffered a Chromium network-process crash; the isolated rerun passed.
- The component extracted from the packaged renderer passed follow-worker callbacks, collapse/expand, live state transitions, reconnect handling, stop acknowledgement, and light/dark/narrow layouts without horizontal overflow. This is a component integration test, not a full signed-in UI automation run.

Activity-panel preview: `timewarp/reports/task-activity-880-light.png` (synthetic workers); dark and narrow variants are saved alongside it.

## Live model evidence

The native client, its roles, browser gateway, current instruction wrapper, funding wrapper, and execution controller were exercised with disposable cloud accounts. Credentials remained in memory. Each run had a fixed request ceiling and fixture credit allowance; all completed fixture cleanups revoked the login and deleted the test account. No customer chats or connected accounts were used.

The combined run in `timewarp/.temp/live-harness-JnMmex/result.json` established:

| Check | Result |
| --- | --- |
| Write a file, read it back, return a link | Passed; 22.3 seconds |
| Respect “Do not delegate” | Passed; zero workers |
| Stop after the first error | Passed; controller interrupted the run after a rejected tool |
| Observe a real browser worker | Passed; parent/child identity and usage captured |
| Complete the delegated browser form | Failed in this run; unquoted PowerShell refs and approval failures were observed |

The first-error live case encountered an approval-review privacy rejection before the requested missing-file command ran. It proves stopping after the rejected tool; the ordinary nonzero-exit case is covered by a separate controller test.

That combined run debited **15.266568 test credits**, including its failed browser work and approval review. It is not a cost-per-success claim. Earlier runs exposed a read-only compatibility mismatch, an approval-stalled patch, and insufficient temporary reservation headroom. The retry and time limits stopped those runs. These failures are retained as evidence rather than counted as successful task completion.

The next browser-only run (`live-harness-hqScAo`) submitted the form, but did not finish reporting it before the fixture budget stopped it. Its redacted diagnostics isolated the timestamp false positive. It debited 16.60322 test credits. This is retained as a failed completion check, not counted as success. The final full acceptance rerun uses the actual local bridge, including metadata removal, and additionally checks child-before-parent completion, `wait_agent` without polling, and the parent reporting the verified code. It is recorded in `timewarp/reports/harness-live.json`.

After metadata removal, `live-harness-yCX2Bj` independently passed file creation/read-back/link, no delegation, actual command-error stopping, and browser submission/read-back/parent completion. Browser duration was 96.2 seconds; all three tasks together debited 10.986776 test credits. The original test incorrectly expected the final-message phase `final`; the pinned binary emits `final_answer`. Rechecking the immutable recording with the corrected predicate passed. A regression test now covers that phase and rejects completion before the worker. The same recording exposed the completed-worker timer bug described above; the final package includes that correction.

## Remaining limits

- A finite acceptance set cannot prove universal instruction following or answer quality. The runtime safeguards and explicit completion evidence reduce specific failure modes; they do not replace task evaluations.
- Cloud cache-key/output-limit changes are not yet deployed, so live inference above used the existing production cloud implementation. No general latency or inference-cost improvement percentage is claimed.
- Actual sensitive input and insufficient unreserved credits can still block approval review. The telemetry timestamp false positive is fixed in the desktop bridge and staged cloud source. Review failures remain visible and stop the run. The input reservation is deliberately conservative and can substantially exceed the final charge.
- Current-session agent counters include execution wrapper events. Approval-review usage is not fully reconciled into those counters. The detailed inspector and billing ledger remain separate sources of evidence.
- History recovery restores chat text and display metadata, not local tools, files, native execution state, or assistant instructions.
- The staged Windows app is an unsigned draft. It has not been published to the Store or distributed to users.

The native permission-field change was checked against the running binary and the [official app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs). Supabase account creation and cleanup used the [admin user APIs](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## Final status

**Passed on the final staged package.** Build SHA-256: `a09dea0878e917839f285b63f121accebc5fd42ee1ed483ce5ef364328845e2e`. Native startup, build/source parity, schema contracts, 207 automated tests, and worker-panel interaction/layout checks passed.

The final real-model acceptance (`live-harness-O88E4g`) and its independent recording audit both passed:

| Task | Verified result | Elapsed time |
| --- | --- | ---: |
| Create a file without delegation | Exact saved contents, tool read-back, absolute clickable link, zero workers | 16.4 s |
| Stop on the first error | One actual failing file-read command, immediate interruption, no retry or forbidden artifact | 15.3 s |
| Delegate browser verification | One worker, independently confirmed form submission, read-back, worker completion before parent completion, parent reports the correct code | 113.9 s |

The browser task had zero tool failures, used `wait_agent` without `list_agents` polling, and finished with a stopped task timer. The three tasks together used 35 model requests and debited **13.737172 test credits**, including approval review. The disposable account was logged out and deleted. Evidence: `timewarp/reports/harness-live.json` and `timewarp/reports/harness-recording.json`.

The history payload reduction is a repeatable efficiency measurement. Live runs establish the specific task outcomes above; differing tool choices and timing across runs mean they do **not** establish a general percentage improvement in inference cost, latency, or answer quality. Broader comparisons need repeated matched tasks. The completed local preview is at `timewarp/build/native/Timewarp.exe`; production cloud deployment and distribution are still outstanding.
