"use strict";
// The chat's activity logging, as the previous app showed it: messages only
// in the chat, a working line from the agent's interim notes, the agent
// thread's entries and tool rows, and friendly errors.
const test = require("node:test");
const assert = require("node:assert/strict");
const turns = import("../app/renderer/src/turns.mjs");

const at = (hours, minutes = 0, day = 9) => new Date(2026, 9, day, hours, minutes).getTime() / 1000;
const user = (id, text) => ({ type: "userMessage", id, content: [{ type: "text", text }] });
const reply = (id, text, phase = "final_answer") => ({ type: "agentMessage", id, text, phase });

test("the chat shows messages only: notes, thinking, plans and tools stay out", async () => {
  const { transcript } = await turns;
  const rows = transcript([{ id: "t1", status: "completed", startedAt: at(10), completedAt: at(10, 1), items: [
    user("u1", "Find the report"), { type: "reasoning", id: "r1", summary: ["Thinking"] }, reply("c1", "I'll look in the folder first.", "commentary"),
    { type: "commandExecution", id: "x1", command: "ls", status: "completed", commandActions: [] }, { type: "plan", id: "p1", text: "1. Look" }, reply("m1", "Here it is."),
  ] }]);
  assert.deepEqual(rows.map(row => [row.kind, row.sender, row.text]), [["message", "user", "Find the report"], ["message", "agent", "Here it is."]]);
});

test("separators: the day before the first message and after a day change, the time after half an hour", async () => {
  const { transcript, separatorLabel } = await turns;
  const rows = transcript([
    { id: "a", status: "completed", startedAt: at(9), completedAt: at(9), items: [user("u1", "One"), reply("m1", "Two")] },
    { id: "b", status: "completed", startedAt: at(9, 20), completedAt: at(9, 20), items: [user("u2", "Three")] },
    { id: "c", status: "completed", startedAt: at(10), completedAt: at(10), items: [user("u3", "Four")] },
    { id: "d", status: "completed", startedAt: at(8, 0, 10), completedAt: at(8, 0, 10), items: [user("u4", "Five")] },
  ]);
  assert.deepEqual(rows.map(row => row.separator), ["day", null, null, "time", "day"]);
  const now = new Date(2026, 9, 9, 18).getTime();
  assert.match(separatorLabel("day", at(9) * 1000, now), /^Today, 9:00/);
  assert.match(separatorLabel("day", at(9, 0, 8) * 1000, now), /^Yesterday, /);
  assert.doesNotMatch(separatorLabel("time", at(9) * 1000, now), /Today/);
});

test("runs of one sender group as first, middle and last", async () => {
  const { transcript } = await turns;
  const rows = transcript([{ id: "t", status: "completed", startedAt: at(9), completedAt: at(9), items: [user("u", "Hi"), reply("a", "One"), reply("b", "Two"), reply("c", "Three")] }]);
  assert.deepEqual(rows.map(row => row.group), ["single", "first", "middle", "last"]);
});

test("chats from the previous app show their send_message replies, not the internal final answers", async () => {
  const { transcript } = await turns;
  const sent = { type: "dynamicToolCall", id: "s1", tool: "send_message", status: "completed", success: true, arguments: { message: "Sent to you" },
    contentItems: [{ type: "inputText", text: JSON.stringify({ conversationId: "chat", messageId: "m", sequence: 1, sentAt: new Date(at(9, 5) * 1000).toISOString() }) }] };
  const elsewhere = { ...sent, id: "s2", arguments: { message: "Sent elsewhere" }, contentItems: [{ type: "inputText", text: JSON.stringify({ conversationId: "other", messageId: "n", sequence: 2 }) }] };
  const rows = transcript([{ id: "t", status: "completed", startedAt: at(9), completedAt: at(9, 6), items: [user("u", "Hi"), sent, elsewhere, reply("f", "Done: replied.")] }], { conversationId: "chat" });
  assert.deepEqual(rows.map(row => row.text), ["Hi", "Sent to you"]);
  assert.equal(rows[1].at, at(9, 5) * 1000);
});

