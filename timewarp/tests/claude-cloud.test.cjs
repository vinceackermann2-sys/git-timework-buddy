"use strict";
// Claude models in the cloud: pricing, the Responses ↔ Messages conversion,
// streaming and metering, on every plan.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

// A cloud module run with its imports given as bindings; its exports become
// properties of the returned context. A dynamic import calls loadModule.
function moduleOf(file, bindings = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { mode: "strip" }).replace(/^import[^\n]*\n/gm, "").replace(/export const /g, "var ").replace(/export /g, "").replace(/\bimport\(/g, "loadModule(");
  const context = vm.createContext(bindings);
  vm.runInContext(source, context);
  return context;
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const plain = value => JSON.parse(JSON.stringify(value));
const costs = moduleOf("cloud/aiCost.ts");
const { responseOutputLimit } = moduleOf("cloud/agentAiReservation.ts");
const route = moduleOf("cloud/claudeAgentAi.ts", { Deno: { env: { get: () => "fixture-key" } } });

class APIError extends Error { constructor(status, error, message, headers) { super(message); this.status = status; this.error = error; this.headers = headers; } }
// The cloud's Claude module with a scripted Anthropic client, loaded the
// first time a request needs it (`loads` counts that); `clock` replaces Date.now.
function claudeModule({ create = async () => { throw new Error("unused"); }, count = async () => { throw new Error("unused"); }, reserve, reserved = [], finished = [], pending = [], loads = [], key = route.claudeKey, clock } = {}) {
  class Anthropic { constructor(options) { this.options = options; this.beta = { messages: { create: (params, options) => create(params, options), countTokens: (params, options) => count(params, options) } }; } }
  return moduleOf("cloud/claudeResponses.ts", {
    loadModule: async name => { loads.push(name); if (name !== "npm:@anthropic-ai/sdk@0.128.0") throw new Error("Unexpected module " + name); return { default: Anthropic }; },
    responseOutputLimit, claudeKey: key, claudeRoute: route.claudeRoute, assertCloudSafe: require("../shared/privacy.cjs").assertCloudSafe,
    reserveAgentAi: reserve || (async (_admin, _user, model, body, bounds) => { reserved.push({ model, body: plain(body), bounds }); return { id: "r" + reserved.length, finish: async (...args) => { finished.push([model, ...args]); } }; }),
    TextEncoder, TextDecoder, btoa, atob, crypto, ReadableStream, Response, AbortSignal, console, EdgeRuntime: { waitUntil: value => pending.push(value) },
    ...(clock ? { Date: { now: clock } } : {}),
  });
}
async function* events(list) { for (const event of list) yield event; }
const start = (id, usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }) => ({ type: "message_start", message: { id, usage } });
const block = (index, content_block, deltas = []) => [{ type: "content_block_start", index, content_block }, ...deltas.map(delta => ({ type: "content_block_delta", index, delta })), { type: "content_block_stop", index }];
const end = (stop_reason, usage = { output_tokens: 5 }, stop_details) => [{ type: "message_delta", delta: { stop_reason, ...(stop_details ? { stop_details } : {}) }, usage }, { type: "message_stop" }];
const parse = text => text.split("\n\n").filter(Boolean).map(chunk => JSON.parse(chunk.split("\n").find(line => line.startsWith("data: ")).slice(6)));

test("Claude usage is priced with each model's cache rates, Haiku's long prompts and Fast mode", () => {
  const cost = costs.computeCostUsd;
  // 100K prompt: 10K fresh, 80K cache reads, 10K cache writes; 1K output.
  const details = { cached_tokens: 80000, cache_write_tokens: 10000 };
  near(cost("anthropic/claude-fable-5-1", 100000, 1000, details), (10000 + 80000 * 0.025 + 10000 * 1.25) / 1e6 * 10 + 1000 / 1e6 * 50);
  near(cost("anthropic/claude-opus-5-5", 100000, 1000, details), (10000 + 80000 * 0.05 + 10000 * 1.25) / 1e6 * 4 + 1000 / 1e6 * 20);
  near(cost("anthropic/claude-opus-5-5-fast", 100000, 1000, details), (10000 + 80000 * 0.05 + 10000 * 1.25) / 1e6 * 8 + 1000 / 1e6 * 40);
  near(cost("anthropic/claude-opus-5-5-fast", 100000, 1000, { ...details, speed: "standard" }), cost("anthropic/claude-opus-5-5", 100000, 1000, details));
  near(cost("anthropic/claude-sonnet-5-5", 100000, 1000, details), (10000 + 80000 * 0.05 + 10000 * 1.25) / 1e6 * 2 + 1000 / 1e6 * 10);
  near(cost("anthropic/claude-haiku-5-5", 100000, 1000), 100000 / 1e6 * 0.1 + 1000 / 1e6 * 0.5);
  near(cost("anthropic/claude-haiku-5-5", 100001, 1000), 100001 / 1e6 * 0.5 + 1000 / 1e6 * 2.5);
  assert.throws(() => cost("anthropic/claude-opus-5", 1, 1), error => error.status === 503, "an unpriced model is never funded");
});

