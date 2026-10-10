"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const turns = import("../app/renderer/src/turns.mjs");

test("streaming events build the turn: deltas, items, reasoning, command output and completion", async () => {
  const { applyEvent, transcript } = await turns;
  let state = [];
  state = applyEvent(state, "turn/started", { threadId: "t", turn: { id: "turn-1" } });
  state = applyEvent(state, "item/started", { turnId: "turn-1", item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "Hi" }] } });
  state = applyEvent(state, "item/reasoning/summaryTextDelta", { turnId: "turn-1", itemId: "r1", delta: "Plan", summaryIndex: 0 });
  state = applyEvent(state, "item/reasoning/summaryTextDelta", { turnId: "turn-1", itemId: "r1", delta: "ning", summaryIndex: 0 });
  state = applyEvent(state, "item/started", { turnId: "turn-1", item: { type: "commandExecution", id: "c1", command: "ls", status: "inProgress", aggregatedOutput: null } });
  state = applyEvent(state, "item/commandExecution/outputDelta", { turnId: "turn-1", itemId: "c1", delta: "a.txt\n" });
  state = applyEvent(state, "item/completed", { turnId: "turn-1", item: { type: "commandExecution", id: "c1", command: "ls", status: "completed", aggregatedOutput: "a.txt\n", exitCode: 0 } });
  // A delta can arrive before its item/started event.
  state = applyEvent(state, "item/agentMessage/delta", { turnId: "turn-1", itemId: "m1", delta: "Hel" });
  state = applyEvent(state, "item/started", { turnId: "turn-1", item: { type: "agentMessage", id: "m1", text: "" } });
  state = applyEvent(state, "item/agentMessage/delta", { turnId: "turn-1", itemId: "m1", delta: "lo" });
  assert.equal(state[0].items.find(item => item.id === "m1").text, "Hello");
  assert.deepEqual(state[0].items.find(item => item.id === "r1").summary, ["Planning"]);
  state = applyEvent(state, "turn/completed", { threadId: "t", turn: { id: "turn-1", status: "completed", items: [], error: null } });
  assert.equal(state[0].status, "completed");
  assert.equal(state[0].items.length, 4, "Completion keeps the streamed items");
  // Tools and thinking stay out of the chat; the messages remain.
  assert.deepEqual(transcript(state).map(row => row.sender), ["user", "agent"]);
});

test("worker threads, retried errors and aborts do not corrupt the visible turn", async () => {
  const { applyEvent } = await turns;
  let state = applyEvent([], "turn/started", { turn: { id: "t1" } });
  state = applyEvent(state, "item/started", { subAgent: true, turnId: "t1", item: { type: "agentMessage", id: "x", text: "worker" } });
  assert.equal(state[0].items.length, 0);
  state = applyEvent(state, "error", { turnId: "t1", willRetry: true, error: { message: "retrying" } });
  assert.equal(state[0].error, null);
  assert.deepEqual(state[0].retrying, { message: "retrying" }, "A retried error shows as reconnecting");
  state = applyEvent(state, "item/agentMessage/delta", { turnId: "t1", itemId: "m", delta: "Back" });
  assert.equal(state[0].retrying, null, "The next event of the turn clears it");
  state = applyEvent(state, "turn/aborted", { reason: "Codex stopped." });
  assert.equal(state[0].status, "interrupted");
  assert.equal(state[0].error.message, "Codex stopped.");
  assert.equal(state[0].aborted, true);
});

test("restored cloud messages render without a local transcript", async () => {
  const { turnsFromMessages, transcript } = await turns;
  const restored = turnsFromMessages([{ id: "1", authorId: "me", text: "Question" }, { id: "2", authorId: "agent", text: "Answer" }, { id: "3", authorId: "me", text: "Lost", status: "failed" }], "me");
  assert.deepEqual(transcript(restored).map(row => [row.sender, row.text, !!row.undelivered]), [["user", "Question", false], ["agent", "Answer", false], ["user", "Lost", true]]);
});