test("events: automation runs replace their instructions, a scheduled automation, images, stopped reviews", async () => {
  const { transcript, runsLabel } = await turns;
  const image = { type: "imageGeneration", id: "g1", status: "completed", result: "A".repeat(80), savedPath: "C:/x/out.png" };
  const created = { type: "mcpToolCall", id: "k1", server: "timewarp_automations", tool: "create", status: "completed", arguments: { name: "Morning digest" } };
  const rows = transcript([
    { id: "r1", status: "completed", startedAt: at(7), completedAt: at(7), items: [user("i1", "Summarize my inbox"), reply("a1", "Done")] },
    { id: "r2", status: "completed", startedAt: at(8), completedAt: at(8), items: [user("i2", "Summarize my inbox")] },
    { id: "r3", status: "completed", startedAt: at(8, 1), completedAt: at(8, 1), items: [user("i3", "Summarize my inbox")] },
    { id: "t", status: "completed", startedAt: at(9), completedAt: at(9), reviews: [{ id: "v1", status: "approved", action: "ls" }, { id: "v2", status: "denied", action: "rm -rf x", rationale: "Deletes files." }],
      items: [user("u", "Schedule it and draw it"), created, image, reply("m", "Scheduled.")] },
  ], { runs: new Map([["r1", "Inbox"], ["r2", "Inbox"], ["r3", "Inbox"]]) });
  assert.deepEqual(rows.map(row => row.kind), ["runs", "message", "runs", "message", "event", "message", "review", "image"]);
  assert.equal(runsLabel(rows[0].counts), "Inbox ran 1 time");
  assert.equal(runsLabel(rows[2].counts), "Inbox ran 2 times");
  assert.equal(rows[4].text, "Scheduled Morning digest");
  assert.equal(rows[6].review.id, "v2", "Allowed reviews stay quiet");
});

test("the agent's state: running, paused with why, failed with friendly words, interrupted as Paused", async () => {
  const { threadState } = await turns;
  const live = [{ id: "t", status: "inProgress", items: [user("u", "Go")] }];
  assert.equal(threadState(live, { type: "active", activeFlags: [] }).status, "running");
  assert.deepEqual(threadState(live, { type: "active", activeFlags: ["waitingOnApproval"] }), { status: "paused", reason: "Waiting for approval" });
  assert.deepEqual(threadState(live, { type: "active", activeFlags: ["waitingOnUserInput"] }), { status: "paused", reason: "Waiting for input" });
  const failed = threadState([{ id: "t", status: "failed", error: { message: "x", additionalDetails: "ChatGPT did not begin responding in time.", codexErrorInfo: "other" }, items: [] }], { type: "idle" });
  assert.deepEqual(failed, { status: "failed", turnId: "t", error: { message: "ChatGPT didn't respond in time. Try again.", recovery: "retry" } });
  assert.equal(threadState([{ id: "t", status: "failed", error: null, items: [] }]).error.message, "Execution encountered a system error.");
  // Codex marks the thread systemError too; the turn's own error explains it.
  const capacity = { message: '{"error":{"message":"Selected model is at capacity.","type":"invalid_request_error"}}', codexErrorInfo: "other", additionalDetails: null };
  assert.equal(threadState([{ id: "t", status: "failed", error: capacity, items: [] }], { type: "systemError" }).error.message, "This model is at capacity. Choose another model in the composer, then try again.");
  assert.equal(threadState([{ id: "t", status: "interrupted", aborted: true, error: { message: "Codex stopped." }, items: [] }]).error.message, "Execution encountered a system error.");
  assert.equal(threadState([{ id: "t", status: "interrupted", error: null, items: [user("u", "Go")] }]).status, "interrupted");
  assert.equal(threadState([{ id: "t", status: "interrupted", error: null, items: [user("u", "Go"), reply("m", "Done")] }]).status, "completed", "A stop after the answer is complete");
  const undelivered = [{ id: "t", status: "completed", items: [] }, { id: "p", status: "failed", undelivered: true, error: { message: "No credits" }, items: [user("u", "Hi")] }];
  assert.equal(threadState(undelivered).status, "completed", "A message that wasn't sent doesn't fail the agent");
  assert.equal(threadState([{ id: "p", pending: true, status: "inProgress", items: [] }], null, true).status, "running");
  assert.deepEqual(threadState([{ id: "t", status: "inProgress", retrying: { message: "x" }, items: [] }], { type: "active", activeFlags: [] }).retrying, { message: "x" });
});