test("extra high and max thinking get a larger output allowance", () => {
  assert.equal(responseOutputLimit({ reasoning: { effort: "high" } }), 16384);
  assert.equal(responseOutputLimit({ reasoning: { effort: "xhigh" } }), 32768);
  assert.equal(responseOutputLimit({ reasoning: { effort: "max" }, max_output_tokens: 40000 }), 32768);
  assert.equal(responseOutputLimit({ reasoning: { effort: "max" }, max_output_tokens: 1000 }), 1000);
});

test("the desktop's model names route to Claude, with Fast only on Opus 5.5", () => {
  assert.deepEqual(plain(route.claudeRoute("anthropic/claude-opus-5-5")), { id: "anthropic/claude-opus-5-5", model: "claude-opus-5-5", fast: false, billing: "anthropic/claude-opus-5-5" });
  assert.deepEqual(plain(route.claudeRoute("anthropic/claude-opus-5-5-fast")), { id: "anthropic/claude-opus-5-5", model: "claude-opus-5-5", fast: true, billing: "anthropic/claude-opus-5-5-fast" });
  assert.equal(route.claudeRoute("anthropic/claude-haiku-5-5-fast").fast, false);
  assert.equal(route.claudeRoute("anthropic/claude-fable-5-1").model, "claude-fable-5-1");
  assert.equal(route.claudeRoute("anthropic/claude-sonnet-5-5").model, "claude-sonnet-5-5");
  for (const name of ["openai/gpt-5.6-sol", "claude-opus-5-5", "anthropic/claude-opus-5", undefined]) assert.equal(route.claudeRoute(name), null);
});

