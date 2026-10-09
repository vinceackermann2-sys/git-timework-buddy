"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const turns = import("../app/renderer/src/turns.mjs");

test("streaming events build the turn: deltas, items, reasoning, command output and completion", async () => {
  const { applyEvent, blocksOf, summarize } = await turns;
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
  const blocks = blocksOf(state[0]);
  assert.deepEqual(blocks.map(block => block.kind), ["user", "activity", "agent"]);
  assert.equal(summarize(blocks[1].items), "Ran 1 command");
});

test("worker threads, retried errors and aborts do not corrupt the visible turn", async () => {
  const { applyEvent } = await turns;
  let state = applyEvent([], "turn/started", { turn: { id: "t1" } });
  state = applyEvent(state, "item/started", { subAgent: true, turnId: "t1", item: { type: "agentMessage", id: "x", text: "worker" } });
  assert.equal(state[0].items.length, 0);
  state = applyEvent(state, "error", { turnId: "t1", willRetry: true, error: { message: "retrying" } });
  assert.equal(state[0].error, null);
  state = applyEvent(state, "turn/aborted", { reason: "Codex stopped." });
  assert.equal(state[0].status, "interrupted");
  assert.equal(state[0].error.message, "Codex stopped.");
});

test("restored cloud messages render without a local transcript", async () => {
  const { turnsFromMessages, blocksOf, userText } = await turns;
  const restored = turnsFromMessages([{ id: "1", authorId: "me", text: "Question" }, { id: "2", authorId: "agent", text: "Answer" }], "me");
  assert.equal(userText(blocksOf(restored[0])[0].item), "Question");
  assert.equal(blocksOf(restored[1])[0].item.text, "Answer");
});

test("activity summaries count files, tools, searches and workers", async () => {
  const { summarize } = await turns;
  assert.equal(summarize([{ type: "fileChange", changes: [{}, {}] }, { type: "mcpToolCall" }, { type: "webSearch" }, { type: "collabAgentToolCall" }]),
    "Changed 2 files · Used 1 tool · Searched the web · Coordinated a worker");
  assert.equal(summarize([{ type: "reasoning" }]), "Thought it through");
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
