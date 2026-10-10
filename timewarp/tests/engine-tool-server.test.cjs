"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createToolServer, mcpResult, threadsOf } = require("../app/main/tool-server.cjs");
const { CODEX_FEATURES, PERMISSIONS, THREAD_CONFIG, toolServers, REPLACED_SKILLS } = require("../app/main/codex-config.cjs");

const TOKEN = "tools-token";
const SPECS = () => [{ type: "namespace", name: "timewarp_browser", description: "The browser.", tools: [
  { type: "function", name: "open", description: "Open a page.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } },
  { type: "function", name: "read", description: "Read the page.", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
] }];

async function serve(server) {
  const httpServer = http.createServer((req, res) => server.handle(req, res, new URL(req.url, "http://127.0.0.1").pathname.slice(5)));
  await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${httpServer.address().port}/mcp/`;
  const rpc = (name, method, params, token = TOKEN) => fetch(base + name, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { rpc, close: () => httpServer.close() };
}

test("agents get the same settings the previous app's harness used", () => {
  // Connected apps and Timewarp's tools only: no ChatGPT apps, Codex plugin suggestions, Codex browser or goals.
  for (const setting of ["features.apps=false", "features.tool_suggest=false", "features.remote_plugin=false", "features.goals=false", "features.browser_use=false", "features.in_app_browser=false", "features.computer_use=false", "features.image_generation=true"]) assert.ok(CODEX_FEATURES.includes(setting), setting);
  assert.ok(CODEX_FEATURES.includes("features.multi_agent_v2.max_concurrent_threads_per_session=4"));
  assert.ok(CODEX_FEATURES.includes("features.multi_agent_v2.expose_spawn_agent_model_overrides=false"));
  // Write access to the workspace and network access, through a permission profile.
  assert.equal(PERMISSIONS, "timewarp");
  assert.equal(THREAD_CONFIG["permissions.timewarp.extends"], ":workspace");
  assert.equal(THREAD_CONFIG["permissions.timewarp.network.enabled"], true);
  assert.equal(THREAD_CONFIG.default_permissions, "timewarp", "MCP servers can be reloaded");
  assert.equal(THREAD_CONFIG.model_reasoning_summary, "detailed");
  assert.deepEqual(REPLACED_SKILLS, ["browser-use", "vault", "memory-write-skill"]);
  // Off as before; workers (multi-agent) stay on.
  for (const setting of ["features.request_permissions_tool=false", "features.enable_fanout=false", "features.apply_patch_freeform=false"]) assert.ok(CODEX_FEATURES.includes(setting), setting);
  assert.ok(!CODEX_FEATURES.some(setting => /^features\.multi_agent=false/.test(setting)));
});

test("a chat's workers learn its agent, and its writable folders follow the memory setting", () => {
  const { agentThreadConfig, workspaceRoots } = require("../app/main/codex-config.cjs");
  const config = agentThreadConfig("WORKER TEXT");
  assert.equal(config["features.multi_agent_v2.subagent_developer_instructions"], "WORKER TEXT");
  assert.equal(config.default_permissions, "timewarp");
  assert.equal(agentThreadConfig()["features.multi_agent_v2.subagent_developer_instructions"], undefined);
  assert.deepEqual(workspaceRoots("/w", { skills: "/codex/skills", memories: "/memories", memoryWrite: true }), ["/w", "/codex/skills", "/memories"]);
  assert.deepEqual(workspaceRoots("/w", { skills: "/codex/skills", memories: "/memories", memoryWrite: false }), ["/w", "/codex/skills"]);
});

test("Timewarp's MCP servers point at the bridge and skip approval reviews for its own tools", () => {
  const servers = toolServers(7788);
  assert.deepEqual(Object.keys(servers), ["timewarp_composio", "timewarp_browser", "timewarp_vault", "timewarp_automations", "timewarp_chats"]);
  assert.equal(servers.timewarp_composio.url, "http://127.0.0.1:7788/mcp/composio");
  assert.equal(servers.timewarp_composio.default_tools_approval_mode, undefined, "connected-app actions keep Codex's review");
  for (const name of ["timewarp_browser", "timewarp_vault", "timewarp_automations", "timewarp_chats"]) {
    assert.equal(servers[name].url, "http://127.0.0.1:7788/mcp/" + name);
    assert.equal(servers[name].bearer_token_env_var, "TIMEWARP_TOOLS_TOKEN");
    assert.equal(servers[name].default_tools_approval_mode, "approve");
    assert.deepEqual(servers[name].omit_tools_from, ["deferred"]);
    assert.equal(servers[name].required, true, "chats start once the tools are connected");
  }
  assert.ok(servers.timewarp_vault.tool_timeout_sec >= 600, "vault calls wait for the user's answer");
});

test("tool results become MCP content, with images and failures", () => {
  assert.deepEqual(mcpResult({ contentItems: [{ type: "inputText", text: "Opened" }], success: true }), { content: [{ type: "text", text: "Opened" }] });
  assert.deepEqual(mcpResult({ contentItems: [{ type: "inputImage", imageUrl: "data:image/jpeg;base64,AAAA" }], success: true }), { content: [{ type: "image", mimeType: "image/jpeg", data: "AAAA" }] });
  assert.deepEqual(mcpResult({ contentItems: [{ type: "inputText", text: "Blocked" }], success: false }), { content: [{ type: "text", text: "Blocked" }], isError: true });
});

test("a call names its thread and the chat's root thread", () => {
  assert.deepEqual(threadsOf({ _meta: { threadId: "worker", "x-codex-turn-metadata": { thread_id: "worker", session_id: "root", parent_thread_id: "root" } } }), { threadId: "worker", rootThreadId: "root" });
  assert.deepEqual(threadsOf({}), { threadId: null, rootThreadId: null });
});

test("the tool server answers MCP for the chat a worker's thread belongs to", async () => {
  const calls = [];
  const server = createToolServer({
    token: TOKEN,
    servers: { timewarp_browser: { title: "Timewarp browser", instructions: "The browser.", specs: SPECS, readOnly: new Set(["read"]), call: async (conversationId, params, agent) => { calls.push({ conversationId, params, agent }); return { contentItems: [{ type: "inputText", text: "Opened " + params.arguments.url }], success: true }; } } },
    resolve: (threadId, rootThreadId) => {
      if (threadId === "worker-thread" || rootThreadId === "root-thread") return { conversationId: "chat-1", agent: { id: "agent-1", name: "Ada" } };
      throw new Error("This tool is unavailable here.");
    },
  });
  const { rpc, close } = await serve(server);
  try {
    assert.equal((await rpc("timewarp_browser", "tools/list", {}, "wrong")).status, 401);
    assert.equal((await rpc("other", "tools/list", {})).status, 404);
    const init = await (await rpc("timewarp_browser", "initialize", { protocolVersion: "2025-06-18" })).json();
    assert.equal(init.result.serverInfo.name, "Timewarp browser");
    const listed = await (await rpc("timewarp_browser", "tools/list", {})).json();
    assert.deepEqual(listed.result.tools.map(tool => [tool.name, tool.annotations.readOnlyHint]), [["open", false], ["read", true]]);
    const opened = await (await rpc("timewarp_browser", "tools/call", { name: "open", arguments: { url: "https://example.com" }, _meta: { threadId: "worker-thread", "x-codex-turn-metadata": { session_id: "root-thread" } } })).json();
    assert.deepEqual(opened.result, { content: [{ type: "text", text: "Opened https://example.com" }] });
    assert.deepEqual(calls[0], { conversationId: "chat-1", params: { namespace: "timewarp_browser", tool: "open", arguments: { url: "https://example.com" }, threadId: "worker-thread", worker: true }, agent: { id: "agent-1", name: "Ada" } });
    const stranger = await (await rpc("timewarp_browser", "tools/call", { name: "open", arguments: { url: "https://example.com" }, _meta: { threadId: "unknown" } })).json();
    assert.equal(stranger.result.isError, true);
    assert.match(stranger.result.content[0].text, /unavailable/);
    assert.equal(calls.length, 1);
  } finally { close(); }
});