test("automatic approval reviews attach to their turn with a readable action", async () => {
  const { applyEvent } = await turns;
  let state = applyEvent([], "turn/started", { turn: { id: "t1", startedAt: 1 } });
  const action = { type: "command", source: "shell", command: '"C:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Remove-Item -Force x"', cwd: "C:\w" };
  state = applyEvent(state, "item/autoApprovalReview/started", { threadId: "th", turnId: "t1", reviewId: "r1", review: { status: "inProgress" }, action });
  state = applyEvent(state, "item/autoApprovalReview/completed", { threadId: "th", turnId: "t1", reviewId: "r1", review: { status: "denied", riskLevel: "high", rationale: "Deletes files." }, action });
  state = applyEvent(state, "guardianWarning", { threadId: "th", message: "Automatic approval review denied." });
  assert.deepEqual(state[0].reviews, [{ id: "r1", status: "denied", risk: "high", rationale: "Deletes files.", action: "Remove-Item -Force x" }]);
  assert.deepEqual(state[0].warnings, ["Automatic approval review denied."]);
  assert.equal(applyEvent(state, "item/autoApprovalReview/completed", { turnId: "unknown", reviewId: "r2", review: {}, action }), state, "Reviews for unknown turns are ignored");
});

test("a chat opened as its reply finishes keeps the finished turn from events, with the most of each message", async () => {
  const { mergeTurns, threadState } = await turns;
  // Loaded while the turn ran; meanwhile its end streamed in and it completed.
  const loaded = [{ id: "t1", status: "inProgress", startedAt: 1, items: [{ type: "userMessage", id: "u1", content: [] }, { type: "agentMessage", id: "m1", text: "Hello wor" }] }];
  const streamed = [{ id: "t1", status: "completed", error: null, plan: null, items: [{ type: "agentMessage", id: "m1", text: "ld" }, { type: "agentMessage", id: "m2", text: "Done.", completedAtMs: 5 }] }, { id: "pending-x", pending: true, status: "inProgress", items: [] }];
  const merged = mergeTurns(loaded, streamed);
  assert.deepEqual(merged.map(turn => [turn.id, turn.status]), [["t1", "completed"], ["pending-x", "inProgress"]]);
  assert.deepEqual(merged[0].items.map(item => item.text ?? null), [null, "Hello wor", "Done."]);
  assert.equal(merged[0].startedAt, 1);
  assert.equal(threadState(merged.slice(0, 1), null, false).status, "completed");
  // Events still running leave the loaded turn as it is, with what streamed added.
  const running = mergeTurns(loaded, [{ id: "t1", status: "inProgress", items: [{ type: "agentMessage", id: "m1", text: "Hello world, this is longer" }] }]);
  assert.deepEqual([running[0].status, running[0].items[1].text], ["inProgress", "Hello world, this is longer"]);
});

test("a reply shows the message it quotes apart from its text", async () => {
  const { replyParts } = await turns;
  assert.deepEqual(replyParts("> Your flight leaves at 9.\n> Gate B4.\n\nCan you book a taxi?"), { quote: "Your flight leaves at 9.\nGate B4.", text: "Can you book a taxi?" });
  assert.deepEqual(replyParts("> Quoted only\n\n"), { quote: "Quoted only", text: "" });
  assert.deepEqual(replyParts("Plain message"), { quote: null, text: "Plain message" });
  assert.deepEqual(replyParts("> not a reply\nwithout a blank line"), { quote: null, text: "> not a reply\nwithout a blank line" });
});

test("a quoted reply shows as plain text, without Markdown marks", async () => {
  const { plainQuote } = await turns;
  assert.equal(plainQuote("**Done.** Here it is:\n\n- [Report](https://example.com/r) in `out/`\n\n```js\nrun();\n```"), "Done. Here it is:\nReport in out/\nrun();");
  assert.equal(plainQuote("snake_case_name stays"), "snake_case_name stays");
});

test("a message that was not sent keeps its files and images for Retry, and the working line skips waiting messages", async () => {
  const { turnsFromMessages, transcript, userFiles, userImages, commentaryLine } = await turns;
  const [turn] = turnsFromMessages([{ id: "m1", authorId: "me", text: "Read these", status: "failed", images: ["C:\\shots\\a.png"], files: ["C:\\docs\\report.pdf"] }], "me");
  assert.deepEqual(turn.message, { text: "Read these", images: ["C:\\shots\\a.png"], files: ["C:\\docs\\report.pdf"] });
  const [row] = transcript([turn]);
  assert.deepEqual([row.text, userFiles(row.item), userImages(row.item), row.undelivered], ["Read these", ["report.pdf"], ["C:\\shots\\a.png"], true]);
  const working = { id: "t1", status: "inProgress", items: [{ type: "userMessage", id: "u", content: [] }, { type: "agentMessage", id: "c", phase: "commentary", text: "Checking flights" }] };
  assert.equal(commentaryLine([working, { id: "pending-1", pending: true, status: "inProgress", items: [{ type: "userMessage", id: "p", content: [] }] }]), "Checking flights");
});