test("a Codex request becomes a Messages request with the system prompt, tools, thinking and effort", () => {
  const claude = claudeModule();
  const thinking = claude.encodeThinking([{ type: "thinking", thinking: "Plan — ü", signature: "SIG" }]);
  const body = {
    model: "anthropic/claude-opus-5-5", instructions: "BASE", reasoning: { effort: "xhigh", summary: "detailed" }, parallel_tool_calls: true, tool_choice: "auto",
    tools: [
      { type: "function", name: "exec_command", description: "Run", strict: false, parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } },
      { type: "namespace", name: "multi_agent_v1", tools: [{ type: "function", name: "spawn_agent", description: "Spawn", parameters: { type: "object", properties: {} } }] },
      { type: "custom", name: "apply_patch", description: "Patch", format: { type: "grammar", syntax: "lark", definition: "start: x" } },
      { type: "web_search", external_web_access: false },
    ],
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "AGENT" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context/>" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
      { type: "reasoning", summary: [], encrypted_content: thinking },
      { type: "reasoning", summary: [], encrypted_content: "gAAAA-openai-reasoning" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Working." }] },
      { type: "function_call", call_id: "toolu_1", name: "spawn_agent", namespace: "multi_agent_v1", arguments: "{\"task\":\"x\"}" },
      { type: "custom_tool_call", call_id: "toolu_2", name: "apply_patch", input: "*** Begin Patch" },
      { type: "function_call_output", call_id: "toolu_1", output: "started" },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "<timewarp_memory>NOTES</timewarp_memory>" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Next" }] },
    ],
  };
  const { params, tools } = claude.claudeRequest(route.claudeRoute(body.model), body, "account");
  const request = plain(params);
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.max_tokens, 32768);
  assert.deepEqual(request.thinking, { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  assert.deepEqual(request.output_config, { effort: "xhigh" });
  assert.deepEqual(request.betas, ["thinking-binding-controls-2026-08-01"]);
  assert.equal(request.speed, undefined);
  assert.deepEqual(request.metadata, { user_id: "account" });
  assert.deepEqual(request.cache_control, { type: "ephemeral" });
  assert.deepEqual(request.system, [{ type: "text", text: "BASE", cache_control: { type: "ephemeral" } }, { type: "text", text: "AGENT", cache_control: { type: "ephemeral" } }], "developer messages before the chat join the system prompt");
  assert.deepEqual(request.tools.map(tool => tool.name), ["exec_command", "multi_agent_v1__spawn_agent", "apply_patch"], "hosted tools are left out");
  assert.equal(request.tools[0].strict, undefined);
  assert.deepEqual(request.tools[2].input_schema.required, ["input"]);
  assert.match(request.tools[2].input_schema.properties.input.description, /start: x/);
  assert.deepEqual(request.tool_choice, { type: "auto", disable_parallel_tool_use: false });
  assert.deepEqual(plain(tools.byClaude.get("multi_agent_v1__spawn_agent")), { name: "spawn_agent", namespace: "multi_agent_v1", custom: false });
  assert.deepEqual(request.messages, [
    { role: "user", content: [{ type: "text", text: "<environment_context/>" }, { type: "text", text: "Hello" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "Plan — ü", signature: "SIG" }, { type: "text", text: "Working." },
      { type: "tool_use", id: "toolu_1", name: "multi_agent_v1__spawn_agent", input: { task: "x" } }, { type: "tool_use", id: "toolu_2", name: "apply_patch", input: { input: "*** Begin Patch" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "started" }, { type: "tool_result", tool_use_id: "toolu_2", content: "No result was recorded for this call.", is_error: true },
      { type: "text", text: "<timewarp_memory>NOTES</timewarp_memory>" }, { type: "text", text: "Next" }] },
  ], "Claude's thinking replays exactly, OpenAI's is left out, every call has a result and later context stays in place");
  assert.equal(claude.isClaudeReasoning({ type: "reasoning", encrypted_content: thinking }), true);
  assert.equal(claude.isClaudeReasoning({ type: "reasoning", encrypted_content: "gAAAA" }), false);
});

test("the conversion only appends, so the prompt cache and earlier thinking stay valid", () => {
  const claude = claudeModule();
  const first = [{ type: "message", role: "developer", content: [{ type: "input_text", text: "AGENT" }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }];
  const reply = [{ type: "reasoning", summary: [], encrypted_content: claude.encodeThinking([{ type: "thinking", thinking: "", signature: "S1" }]) },
    { type: "function_call", call_id: "c1", name: "exec_command", arguments: "{\"cmd\":\"dir\"}" }, { type: "function_call_output", call_id: "c1", output: [{ type: "input_text", text: "a.txt" }, { type: "input_image", image_url: "https://example.com/x.png" }] }];
  const later = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }, { type: "message", role: "developer", content: [{ type: "input_text", text: "<model_switch>…</model_switch>" }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "Again" }] }];
  const request = input => plain(claude.claudeRequest(route.claudeRoute("anthropic/claude-sonnet-5-5"), { instructions: "BASE", tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }], input }).params);
  const a = request(first), b = request([...first, ...reply]), c = request([...first, ...reply, ...later]);
  assert.deepEqual(b.messages.slice(0, a.messages.length), a.messages);
  assert.deepEqual(c.messages.slice(0, b.messages.length), b.messages);
  assert.deepEqual([a.system, a.tools], [c.system, c.tools]);
  assert.deepEqual(b.messages[2].content[0].content, [{ type: "text", text: "a.txt" }, { type: "image", source: { type: "url", url: "https://example.com/x.png" } }]);
  assert.deepEqual(c.messages.at(-1), { role: "user", content: [{ type: "text", text: "<model_switch>…</model_switch>" }, { type: "text", text: "Again" }] });
  assert.equal(c.output_config, undefined, "no effort leaves the model's default");
});

test("Claude's stream becomes Responses events; tool calls arrive once the turn is done", () => {
  const claude = claudeModule();
  const tools = claude.claudeTools([{ type: "namespace", name: "multi_agent_v1", tools: [{ type: "function", name: "wait_agent" }] }, { type: "custom", name: "apply_patch" }]);
  const translated = claude.responsesTranslator(tools.byClaude, "anthropic/claude-opus-5-5");
  const out = [start("msg_1", { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 4000, output_tokens: 1 }),
    ...block(0, { type: "thinking", thinking: "", signature: "" }, [{ type: "thinking_delta", thinking: "Think" }, { type: "signature_delta", signature: "SIG" }]),
    ...block(1, { type: "text", text: "" }, [{ type: "text_delta", text: "Hi" }]),
    ...block(2, { type: "tool_use", id: "toolu_a", name: "multi_agent_v1__wait_agent", input: {} }, [{ type: "input_json_delta", partial_json: "{\"targets\":[]}" }]),
    ...block(3, { type: "tool_use", id: "toolu_b", name: "apply_patch", input: {} }, [{ type: "input_json_delta", partial_json: "{\"input\":\"PATCH\"}" }]),
    ...block(4, { type: "redacted_thinking", data: "OPAQUE" }),
    ...end("tool_use", { output_tokens: 50 })].flatMap(event => translated.event(event)).concat(translated.end());
  const types = out.map(event => event.type);
  assert.equal(types[0], "response.created");
  assert.equal(types.at(-1), "response.completed");
  assert.ok(types.indexOf("response.output_item.done", types.lastIndexOf("response.output_text.done")) < types.indexOf("response.function_call_arguments.done"));
  const items = out.filter(event => event.type === "response.output_item.done").map(event => event.item);
  assert.deepEqual(items.map(item => item.type), ["reasoning", "message", "reasoning", "function_call", "custom_tool_call"]);
  assert.deepEqual(plain(claude.decodeThinking(items[0].encrypted_content)), [{ type: "thinking", thinking: "Think", signature: "SIG" }]);
  assert.deepEqual(plain(items[0].summary), [{ type: "summary_text", text: "Think" }]);
  assert.deepEqual(plain(claude.decodeThinking(items[2].encrypted_content)), [{ type: "redacted_thinking", data: "OPAQUE" }]);
  assert.deepEqual(plain(items[3]), { type: "function_call", id: "fc_toolu_a", status: "completed", call_id: "toolu_a", name: "wait_agent", namespace: "multi_agent_v1", arguments: "{\"targets\":[]}" });
  assert.equal(items[4].input, "PATCH");
  const completed = out.at(-1).response;
  assert.deepEqual(plain(completed.usage), { input_tokens: 5100, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 1000 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 5150 });
  assert.deepEqual(plain(completed.output.map(item => item.type)), ["reasoning", "message", "function_call", "custom_tool_call", "reasoning"], "the final output keeps Claude's order");
});

