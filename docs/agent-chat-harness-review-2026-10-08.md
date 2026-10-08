# Agent chat and harness review — 8 October 2026

The foundation is capable: a local Codex execution harness, real browser workers, native streaming, local transcripts, and an existing trace inspector. The most valuable improvements are reliable tool execution, bounded coordination, consistent completion reporting, and efficient history synchronization. A visual redesign is less urgent than making the existing interface accurately explain what happened.

## Scope and limits

- Inspected the current desktop/cloud source, the packaged native and renderer implementation, saved UI captures, and 14 session transcripts from `timewarp/backups/physical-harness-20261007-2205/sessions`.
- Ran 37 focused tests covering funding/catalog routing, history, cache accounting, browser launcher preparation, connector failures, and token refresh. All passed.
- This was a read-only product/code review apart from this report. No live paid inference, account changes, deployment, or application changes were performed.
- Saved transcripts and screenshots describe earlier builds. The 7 October verification report explicitly distinguishes local fixes from the installed Store app and deployed cloud function. This review does not establish their current publication status or prove a fresh end-to-end task succeeds.

## Subagents: yes, implemented and used

The saved `agents/energy-task.toml` enables `features.multi_agent_v2`, uses the `subagents` tool namespace, and sets `max_concurrent_threads_per_session = 10`. This is a session thread limit, not evidence that every task launches ten workers. `wait_agent_enabled = false` in that configuration.

The packaged harness defines a browser role exposed to spawning. It receives browser instructions, cannot delegate further, and leaves user communication to the parent. Background worker and memory-writer roles also exist, with delegation disabled. Saved transcripts additionally contain guardian/approval-review threads.

This is distinct from the persistent, named agents with mascots in the sidebar: those are configured assistants; browser subagents are temporary workers for an individual task. The session records demonstrate actual browser delegation, not just a dormant feature flag.

## Measured example: excessive coordination and retries

The saved RAM-shopping conversation rooted at `01a1174f-01f1-7e62-876c-f811f01fedc9` contains five recorded parent turns, three browser-worker spawns, thirteen `list_agents` calls, and four `send_to_agent` calls. One retry worker made 44 top-level execution-tool calls. The parent also spent tool calls on explicit sleeps.

Summing the last cumulative token-usage record from the parent, three browser workers, and three associated guardian sessions gives:

| Metric | Recorded amount |
| --- | ---: |
| Cumulative input tokens | 6,166,123 |
| Cached input tokens | 5,634,304 |
| Cached share of input | 91.4% |
| Output tokens | 29,373 |

These are repeated-request totals across a task tree, not a six-million-token context window. They are not a dollar bill or a representative production benchmark. Guardian usage and subscription funding must not be priced as ordinary Timewarp-credit requests without settlement evidence.

Caching is already doing useful work. The next target is unnecessary requests and recovery loops. Another saved acceptance run contains six explicit waits totaling 45 seconds; some underlying waiting was necessary, but generating separate model/tool turns just to wait is avoidable.

The parent sent an “opened tabs” message, then a correction that access was denied, then a verified-success update after the retry. The eventual success does not remove the earlier inconsistency. This is direct evidence for improving completion semantics.

## Priorities

### 1. Prove the repaired runtime works before tuning models

The 7 October report records WindowsApps launcher access failure, PowerShell syntax failure, token expiry, and a failed MCP-list route. Source fixes and focused tests exist. The live acceptance remained incomplete in that report.

Use an isolated profile to replay browser navigation, form submission/read-back, file creation/read-back/link, a connector read, token refresh, and history recovery. Record actual resulting state independently of the assistant's answer. Make tool availability a local preflight check so a model does not repeatedly rediscover a known broken launcher.

Evidence: `docs/harness-verification-2026-10-07.md`; `timewarp/desktop/harness-path.cjs`; `timewarp/scripts/harness.cjs`; `timewarp/tests/native-token.test.cjs`.

### 2. Reduce orchestration overhead

- Support direct execution for short browser operations; use browser workers for substantial research or independent work. The current patched instruction still normally delegates browser commands.
- Preserve one browser worker across related steps instead of creating another worker for each recovery attempt.
- Replace model-driven status polling and sleep loops with completion events or a supported blocking wait. The runtime already has task-tree lifecycle machinery; use it consistently.
- Add per-task limits for worker count, elapsed time, retries and cumulative usage. Start with a small concurrency allowance and measure completion quality before increasing it.
- Pass an explicit assignment, constraints, relevant state and expected evidence to workers. The observed spawns already use `fork_turns: "none"`; retain that useful isolation.

Evidence: saved task-role configuration and session transcripts; `timewarp/scripts/harness.cjs:13`.

### 3. Make completion and communication consistent

Use one task lifecycle across the chat, worker tree, activity display and final answer: queued, running, waiting for input, verifying, completed, failed, or cancelled. Finishing a model turn and successfully finishing the user's task must remain distinct.

Give workers a structured result with status, evidence, artifact links, blockers and remaining work. Require the parent to reconcile pending workers before making completion claims. Enforce explicit user retry/stop constraints at the controller boundary where practical, in addition to prompts.

The new stable execution instructions already address verification and bounded recovery. They are a good change, but the wrapper only appends them when `developerInstructions` is a string. Audit all entry paths, including base-instruction-only workers, before treating them as universal enforcement.

Evidence: `timewarp/desktop/harness-instructions.cjs:6`, `:25`; the saved no-delegation acceptance request and subsequent browser-worker spawn; the RAM task's successive status messages.

### 4. Route background work deliberately

The foreground default is already low effort for Timewarp-funded requests, and account-scoped catalog validation is an improvement. The inherited memory writer uses the `energy/lite` alias with high effort; the earlier live verification recorded a background request for an unavailable model.