test("the working line is the first line of the latest note since the last message, as plain text", async () => {
  const { commentaryLine, plainLine } = await turns;
  const turn = items => [{ id: "t", status: "inProgress", items }];
  assert.equal(commentaryLine(turn([reply("c0", "Old note", "commentary"), user("u", "Next")])), null, "Notes before the latest message don't count");
  assert.equal(commentaryLine(turn([user("u", "Go"), reply("c1", "## Checking **the** [pricing](https://x.test) page\nmore", "commentary"), reply("c2", "", "commentary")])), "Checking the pricing page");
  assert.equal(commentaryLine([{ id: "t", status: "completed", items: [user("u", "Go"), reply("c", "Note", "commentary")] }]), null);
  assert.equal(plainLine("\n\n- `npm test` passed"), "npm test passed");
  assert.equal(plainLine("```\ncode\n```"), "code");
});

test("durations read 12s, 1m 5s, 2h 3m", async () => {
  const { formatDuration } = await turns;
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(12000), "12s");
  assert.equal(formatDuration(65000), "1m 5s");
  assert.equal(formatDuration(120000), "2m");
  assert.equal(formatDuration((2 * 3600 + 3 * 60) * 1000), "2h 3m");
  assert.equal(formatDuration(3600000), "1h");
});

test("turn errors in the previous app's words, with what the user can do", async () => {
  const { friendlyError } = await turns;
  const check = (error, message, recovery = null) => assert.deepEqual(friendlyError(error), { message, recovery });
  check({ message: "Selected model is at capacity." }, "This model is at capacity. Choose another model in the composer, then try again.", "retry");
  check({ message: "upstream: example_openai_quota_exhausted" }, "Our AI service is temporarily unavailable. This is on our side—we've been notified. Please try again later.", "retry");
  check({ message: "x", codexErrorInfo: "usageLimitExceeded" }, "This request needs additional credits to continue.", "addCredits");
  // A connected ChatGPT plan's limit, in the official Codex's words: no credits involved.
  const limit = "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 15th, 2026 2:07 PM.";
  check({ message: limit, codexErrorInfo: "usageLimitExceeded" }, "Your ChatGPT usage limit was reached. Try again at Oct 15th, 2026 2:07 PM.");
  check({ message: "You’ve hit your usage limit. To get more access now, send a request to your admin or try again in 3 hours.", codexErrorInfo: "usageLimitExceeded" }, "Your ChatGPT usage limit was reached. Try again in 3 hours.");
  check({ message: "You've hit your ChatGPT usage limit.", codexErrorInfo: "usageLimitExceeded" }, "Your ChatGPT usage limit was reached. Try again when it resets.");
  check({ message: "You’ve hit your usage limit for gpt-5.6-sol. Switch to another model now, or try again later.", codexErrorInfo: "usageLimitExceeded" }, "Your ChatGPT usage limit for this model was reached. Choose another model in the composer, then try again.");
  check({ message: "Your workspace is out of credits. Add credits to continue.", codexErrorInfo: "usageLimitExceeded" }, "Your workspace is out of credits. Add credits to continue.");
  // The bare wording without a ChatGPT plan's advice is the Timewarp cloud's: credits.
  check({ message: "You’ve hit your usage limit.", codexErrorInfo: "usageLimitExceeded" }, "This request needs additional credits to continue.", "addCredits");
  check({ message: "x", codexErrorInfo: "serverOverloaded" }, "The AI service is temporarily busy. Try again in a moment.", "retry");
  check({ message: "x", codexErrorInfo: "contextWindowExceeded" }, "This chat got too large to continue. Start a new chat or compact the thread.");
  check({ message: "x", codexErrorInfo: "unauthorized" }, "Your OpenAI session expired. Please sign in again.", "reconnectChatGPT");
  check({ message: "CHATGPT_AUTH_TOKEN_UNAVAILABLE" }, "Your ChatGPT account is connected, but we could not refresh its authorization. Reconnect ChatGPT to continue.", "reconnectChatGPT");
  check({ message: "x", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } }, "Couldn't reach OpenAI. Check your connection and try again.", "retry");
  check({ message: 'failed: {"error":{"code":"model_not_found"}}' }, "This model is unavailable. Choose another model in the composer, then try again.", "retry");
  check({ message: '{"error":{"type":"user_daily_usage_limit_reached","reason":"user_daily_spend","message":"Daily limit reached."}}' }, "Daily limit reached.");
  check({ message: "invalid_prompt" }, "This request was stopped by a safety check. Try a different prompt or start a new chat.");
  check({ message: "Something odd" }, "I couldn't complete that request.", "retry");
  assert.equal(friendlyError({ message: "x" }, true).message, "Connection lost. Reconnecting...");
});