test("a reply cut off by its length limit runs no tool call, and a refusal says so in the chat", () => {
  const claude = claudeModule();
  const tools = claude.claudeTools([{ type: "function", name: "exec_command" }]);
  let translated = claude.responsesTranslator(tools.byClaude, "anthropic/claude-haiku-5-5");
  let out = [start("msg_2"), ...block(0, { type: "tool_use", id: "t1", name: "exec_command", input: {} }, [{ type: "input_json_delta", partial_json: "{\"cmd\":\"rm" }]), ...end("max_tokens")]
    .flatMap(event => translated.event(event)).concat(translated.end());
  assert.ok(!out.some(event => event.type === "response.output_item.done"));
  assert.equal(out.at(-1).type, "response.incomplete");
  assert.equal(out.at(-1).response.incomplete_details.reason, "max_output_tokens");
  translated = claude.responsesTranslator(tools.byClaude, "anthropic/claude-fable-5-1");
  out = [start("msg_3"), ...block(0, { type: "tool_use", id: "t2", name: "exec_command", input: {} }, [{ type: "input_json_delta", partial_json: "{\"cmd\":\"dir\"}" }]), ...end("refusal", { output_tokens: 3 }, { type: "refusal", category: "cyber" })]
    .flatMap(event => translated.event(event)).concat(translated.end());
  const items = out.filter(event => event.type === "response.output_item.done").map(event => event.item);
  assert.deepEqual(items.map(item => item.type), ["message"], "the refused turn's tool call doesn't run");
  assert.match(items[0].content[0].text, /declined.*cybersecurity/);
  assert.equal(out.at(-1).type, "response.completed");
  translated = claude.responsesTranslator(tools.byClaude, "anthropic/claude-fable-5-1");
  translated.event(start("msg_4"));
  assert.equal(translated.end()[0].type, "response.failed", "a stream without its closing delta is a failure");
});

test("a streamed Claude reply is metered from Anthropic's usage, even when the desktop stops reading", async () => {
  const reserved = [], finished = [], pending = [];
  let sent, options;
  const claude = claudeModule({ reserved, finished, pending, create: async (params, given) => { sent = plain(params); options = given; return events([start("msg_5", { input_tokens: 200, cache_creation_input_tokens: 300, cache_read_input_tokens: 5000, output_tokens: 1 }), ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "Hello" }]), ...end("end_turn", { output_tokens: 40 })]); } });
  const body = { model: "anthropic/claude-opus-5-5-fast", stream: true, reasoning: { effort: "low" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] }] };
  const response = await claude.claudeStream({}, "owner", body, { "x-cors": "1" });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(pending);
  assert.equal(sent.stream, true);
  assert.equal(sent.speed, "fast");
  assert.deepEqual(sent.betas, ["thinking-binding-controls-2026-08-01", "fast-mode-2026-02-01"]);
  assert.deepEqual(sent.output_config, { effort: "low" });
  assert.match(sent.metadata.user_id, /^[0-9a-f]{32}$/);
  assert.ok(options.signal, "the stream has a time limit");
  assert.equal(reserved[0].model, "anthropic/claude-opus-5-5-fast");
  assert.equal(reserved[0].bounds.outputTokens, 16384);
  assert.deepEqual(plain(finished), [["anthropic/claude-opus-5-5-fast", "settled", 5500, 40, { cached_tokens: 5000, cache_write_tokens: 300 }]]);
});

