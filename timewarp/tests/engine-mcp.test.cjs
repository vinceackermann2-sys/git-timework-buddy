"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createMcp, serverConfig } = require("../app/main/mcp.cjs");

test("server settings are validated before they reach the Codex config", () => {
  assert.deepEqual(serverConfig({ transport: "http", url: "https://example.com/mcp" }), { url: "https://example.com/mcp", enabled: true });
  assert.deepEqual(serverConfig({ transport: "http", url: "http://localhost:3000/mcp" }).url, "http://localhost:3000/mcp");
  assert.throws(() => serverConfig({ transport: "http", url: "http://example.com/mcp" }), /HTTPS/);
  // Plain HTTP on the local network, as before.
  for (const url of ["http://192.168.1.20:8080/mcp", "http://10.0.0.5/mcp", "http://nas.local/mcp", "http://printer.lan/mcp", "http://homeserver/mcp", "http://[fd00::1]/mcp"]) assert.equal(serverConfig({ transport: "http", url }).url, url);
  assert.throws(() => serverConfig({ transport: "http", url: "http://8.8.8.8/mcp" }), /HTTPS/);
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
  await assert.rejects(mcp.remove("timewarp_composio"), /Timewarp manages/);
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

test("imports keep a server's off switch, keep ${VAR} as environment references, and skip SSE servers", () => {
  const { importedServer } = require("../app/main/mcp.cjs");
  const env = { HOME_DIR: "C:\\Users\\me", GH_TOKEN: "secret", API_KEY: "k" };
  assert.equal(importedServer({ command: "npx", disabled: true }, env).config.enabled, false);
  assert.equal(importedServer({ url: "https://example.com/mcp", enabled: false }, env).config.enabled, false);
  const stdio = importedServer({ command: "node", args: ["${HOME_DIR}/server.js"], env: { API_KEY: "${API_KEY}", TOKEN: "${GH_TOKEN}", MISSING: "${NOPE}", PLAIN: "x" } }, env);
  assert.deepEqual(stdio.config, { command: "node", args: ["C:\\Users\\me/server.js"], env: { TOKEN: "secret", PLAIN: "x" }, env_vars: ["API_KEY"], enabled: true });
  assert.deepEqual(stdio.notes, ["left out MISSING (set NOPE)"]);
  const http = importedServer({ url: "https://example.com/mcp", http_headers: { Authorization: "Bearer ${GH_TOKEN}", "X-Key": "${API_KEY}", "X-Team": "core" } }, env);
  assert.deepEqual(http.config, { url: "https://example.com/mcp", http_headers: { "X-Team": "core" }, env_http_headers: { "X-Key": "API_KEY" }, bearer_token_env_var: "GH_TOKEN", enabled: true });
  assert.equal(importedServer({ command: "uvx", args: ["--from", "${VERSION:-1.0}"] }, env).config.args[1], "1.0");
  assert.throws(() => importedServer({ command: "${TOOL_HOME}/bin/server" }, env), /TOOL_HOME.*isn't set/);
  assert.throws(() => importedServer({ type: "sse", url: "https://example.com/events" }, env), /SSE/);
  assert.throws(() => importedServer({ url: "https://mcp.linear.app/sse" }, env), /SSE/);
  assert.equal(importedServer({ type: "http", url: "https://example.com/sse" }, env).config.url, "https://example.com/sse");
});

function mcpClient(servers, { deleteTokens = true } = {}) {
  const calls = [];
  const client = Object.assign(new EventEmitter(), {
    executable: null,
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "config/read") return { config: { mcp_servers: servers } };
      if (method === "mcpServerStatus/list") return { data: [] };
      if (method === "mcpServer/oauth/deleteTokens" && !deleteTokens) throw new Error("unknown variant `mcpServer/oauth/deleteTokens`");
      if (method === "mcpServer/oauth/login") return { authorizationUrl: "https://example.com/authorize" };
      if (method === "config/value/write") {
        const name = params.keyPath.split(".")[1];
        if (params.keyPath.endsWith(".enabled")) servers[name].enabled = params.value;
        else if (params.value === null) delete servers[name];
        else servers[name] = params.value;
      }
      return {};
    },
  });
  return { client, calls };
}

test("servers added elsewhere keep their names and can be turned off, signed in to and removed, sign-in included", async () => {
  const servers = { GitHub: { url: "https://api.githubcopilot.com/mcp/" }, Context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } };
  const { client, calls } = mcpClient(servers);
  const opened = [];
  const mcp = createMcp({ client, openExternal: async url => { opened.push(url); } });
  await mcp.setEnabled("GitHub", false);
  assert.equal(servers.GitHub.enabled, false);
  await mcp.setEnabled("Context7", false);
  assert.equal(servers.Context7.enabled, false);
  await mcp.signIn("GitHub");
  assert.deepEqual(opened, ["https://example.com/authorize"]);
  await assert.rejects(mcp.signIn("Context7"), /doesn't use a sign-in/);
  await mcp.remove("GitHub");
  assert.deepEqual(calls.find(call => call.method === "mcpServer/oauth/deleteTokens").params, { name: "GitHub", url: "https://api.githubcopilot.com/mcp/" });
  assert.equal(Object.hasOwn(servers, "GitHub"), false);
  await mcp.remove("Context7");
  assert.deepEqual(Object.keys(servers), []);
  await assert.rejects(mcp.setEnabled("Missing", true), /isn't configured/);
});

test("without the app server's token removal, Codex's logout removes the sign-in before the server goes", async () => {
  const servers = { docs: { url: "https://example.com/mcp" } };
  const { client } = mcpClient(servers, { deleteTokens: false });
  const order = [];
  const mcp = createMcp({ client, openExternal: async () => {}, logout: async name => { order.push(["logout", name, Object.hasOwn(servers, name)]); return true; } });
  await mcp.remove("docs");
  assert.deepEqual(order, [["logout", "docs", true]]);
  assert.equal(Object.hasOwn(servers, "docs"), false);
});

test("a command from the interface is added only after the native confirmation", async () => {
  const servers = {};
  const { client } = mcpClient(servers);
  const asked = [];
  let answer = false;
  const mcp = createMcp({ client, openExternal: async () => {}, confirmCommand: async details => { asked.push(details); return answer; } });
  const input = { name: "files", transport: "stdio", command: "npx", args: ["-y", "files server"], env: { ROOT: "C:\\" } };
  await assert.rejects(mcp.add(input), /wasn't added/);
  assert.deepEqual(servers, {});
  assert.deepEqual(asked, [{ name: "files", command: "npx", args: ["-y", "files server"], envKeys: ["ROOT"] }]);
  answer = true;
  await mcp.add(input);
  assert.equal(servers.files.command, "npx");
  await mcp.add({ name: "remote", transport: "http", url: "https://example.com/mcp" });
  assert.equal(asked.length, 2, "A URL doesn't run anything here, so it isn't asked about");
});

test("a server whose sign-in ran out is listed as needing a new sign-in until it starts again", async () => {
  const servers = { docs: { url: "https://example.com/mcp" } };
  const { client } = mcpClient(servers);
  const events = [];
  const mcp = createMcp({ client, openExternal: async () => {}, notify: (name, payload) => events.push([name, payload]) });
  client.emit("notification", { method: "mcpServer/startupStatus/updated", params: { name: "docs", status: "failed", failureReason: "reauthenticationRequired", error: "The token expired." } });
  let [docs] = await mcp.list();
  assert.deepEqual([docs.reauthenticationRequired, docs.failureReason, docs.error], [true, "reauthenticationRequired", "The token expired."]);
  assert.deepEqual(events, [["mcp.changed", { name: "docs" }]]);
  client.emit("notification", { method: "mcpServer/oauthLogin/completed", params: { name: "docs", success: true } });
  [docs] = await mcp.list();
  assert.deepEqual([docs.reauthenticationRequired, docs.failureReason, docs.error], [false, null, null]);
});