test("tool rows: one line with the previous app's icon, title and detail", async () => {
  const { toolRow } = await turns;
  const pick = item => { const row = toolRow(item); return row && [row.icon, row.title, row.detail]; };
  assert.deepEqual(pick({ type: "commandExecution", command: '"C:\\\\windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "Get-Content a.txt"', commandActions: [{ type: "read" }] }), ["filePenLine", "", "Get-Content a.txt"]);
  assert.deepEqual(pick({ type: "commandExecution", command: "rg x", commandActions: [{ type: "search" }] }), ["search", "", "rg x"]);
  assert.deepEqual(pick({ type: "fileChange", changes: [{ path: "C:/w/notes.md", kind: { type: "add" } }] }), ["filePenLine", "Add", "notes.md"]);
  assert.deepEqual(pick({ type: "fileChange", changes: [{ path: "a", kind: { type: "update" } }, { path: "b", kind: { type: "delete" } }] }), ["filePenLine", "Changed 2 files", null]);
  assert.equal(toolRow({ type: "fileChange", changes: [] }), null);
  assert.deepEqual(pick({ type: "mcpToolCall", server: "timewarp_browser", tool: "click", arguments: { ref: "e3" } }), ["mousePointerClick", "Click", null]);
  assert.deepEqual(toolRow({ type: "mcpToolCall", server: "timewarp_browser", tool: "open", arguments: { url: "https://example.com/a" } }).pageUrl, "https://example.com/a");
  assert.deepEqual(pick({ type: "mcpToolCall", server: "timewarp_browser", tool: "close_tab", arguments: {} }), ["x", "Close Tab", null]);
  assert.deepEqual(pick({ type: "dynamicToolCall", namespace: "timewarp_browser", tool: "press", arguments: { key: "Enter" } }), ["keyboard", "Press", "Enter"]);
  assert.deepEqual(pick({ type: "mcpToolCall", server: "timewarp_vault", tool: "fill_sign_in", arguments: {} }), ["wrench", "Fill Sign In", null]);
  assert.deepEqual(pick({ type: "mcpToolCall", server: "timewarp_automations", tool: "run_now", arguments: {} }), ["wrench", "Run Now", null]);
  assert.deepEqual(toolRow({ type: "mcpToolCall", server: "timewarp_composio", tool: "composio_execute", arguments: { toolSlug: "GMAIL_SEND_EMAIL" } }), { icon: "wrench", title: "Send Email", detail: null, pageUrl: null, app: "gmail" });
  assert.deepEqual(pick({ type: "mcpToolCall", server: "github", tool: "list_issues", arguments: {} }), ["wrench", "Used github", "list_issues"]);
  assert.deepEqual(pick({ type: "dynamicToolCall", tool: "browser", arguments: { commands: [["screenshot"]], description: "Check the page" } }), ["camera", "Check the page", null]);
  assert.equal(toolRow({ type: "dynamicToolCall", tool: "send_message", arguments: {} }), null);
  assert.deepEqual(pick({ type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["a", "b"] }), ["bot", "Start agent", "2 agents"]);
  assert.deepEqual(pick({ type: "collabAgentToolCall", tool: "wait", receiverThreadIds: ["a"] }), ["timer", "Wait for agent", "1 agent"]);
  assert.deepEqual(pick({ type: "subAgentActivity", kind: "started", agentPath: "/root/helper" }), ["gitBranch", "started", "helper"]);
  assert.deepEqual(pick({ type: "webSearch", query: "q", action: { type: "open_page", url: "https://a.test" } }), ["globe", "Open", "https://a.test"]);
  assert.deepEqual(pick({ type: "webSearch", query: "q", action: { type: "find_in_page", url: "https://a.test", pattern: "price" } }), ["compass", "Find text", "price · https://a.test"]);
  assert.deepEqual(pick({ type: "webSearch", query: "weather", action: { type: "search", queries: ["weather oslo"] } }), ["search", "Search", "weather oslo"]);
  assert.deepEqual(pick({ type: "sleep", durationMs: 500 }), ["refreshCcw", "Waiting", "500 ms"]);
  assert.deepEqual(pick({ type: "contextCompaction" }), ["refreshCcw", "Compacted context", null]);
  assert.deepEqual(pick({ type: "imageGeneration", savedPath: "x.png" }), ["fileImage", "Generated image", null]);
  assert.equal(toolRow({ type: "reasoning" }), null);
});