test("Fast mode falls back to the standard speed, and thinking from another account is left out", async () => {
  const reserved = [], finished = [], calls = [];
  const replies = [new APIError(429, { error: { type: "rate_limit_error" } }, "429 fast mode rate limited"), new APIError(400, { error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block" } }, "400"),
    events([start("msg_6"), ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "OK" }]), ...end("end_turn")])];
  const claude = claudeModule({ reserved, finished, create: async params => { calls.push(plain(params)); const next = replies.shift(); if (next instanceof Error) throw next; return next; } });
  const thinking = claude.encodeThinking([{ type: "thinking", thinking: "", signature: "OTHER-ACCOUNT" }]);
  const body = { model: "anthropic/claude-opus-5-5-fast", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] }, { type: "reasoning", encrypted_content: thinking }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hey" }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "Again" }] }] };
  const result = await claude.claudeCall({}, "owner", body);
  assert.equal(result.status, "completed");
  assert.equal(result.output[0].content[0].text, "OK");
  assert.deepEqual(calls.map(call => [call.speed ?? "standard", call.messages[1].content.map(part => part.type).join(",")]), [["fast", "thinking,text"], ["standard", "thinking,text"], ["standard", "text"]]);
  assert.deepEqual(reserved.map(entry => entry.model), ["anthropic/claude-opus-5-5-fast", "anthropic/claude-opus-5-5", "anthropic/claude-opus-5-5"]);
  assert.deepEqual(finished.map(entry => entry.slice(0, 2)), [["anthropic/claude-opus-5-5-fast", "released"], ["anthropic/claude-opus-5-5", "released"], ["anthropic/claude-opus-5-5", "settled"]]);
});

test("Anthropic errors before the reply map to clear messages and release the reservation", async () => {
  const finished = [];
  const fail = error => claudeModule({ finished, create: async () => { throw error; } }).claudeCall({}, "owner", { model: "anthropic/claude-sonnet-5-5", input: "Hi" });
  await assert.rejects(fail(new APIError(529, {}, "overloaded")), error => error.status === 503 && /overloaded/.test(error.message));
  await assert.rejects(fail(new APIError(401, {}, "invalid x-api-key")), error => error.status === 503 && /not configured/.test(error.message));
  await assert.rejects(fail(new APIError(400, { error: { message: "prompt is too long: 1200000 tokens > 1000000 maximum" } }, "400")), error => error.status === 502 && /prompt is too long/.test(error.message));
  await assert.rejects(fail(new Error("socket hang up")), error => error.status === 504);
  assert.deepEqual(finished.map(entry => entry[1]), ["released", "released", "released", "uncertain"]);
  const missingKey = moduleOf("cloud/claudeAgentAi.ts", { Deno: { env: { get: () => "" } } });
  assert.equal(missingKey.claudeKey(), "");
  const reserved = [];
  await assert.rejects(claudeModule({ reserved, key: missingKey.claudeKey }).claudeCall({}, "owner", { model: "anthropic/claude-sonnet-5-5", input: "Hi" }), error => error.status === 503 && /not configured/.test(error.message));
  assert.equal(reserved.length, 0, "a missing key reserves nothing");
});

test("a balance too small for the byte-based ceiling reserves Claude's own token count instead", async () => {
  // The balance covers a call whose input is at most 5,000 tokens.
  const reserved = [], counted = [], created = [];
  const reserve = async (_admin, _user, model, body, bounds) => {
    reserved.push(bounds);
    if (!(bounds.inputTokens <= 5000)) throw Object.assign(new Error("Not enough unreserved AI credits for this bounded model call."), { status: 402 });
    return { id: "r", finish: async () => {} };
  };
  const reply = () => events([start("msg_7"), ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "OK" }]), ...end("end_turn")]);
  const body = { model: "anthropic/claude-sonnet-5-5", instructions: "BASE ".repeat(4000), input: "Hi" };
  const claude = count => claudeModule({ reserve, count, create: async params => { created.push(params); return reply(); } });
  const result = await claude(async (params, options) => { counted.push({ params: plain(params), options }); return { input_tokens: 3000 }; }).claudeCall({}, "owner", body);
  assert.equal(result.status, "completed");
  assert.deepEqual(reserved.map(bounds => bounds.inputTokens), [undefined, Math.ceil(3000 * 1.05) + 1024]);
  assert.equal(reserved[1].outputTokens, 16384, "the output allowance stays the same");
  assert.equal(counted[0].params.model, "claude-sonnet-5-5");
  assert.ok(counted[0].params.system && counted[0].params.thinking && counted[0].params.messages, "the count covers the whole request");
  assert.equal("max_tokens" in counted[0].params || "metadata" in counted[0].params, false, "fields the count doesn't take are left out");
  assert.deepEqual(plain(counted[0].options), { timeout: 10000, maxRetries: 0 });
  assert.equal(created.length, 1);
  // When the count fails, or is still too large, the balance is refused as before and nothing is sent.
  reserved.length = 0;
  await assert.rejects(claude(async () => { throw new APIError(429, {}, "rate limited"); }).claudeCall({}, "owner", body), error => error.status === 402);
  await assert.rejects(claude(async () => ({ input_tokens: 9000 })).claudeCall({}, "owner", body), error => error.status === 402);
  assert.equal(created.length, 1);
  // A balance that covers the ceiling never waits for a count.
  counted.length = 0;
  await claudeModule({ create: async () => reply(), count: async () => { counted.push(1); return { input_tokens: 1 }; } }).claudeCall({}, "owner", body);
  assert.equal(counted.length, 0);
});