Assign background summarization/memory a supported model and an explicit modest budget, coalesce writes, and back off after a non-retryable model-access failure. Route each role through the current account catalog and funding policy. Do not silently change the funding source. Escalate model/effort only when the task needs it and a measured evaluation supports it.

The current model resolver falls back to a featured/first model when an exact selection is unavailable. Record that substitution in diagnostics and communicate a material user-facing change instead of making it invisible.

Evidence: packaged memory-writer configuration; `timewarp/shared/model-capabilities.cjs:15`; `timewarp/desktop/codex-funding.cjs`; `docs/harness-verification-2026-10-07.md`.

### 5. Keep the existing trace inspector; improve its usefulness

The packaged renderer already has a trace dialog with **Tree / Waterfall** views and **Input / Cached / Output / Billed / Duration** columns, nested agents, and detail inspection. It also distinguishes approximate text-size estimates from actual model usage. This is a strong starting point, not missing infrastructure.

Add or verify one reconciled task-total view across parent, children and background work. Correlate conversation, task, thread, parent thread, turn, request and reservation identifiers. Show selected versus actual model, time to first useful output, tool time, retries, terminal outcome, cache usage and funding source. Keep reserved, estimated, settled and unknown costs distinct; unavailable subscription dollar cost must not appear as a known zero.

The local bridge deliberately discards inherited telemetry and completed-turn uploads. Preserve that content-privacy boundary. Keep detailed traces local and, if product monitoring is desired, introduce a separate minimal schema of timings, counters and error codes. Test both funding paths against the cost columns; the UI's presence alone does not establish accurate settlement reconciliation.

Evidence: packaged `thread-trace-dialog-CEq0TsQv.js`; `timewarp/desktop/bridge.cjs:36`; `timewarp/cloud/agentAiReservation.ts`; `timewarp/cloud/nativeResponses.ts`.

### 6. Change history sync to transfer changes

Every 30 seconds the desktop currently downloads every page of full chat history. A changed conversation also reuploads its full text history in bounded batches. Hashes avoid some processing/writes, but do not avoid the full download.

Use a stable revision cursor/change feed, metadata-first listings, lazy message loading and incremental entry uploads, with explicit conflict and deletion semantics. This reduces database, network and desktop work; it does not directly reduce inference-token charges.

Restoration recreates missing assistants with empty instructions and appends messages without native turn IDs. Tool traces, attachments and execution state are intentionally excluded. Present this as synced chat text, with device-local activity clearly identified; do not imply that a recovered chat restores the full runnable agent state. Consider syncing an explicitly approved assistant configuration separately.

Evidence: `timewarp/desktop/local-history.cjs:12`, `:15`, `:21`, `:26`, `:35`; `timewarp/cloud/nativeHistory.ts`.

### 7. Make cloud limits reflect the workload

The cloud stream forces a 16,384-token output ceiling and a 120-second total provider timeout. Reservation uses serialized UTF-8 bytes plus framing as a conservative input ceiling. This protects billing, but can hold substantially more allowance than a small request needs; it is a reservation, not the final charge.

Validate bounded caller/workload-specific limits, use the same limits for reservation and execution, and account for reasoning tokens. Separate idle-stream timeout, total task budget and cancellation. Keep conservative accounting and durable settlement recovery while measuring whether small requests are unnecessarily rejected by large temporary holds.

Evidence: `timewarp/cloud/nativeResponses.ts:14`; `timewarp/cloud/agentAiReservation.ts:3`.

## Chat appearance and visual consistency

The saved captures show a recognizable pastel palette, rounded surfaces, clear composer and mascot identity. The renderer already virtualizes the chat timeline, which is useful for long conversations. Preserve those foundations.

Recommended UI changes:

1. Keep the user's request and verified answer visually dominant. Group routine tool events in one expandable activity section per task, with the current step and elapsed time visible.
2. Nest browser workers beneath that task, with a short name and status. Retain Tree/Waterfall for detailed inspection rather than making raw trace density the default chat experience.
3. Use one persistent error/recovery row per failure, with the failing step and retry state. Do not let retries produce contradictory-looking completion messages.
4. Put verified files, browser results and sources in consistent result cards with usable links.
5. Use one vocabulary for chats/tasks, persistent agents and temporary workers. Saved screens currently mix “New Task” and “New conversation.” Make any distinction intentional and explainable.
6. Apply shared semantic colors and spacing to the trace inspector too; its inherited neutral/blue styling should fit the selected palette, while error/success states retain stable meaning.
7. On narrow windows, show status and the result first and move token/cost columns into details. Validate the full busy, failed, cancelled, restored and completed chat states in light/dark themes.

These are design recommendations based on source and saved captures, not a fresh interactive visual acceptance test. One older picker capture appears to disagree between the selected speed button and its caption; reproduce against the current build before filing it as a confirmed defect.

## Evaluation and rollout

Keep a small repeatable task set covering a factual answer, browser research, a form action, an artifact, a connector read, cancellation, stop-on-first-error, a long chat and cross-device restoration. Measure verified completion rate, correction rate, total task latency, time to first useful result, tool calls, retries, worker count, uncached/cached tokens, and settled cost where available.

Compare direct execution versus delegation and modest versus high reasoning on the same tasks. Optimize cost per correctly completed task. Do not claim savings percentages until these comparisons are measured.

This prioritization follows the general principles in OpenAI's [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization), [agent design guide](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/), and [agent evaluation guidance](https://developers.openai.com/api/docs/guides/agent-evals): reduce unnecessary calls, add orchestration when justified, and evaluate actual workflow outcomes.