test("agent thread entries: the chat's agent lists its notes; a worker its input, notes, results and tools", async () => {
  const { threadEntries, groupEntries } = await turns;
  const history = [{ id: "t", status: "completed", startedAt: at(9), items: [
    user("u", "Check the site"), reply("c", "Opening it", "commentary"), { type: "mcpToolCall", id: "o", server: "timewarp_browser", tool: "open", arguments: { url: "https://a.test" } },
    { type: "mcpToolCall", id: "s", server: "timewarp_browser", tool: "snapshot", arguments: {} }, { type: "reasoning", id: "r", summary: [] }, reply("f", "It works", null),
  ] }];
  assert.deepEqual(threadEntries(history).map(entry => entry.kind), ["commentary"]);
  const entries = threadEntries(history, { worker: true });
  assert.deepEqual(entries.map(entry => entry.kind), ["input", "commentary", "tool", "tool", "output"]);
  assert.deepEqual(groupEntries(entries).map(group => Array.isArray(group) ? group.length : group.kind), ["input", "commentary", 2, "output"]);
});

test("a reply finds the message it quotes; a scheduled automation names the one it made", async () => {
  const { transcript, quotedMessage } = await turns;
  const answer = "Here is the plan:\n\n1. Book flights\n2. Pack";
  const rows = transcript([
    { id: "t1", status: "completed", startedAt: at(9), completedAt: at(9), items: [user("u1", "Plan my trip"), reply("a1", answer), reply("a2", "Anything else?")] },
    { id: "t2", status: "completed", startedAt: at(10), completedAt: at(10), items: [user("u2", "> Here is the plan:\n>\n> 1. Book flights\n> 2. Pack\n\nWhy flights first?"),
      { type: "dynamicToolCall", id: "k", namespace: "timewarp_automations", tool: "create", status: "completed", success: true, arguments: { name: "Daily brief" }, contentItems: [{ type: "inputText", text: "Created:\nauto-42 | Daily brief | on | {} | last never | next soon\n  Brief me" }] }] },
  ]);
  assert.equal(quotedMessage(rows, 3, "Here is the plan:\n\n1. Book flights\n2. Pack"), "a1");
  assert.equal(quotedMessage(rows, 3, "Something never said"), null);
  assert.equal(quotedMessage(rows, 1, "Anything else?"), null, "Only earlier messages");
  assert.deepEqual(rows.at(-1).automation, { id: "auto-42", name: "Daily brief" });
});

