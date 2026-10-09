"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createMcp, serverConfig } = require("../app/main/mcp.cjs");

test("server settings are validated before they reach the Codex config", () => {
  assert.deepEqual(serverConfig({ transport: "http", url: "https://example.com/mcp" }), { url: "https://example.com/mcp", enabled: true });
  assert.deepEqual(serverConfig({ transport: "http", url: "http://localhost:3000/mcp" }).url, "http://localhost:3000/mcp");
  assert.throws(() => serverConfig({ transport: "http", url: "http://example.com/mcp" }), /HTTPS/);
  assert.throws(() => serverConfig({ transport: "http", url: "https://user:secret@example.com/mcp" }), /credentials/);
  assert.deepEqual(serverConfig({ transport: "stdio", command: "npx", args: ["-y", "server"], env: { API_KEY: "x" } }), { command: "npx", args: ["-y", "server"], env: { API_KEY: "x" }, enabled: true });
  assert.throws(() => serverConfig({ transport: "stdio", command: "npx", env: { "BAD KEY": "x" } }), /valid environment variable/);
  assert.throws(() => serverConfig({ transport: "ftp" }), /how Timewarp connects/);
});

test("Timewarp's own servers stay hidden and protected", async () => {
  const servers = { timewarp_composio: { url: "http://127.0.0.1:7788/mcp/composio" }, docs: { url: "https://example.com/mcp", enabled: false } };
  const writes = [];
  const client = Object.assign(new EventEmitter(), {
    request: async (method, params) => {
      if (method === "config/read") return { config: { mcp_servers: servers } };
      if (method === "mcpServerStatus/list") return { data: [{ name: "docs", authStatus: "notLoggedIn", tools: {}, toolsError: null }] };
      if (method === "config/value/write") writes.push(params);
      return {};
    },
  });
  const mcp = createMcp({ client, openExternal: async () => {} });
  assert.deepEqual((await mcp.list()).map(server => [server.name, server.enabled, server.authStatus]), [["docs", false, "notLoggedIn"]]);
  await assert.rejects(mcp.remove("timewarp_composio"), /lowercase letters/);
  await assert.rejects(mcp.add({ name: "docs", transport: "http", url: "https://example.com/other" }), /already exists/);
  await mcp.setEnabled("docs", true);
  assert.deepEqual(writes, [{ keyPath: "mcp_servers.docs.enabled", value: true, mergeStrategy: "replace" }]);
});

test("servers imported from other assistants keep only settings Codex understands", () => {
  const { importedConfig, importedName } = require("../app/main/mcp.cjs");
  assert.equal(importedName("openaiDeveloperDocs"), "openaideveloperdocs");
  assert.equal(importedName("My Server!"), "my-server");
  assert.equal(importedName("timewarp_tools"), "imported-timewarp_tools");
  assert.equal(importedName("***"), null);
  assert.deepEqual(importedConfig({ command: "node", args: ["a.js", 3], env: { TOKEN: "x", "bad key": "y" }, env_vars: ["PATH", "no good"], startup_timeout_sec: 20, default_tools_approval_mode: "never" }),
    { command: "node", args: ["a.js"], env: { TOKEN: "x" }, env_vars: ["PATH"], startup_timeout_sec: 20, enabled: true });
  assert.deepEqual(importedConfig({ url: "https://example.com/mcp", http_headers: { Authorization: "Bearer z" } }), { url: "https://example.com/mcp", http_headers: { Authorization: "Bearer z" }, enabled: true });
  assert.throws(() => importedConfig({ url: "http://example.com/mcp" }), /HTTPS/);
  assert.throws(() => importedConfig({}), /no command or URL/);
});
