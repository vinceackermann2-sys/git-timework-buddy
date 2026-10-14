"use strict";
// How agents working together show in the chat: another agent's message as
// that agent's (never the user's), "Asked Nova" in the chat that asked, the
// team and app tools in the agent thread, and the usage card.
const test = require("node:test");
const assert = require("node:assert/strict");
const { agentMessage } = require("../app/main/team-tools.cjs");
const turns = import("../app/renderer/src/turns.mjs");
const cards = import("../app/renderer/src/cards.mjs");

const peerText = agentMessage({ from: { id: "agent-2", name: "Nova" }, conversation: { id: "chat-b", title: "Budget" }, hop: 1, mode: "ask", request: { at: "2026-10-14T09:00:00.000Z", source: "user", text: "Plan it" }, body: "Is 900 euros **enough**?" });

test("another agent's message shows as that agent's, with the chat it came from", async () => {
  const { transcript } = await turns;
  const rows = transcript([{ id: "turn-1", startedAt: 1760000000, status: "completed", items: [
    { type: "userMessage", id: "u1", content: [{ type: "text", text: peerText }] },
    { type: "agentMessage", id: "a1", text: "Yes, 900 is enough.", phase: "final_answer" },
  ] }]);
  const [peer, reply] = rows.filter(row => row.kind === "message");
  assert.equal(peer.sender, "peer");
  assert.equal(peer.text, "Is 900 euros **enough**?");
  assert.deepEqual({ ...peer.peer, body: undefined }, { agentId: "agent-2", name: "Nova", conversationId: "chat-b", title: "Budget", mode: "ask", body: undefined });
  assert.equal(reply.sender, "agent");
});

test("a restored chat shows another agent's stored message as that agent's too", async () => {
  const { transcript, turnsFromMessages } = await turns;
  const restored = turnsFromMessages([{ id: "m1", authorId: "agent-2", createdAt: "2026-10-14T09:00:00.000Z", text: peerText, status: "sent" }], "user-1");
  assert.equal(restored[0].items[0].type, "userMessage");
  assert.equal(transcript(restored)[0].sender, "peer");
});

test("a message sent or a question asked shows as an event that opens that chat", async () => {
  const { transcript } = await turns;
  const call = (tool, result, extra = {}) => ({ type: "mcpToolCall", id: "call-" + tool, server: "timewarp_team", tool, status: "completed", arguments: {}, result: { content: [{ type: "text", text: JSON.stringify(result) }] }, ...extra });
  const rows = transcript([{ id: "turn-1", startedAt: 1760000000, status: "completed", items: [
    call("ask", { agent: "Nova", conversationId: "chat-b", status: "answered", answer: "Yes" }),
    call("send_message", { delivered: true, agent: "Orbit", conversationId: "chat-c" }),
    call("ask", { agent: "Nova" }, { id: "failed", status: "failed", error: { message: "refused" } }),
    call("list_agents", { agents: [] }),
  ] }]);
  assert.deepEqual(rows.filter(row => row.kind === "event").map(row => [row.text, row.chat?.id]), [["Asked Nova", "chat-b"], ["Messaged Orbit", "chat-c"]]);
});

test("team and app tools have their own lines in the agent thread", async () => {
  const { toolRow } = await turns;
  const line = (server, tool) => toolRow({ type: "mcpToolCall", server, tool, arguments: {} }).title;
  assert.equal(line("timewarp_team", "ask"), "Asked an agent");
  assert.equal(line("timewarp_team", "list_agents"), "Checked agents");
  assert.equal(line("timewarp_app", "get_usage"), "Checked usage");
  assert.equal(line("timewarp_app", "change_settings"), "Asked to change settings");
});

test("the usage card is a block card, and only Timewarp's wrapper counts as another agent's message", async () => {
  const { parseCards, agentMessageOf } = await cards;
  const { cards: found } = parseCards("Here's where you stand:\n\n<usage />\n\nMore below.");
  assert.deepEqual(found.map(card => [card.tag, card.block]), [["usage", true]]);
  assert.equal(agentMessageOf("Hello <agent-message from-name=\"Nova\">"), null, "only a message that starts with it");
  assert.equal(agentMessageOf(peerText).body, "Is 900 euros **enough**?");
});