test("stored messages keep their files and skills; agent messages from the previous app keep theirs", async () => {
  const { turnsFromMessages, transcript, userSkills, userFiles } = await turns;
  const restored = turnsFromMessages([
    { id: "m1", authorId: "me", text: "Use $pdf", images: ["/shots/a.png"], files: ["/docs/report.pdf", "gone.xlsx"], skills: [{ name: "pdf", path: "/s/SKILL.md" }] },
    { id: "m2", authorId: "agent", text: "", files: ["/out/summary.docx"] },
  ], "me");
  const rows = transcript(restored);
  assert.deepEqual(rows.map(row => row.sender), ["user", "agent"], "A message with only files still shows");
  assert.deepEqual(rows[0].item.files, ["/docs/report.pdf", "gone.xlsx"]);
  assert.deepEqual(userFiles(rows[0].item), ["report.pdf", "gone.xlsx"]);
  assert.deepEqual(userSkills(rows[0].item), [{ name: "pdf", path: "/s/SKILL.md" }]);
  assert.deepEqual(rows[1].item.files, ["/out/summary.docx"]);
  // Imported attachments listed as { path, contentType }.
  const [imported] = turnsFromMessages([{ id: "m3", authorId: "me", text: "See", attachments: [{ path: "/x/p.jpg", contentType: "image/jpeg" }, { path: "/x/notes.txt" }] }], "me");
  assert.deepEqual([imported.items[0].files, imported.items[0].content.filter(part => part.type === "localImage").map(part => part.path)], [["/x/notes.txt"], ["/x/p.jpg"]]);
});

test("citation marks are left out of the working line and quotes, even half-written", async () => {
  const { commentaryLine, plainQuote } = await turns;
  const working = { id: "t", status: "inProgress", items: [user("u", "Go"), reply("c", "Prices rose 4%\uE200cite\uE202turn1search1\uE201 this week", "commentary")] };
  assert.equal(commentaryLine([working]), "Prices rose 4% this week");
  assert.equal(plainQuote("Done \uE200cite\uE202turn0"), "Done");
});

test("trace events: approximate tokens (bytes ÷ 4) and the subagents an event started", async () => {
  const { approxTokens, shortCount, workerThreads } = await turns;
  assert.deepEqual(approxTokens(user("u", "12345678")), { input: 2, output: null });
  assert.deepEqual(approxTokens(reply("a", "héllo")), { input: null, output: 2 }, "UTF-8 bytes");
  assert.deepEqual(approxTokens({ type: "commandExecution", command: "ls", aggregatedOutput: "a".repeat(40) }), { input: 10, output: 1 });
  assert.deepEqual(approxTokens({ type: "imageView" }), { input: null, output: null });
  assert.deepEqual([shortCount(940), shortCount(1234), shortCount(null)], ["940", "1.2k", ""]);
  assert.deepEqual(workerThreads({ type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["w1", "w1", "w2"] }), ["w1", "w2"]);
  assert.deepEqual(workerThreads({ type: "collabAgentToolCall", tool: "wait", receiverThreadIds: ["w1"] }), [], "Only where they started");
});

test("a new agent's introduction request isn't shown; the chat opens with the agent's introduction", async () => {
  const { transcript } = await turns;
  const rows = transcript([{ id: "t1", status: "completed", startedAt: at(10), completedAt: at(10, 1), items: [
    user("u", "<agent-introduction>This is a new chat with a new agent. Introduce yourself.</agent-introduction>"),
    reply("a", "Hi, I'm Tao. I can research, write and use your apps."),
  ] }]);
  assert.deepEqual(rows.filter(row => row.kind === "message").map(row => row.sender), ["agent"]);
});
