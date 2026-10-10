"use strict";
// Timewarp's own agent tools (browser, vault, automations) as MCP servers on
// the local bridge. Codex gives MCP servers to every agent thread, including
// the workers an agent starts, which a thread's dynamic tools don't reach, so
// workers use the browser as the previous app's browser workers did. Each
// call names its thread in _meta; the thread maps to the chat it belongs to.
const { body } = require("../../desktop/bridge-body.cjs");
const { sameToken } = require("./model-bridge.cjs");

const PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const fail = (status, message) => Object.assign(new Error(message), { status });

// A tool result in the dynamic tool shape ({ contentItems, success }) as MCP content.
function mcpResult(result) {
  const content = (result?.contentItems || []).map(item => {
    if (item.type === "inputImage") {
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(item.imageUrl || ""));
      return match ? { type: "image", mimeType: match[1], data: match[2] } : { type: "text", text: "[image]" };
    }
    return { type: "text", text: String(item.text ?? "") };
  });
  return { content: content.length ? content : [{ type: "text", text: "Done." }], ...(result?.success === false ? { isError: true } : {}) };
}

// The calling thread and the chat's root thread from a tools/call request.
function threadsOf(params) {
  const meta = params?._meta || {}, turn = meta["x-codex-turn-metadata"] || {};
  return { threadId: meta.threadId || turn.thread_id || null, rootThreadId: turn.session_id || null };
}

// servers: { name: { title, instructions, specs(), call(conversationId, params, agent), readOnly } }
// resolve(threadId, rootThreadId) -> { conversationId, agent }, or throws.
function createToolServer({ token, servers, resolve }) {
  const toolsOf = name => servers[name].specs().flatMap(namespace => namespace.tools).map(tool => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    annotations: servers[name].readOnly?.has(tool.name) ? { readOnlyHint: true, destructiveHint: false, openWorldHint: false } : { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }));

  async function handle(req, res, name) {
    const server = Object.hasOwn(servers, name) ? servers[name] : null;
    if (!server) { res.writeHead(404).end(); return; }
    if (!sameToken(token, req.headers.authorization)) { res.writeHead(401).end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
    let input;
    const reply = value => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: input?.id ?? null, ...value })); };
    try {
      input = await body(req, 8 * 1024 * 1024);
      if (input.jsonrpc !== "2.0" || Array.isArray(input)) throw fail(400, "Invalid MCP request.");
      if (input.id === undefined) { res.writeHead(202).end(); return; }
      switch (input.method) {
        case "initialize": return reply({ result: { protocolVersion: PROTOCOLS.includes(input.params?.protocolVersion) ? input.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: server.title, version: "1.0.0" }, instructions: server.instructions } });
        case "ping": return reply({ result: {} });
        case "resources/list": return reply({ result: { resources: [] } });
        case "resources/templates/list": return reply({ result: { resourceTemplates: [] } });
        case "tools/list": return reply({ result: { tools: toolsOf(name) } });
        case "tools/call": {
          try {
            const { threadId, rootThreadId } = threadsOf(input.params);
            const { conversationId, agent } = resolve(threadId, rootThreadId);
            // A worker's calls name its own thread, so its browser tools keep to its own tab.
            const worker = !!(threadId && rootThreadId && threadId !== rootThreadId);
            const result = await server.call(conversationId, { namespace: name, tool: String(input.params?.name || ""), arguments: input.params?.arguments || {}, threadId, worker }, agent);
            return reply({ result: mcpResult(result) });
          } catch (error) {
            return reply({ result: { isError: true, content: [{ type: "text", text: error.message || "The tool failed." }] } });
          }
        }
        default: return reply({ error: { code: -32601, message: "Method not found." } });
      }
    } catch (error) {
      if (!res.headersSent) reply({ error: { code: -32602, message: error.message || "Invalid MCP request." } });
    }
  }

  // resolve is also used for connected apps (model-bridge.cjs).
  return { handle, names: () => Object.keys(servers), resolve };
}

module.exports = { createToolServer, mcpResult, threadsOf };