test("the tools and base instructions get their own cache breakpoint, within Anthropic's four", () => {
  const claude = claudeModule();
  const request = (input, instructions = "BASE") => plain(claude.claudeRequest(route.claudeRoute("anthropic/claude-opus-5-5"), { instructions, tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }], input }).params);
  const developer = text => ({ type: "message", role: "developer", content: [{ type: "input_text", text }] }), user = text => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
  const breakpoints = params => (JSON.stringify(params).match(/"cache_control"/g) || []).length;
  const chat = request([developer("AGENT"), developer("<timewarp_context>Sent 09:41</timewarp_context>"), user("Hi")]);
  assert.deepEqual(chat.system.map(block => !!block.cache_control), [true, false, true]);
  assert.equal(breakpoints(chat), 3, "the base prompt, the chat's context and the conversation");
  const other = request([developer("WORKER"), user("Go")]);
  assert.deepEqual(other.system[0], chat.system[0], "another chat or worker reads the same cached prefix");
  assert.equal(breakpoints(request([user("Hi")])), 2, "a lone system block has one");
  assert.equal(breakpoints(request([user("Hi")], "")), 1);
  for (const params of [chat, other]) assert.ok(JSON.stringify(params).match(/"cache_control":\{[^}]*\}/g).every(marker => marker === '"cache_control":{"type":"ephemeral"}'), "all 5-minute");
});

test("the Anthropic SDK loads with the first Claude request, once", async () => {
  const loads = [], reply = () => events([start("msg_l"), ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "OK" }]), ...end("end_turn")]);
  const claude = claudeModule({ loads, create: async () => reply() });
  assert.deepEqual(loads, [], "isolates that only serve GPT never load it");
  for (let turn = 0; turn < 2; turn++) await claude.claudeCall({}, "owner", { model: "anthropic/claude-haiku-5-5", input: "Hi" });
  assert.deepEqual(loads, ["npm:@anthropic-ai/sdk@0.128.0"]);
});

test("Fast mode gets no SDK retries, and a Fast refusal is remembered until Anthropic's retry-after", async () => {
  let now = 1_000_000;
  const reserved = [], options = [], replies = [];
  const ok = () => events([start("msg_f"), ...block(0, { type: "text", text: "" }, [{ type: "text_delta", text: "OK" }]), ...end("end_turn")]);
  const claude = claudeModule({ reserved, clock: () => now, create: async (params, given) => { options.push([params.speed ?? "standard", given.maxRetries]); const next = replies.shift(); if (next instanceof Error) throw next; return next; } });
  const ask = () => claude.claudeCall({}, "owner", { model: "anthropic/claude-opus-5-5-fast", input: "Hi" });
  replies.push(new APIError(429, { error: { type: "rate_limit_error" } }, "429", { get: name => name === "retry-after" ? "30" : null }), ok());
  await ask();
  assert.deepEqual(options, [["fast", 0], ["standard", undefined]], "a Fast refusal falls back at once; the standard request keeps the SDK's retries");
  now += 20_000; replies.push(ok()); await ask();
  assert.deepEqual(options.at(-1), ["standard", undefined], "within retry-after, straight to the standard speed");
  now += 11_000; replies.push(ok()); await ask();
  assert.deepEqual(options.at(-1), ["fast", 0], "then Fast again");
  assert.deepEqual(reserved.map(entry => entry.model), ["anthropic/claude-opus-5-5-fast", "anthropic/claude-opus-5-5", "anthropic/claude-opus-5-5", "anthropic/claude-opus-5-5-fast"]);
  replies.push(new APIError(400, { error: { message: "Fast mode is not available for this organization." } }, "400"), ok()); await ask();
  now += 9 * 60_000; replies.push(ok()); await ask();
  assert.deepEqual(options.at(-1), ["standard", undefined], "Fast that isn't offered is left alone for a while");
});

// Azure routes with the production secrets' names: the resource key, and a
// renamed Astra deployment.
const azure = moduleOf("cloud/azureAgentAi.ts", { Deno: { env: { get: name => ({ GPT_TERRA_KEY: "resource-key", GPT_ASTRA_MODEL: "astra-prod" })[name] || "" } }, crypto, TextEncoder });

test("the cloud gives Claude and GPT-6 to every plan, Free included, and keeps Claude's thinking out of GPT requests", async () => {
  let handler, plan = "free", streamed, forwarded;
  const claude = claudeModule();
  moduleOf("cloud/index.ts", {
    Deno: { env: { get: () => "" }, serve: fn => { handler = fn; } }, URL, Response, TextDecoder, TextEncoder, AbortSignal, Blob, DecompressionStream,
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, rpc: async name => name === "timewarp_ai_usage" ? { data: { plan } } : { data: null } }),
    responseOutputLimit, REVIEW_OUTPUT_TOKENS: 4096, assertCloudSafe: require("../shared/privacy.cjs").assertCloudSafe, azureSolModel: () => "gpt-5.6-sol", azureLunaModel: () => "gpt-5.6-luna",
    azureRoute: azure.azureRoute, promptCacheKey: azure.promptCacheKey,
    claudeRoute: route.claudeRoute, isClaudeReasoning: claude.isClaudeReasoning,
    claudeStream: async (_admin, user, body) => { streamed = { user, model: body.model }; return new Response("claude"); }, claudeCall: async () => ({}),
    nativeStream: async (_admin, _user, route, payload) => { forwarded = { route: plain(route), payload }; return new Response("gpt"); }, nativeCall: async () => ({}),
  });
  const request = body => handler(new Request("https://fixture.invalid/functions/v1/timewarp-energy/v1/responses", { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ stream: true, input: "Hi", ...body }) }));
  for (plan of ["free", "max"]) {
    for (const model of ["anthropic/claude-opus-5-5", "anthropic/claude-haiku-5-5"]) {
      const response = await request({ model });
      assert.equal(await response.text(), "claude", plan + " " + model);
      assert.deepEqual(streamed, { user: "owner", model });
    }
    for (const model of ["openai/gpt-6.1-sol", "openai/gpt-6-astra", "openai/gpt-6-luna"]) {
      const response = await request({ model });
      assert.equal(await response.text(), "gpt", plan + " " + model);
      assert.equal(forwarded.route.slug, model.slice("openai/".length));
    }
  }
  plan = "free";
  const response = await request({ model: "anthropic/claude-opus-5-5-fast" });
  assert.equal(await response.text(), "claude");
  assert.deepEqual(streamed, { user: "owner", model: "anthropic/claude-opus-5-5-fast" });
  await request({ model: "openai/gpt-6.1-sol", service_tier: "priority" });
  assert.deepEqual([forwarded.route.deployment, forwarded.route.billing, forwarded.route.fast], ["gpt-6.1-sol", "openai/gpt-6.1-sol-fast", true]);
  assert.equal(forwarded.payload.service_tier, undefined, "the route decides the tier");
  const thinking = { type: "reasoning", encrypted_content: claude.encodeThinking([{ type: "thinking", thinking: "", signature: "S" }]) };
  await request({ model: "openai/gpt-5.6-sol", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] }, thinking, { type: "reasoning", encrypted_content: "gAAAA" }] });
  assert.equal(forwarded.route.deployment, "gpt-5.6-sol", "desktops that haven't updated keep GPT-5.6");
  assert.deepEqual(plain(forwarded.payload.input.map(item => item.encrypted_content || item.type)), ["message", "gAAAA"]);
});

test("GPT-6 models route to their Azure deployments, with Fast only when asked for", () => {
  const routed = (name, tier) => plain(azure.azureRoute(name, tier));
  assert.deepEqual(routed("openai/gpt-6-astra"), { slug: "gpt-6-astra", deployment: "astra-prod", keys: ["resource-key"], fast: false, billing: "openai/gpt-6-astra" });
  assert.deepEqual(routed("openai/gpt-6.1-sol", "priority"), { slug: "gpt-6.1-sol", deployment: "gpt-6.1-sol", keys: ["resource-key"], fast: true, billing: "openai/gpt-6.1-sol-fast" });
  assert.deepEqual(routed("gpt-6-luna", "fast"), { slug: "gpt-6-luna", deployment: "gpt-6-luna", keys: ["resource-key"], fast: true, billing: "openai/gpt-6-luna-fast" });
  assert.deepEqual(routed("openai/gpt-5.6-sol", "priority"), { slug: "gpt-5.6-sol", deployment: "gpt-5.6-sol", keys: ["resource-key"], fast: false, billing: "openai/gpt-5.6-sol" });
  for (const name of ["openai/gpt-luna", "gpt-5.6-luna"]) assert.equal(routed(name).slug, "gpt-5.6-luna");
  for (const name of ["timewarp/background", "openai/gpt-7", undefined]) assert.equal(routed(name).slug, "gpt-5.6-sol");
  const fast = azure.azureRoute("openai/gpt-6.1-sol", "priority");
  assert.equal(azure.servedSpeed(fast, "priority"), "fast");
  assert.equal(azure.servedSpeed(fast, undefined), "fast", "with no report, the requested tier");
  assert.equal(azure.servedSpeed(fast, "default"), "standard");
  assert.equal(azure.servedSpeed(azure.azureRoute("openai/gpt-6.1-sol"), "priority"), "standard");
});

test("GPT-6 usage is priced with OpenAI's rates, including cache reads, long prompts and Fast", () => {
  const cost = costs.computeCostUsd;
  const details = { cached_tokens: 80000, cache_write_tokens: 10000 };
  near(cost("openai/gpt-6-astra", 100000, 1000, details), (10000 + 80000 * 0.1 + 10000 * 1.25) / 1e6 * 10 + 1000 / 1e6 * 50);
  near(cost("openai/gpt-6.1-sol", 100000, 1000, details), (10000 + 80000 * 0.05 + 10000 * 1.25) / 1e6 * 2 + 1000 / 1e6 * 10);
  near(cost("openai/gpt-6-luna", 100000, 1000, details), (10000 + 80000 * 0.1 + 10000 * 1.25) / 1e6 * 0.1 + 1000 / 1e6 * 0.5);
  near(cost("openai/gpt-6.1-sol-fast", 100000, 1000, details), 2 * cost("openai/gpt-6.1-sol", 100000, 1000, details));
  near(cost("openai/gpt-6.1-sol-fast", 100000, 1000, { ...details, speed: "standard" }), cost("openai/gpt-6.1-sol", 100000, 1000, details));
  near(cost("openai/gpt-6-astra", 300000, 10000, { cached_tokens: 300000 }), 300000 * 0.1 / 1e6 * 10 * 2 + 10000 / 1e6 * 50 * 1.5);
  near(cost("openai/gpt-6-luna-fast", 300000, 10000), 300000 / 1e6 * 0.2 * 2 + 10000 / 1e6 * 1 * 1.5);
});

test("GPT-6 Fast asks Azure for priority processing, bills the tier that served it, and falls back when a deployment can't", async () => {
  const sent = [], reserved = [], finished = [], pending = [];
  let replies;
  const native = moduleOf("cloud/nativeResponses.ts", {
    responseOutputLimit, requestInputTokens: () => 0, azureCacheRetention: () => false, servedSpeed: azure.servedSpeed, azureFoundryBase: () => "https://fixture.invalid", assertCloudSafe() {}, TextEncoder, TextDecoder, Response, AbortSignal, console,
    EdgeRuntime: { waitUntil: value => pending.push(value) },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return replies.shift(); },
    reserveAgentAi: async (_admin, _user, model) => { reserved.push(model); return { id: "r", finish: async (...args) => { finished.push([model, ...args]); } }; },
  });
  const completed = tier => new Response("data: " + JSON.stringify({ type: "response.completed", response: { service_tier: tier, usage: { input_tokens: 1000, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } } } }) + "\n\n");
  replies = [completed("default")];
  await (await native.nativeStream({}, "owner", azure.azureRoute("openai/gpt-6-astra", "priority"), { input: [] }, {})).text();
  await Promise.all(pending);
  assert.equal(sent[0].service_tier, "priority");
  assert.equal(sent[0].model, "astra-prod");
  assert.deepEqual(plain(finished[0]), ["openai/gpt-6-astra-fast", "settled", 1000, 10, { cached_tokens: 0, speed: "standard" }], "Azure served it at the standard speed, so it costs the standard rate");
  replies = [Response.json({ error: { param: "service_tier", message: "Priority processing is not enabled for this deployment." } }, { status: 400 }), completed(undefined)];
  await (await native.nativeStream({}, "owner", azure.azureRoute("openai/gpt-6.1-sol", "priority"), { input: [] }, {})).text();
  await Promise.all(pending);
  assert.deepEqual(sent.slice(1).map(body => body.service_tier ?? "standard"), ["priority", "standard"]);
  assert.deepEqual(reserved.slice(1), ["openai/gpt-6.1-sol-fast", "openai/gpt-6.1-sol"]);
  assert.deepEqual(plain(finished.slice(1).map(entry => entry.slice(0, 2))), [["openai/gpt-6.1-sol-fast", "released"], ["openai/gpt-6.1-sol", "settled"]]);
});
