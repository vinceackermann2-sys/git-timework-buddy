"use strict";
// Loopback endpoint for the local Codex harness. Codex calls /v1 with this
// run's bridge token; requests are forwarded to Timewarp's cloud with the
// signed-in account. Connected apps (Composio), Timewarp's own agent tools and
// mascot images are served here too, at the addresses existing profiles already store.
const http = require("node:http");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { assertCloudSafe } = require("../../shared/privacy.cjs");
const { body } = require("../../desktop/bridge-body.cjs");

const PORT = 7788;

function sameToken(expected, header) {
  const actual = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

function createModelBridge({ token, cloud, funding, chatgpt, integrations, mascots, toolServer = () => null, port = PORT }) {
  const reply = (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const fail = (res, status, message) => reply(res, status, { error: { message } });
  const relay = (res, upstream) => {
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" });
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  };
  // Connected apps (Composio) act for the agent whose chat calls them: the
  // calling thread, named in the request's _meta as for Timewarp's own tools,
  // gives the chat and its agent, which replaces any agent id in the call. So
  // one agent can't use another's apps, and the agent list shows only itself.
  // Composio's handler then checks the token and the agent's app access.
  const rpc = (res, id, value) => reply(res, 200, { jsonrpc: "2.0", id: id ?? null, ...value });
  function callingAgent(params) {
    const { threadsOf } = require("./tool-server.cjs");
    const { threadId, rootThreadId } = threadsOf(params);
    try { return toolServer()?.resolve?.(threadId, rootThreadId)?.agent || null; } catch { return null; }
  }
  // Composio's handler, given the request body already read; the response is
  // kept when `hold` is set, so it can be replaced.
  function forward(req, res, input, hold = false) {
    const forwarded = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), { headers: req.headers, method: req.method, url: req.url });
    if (!hold) return integrations.mcp(forwarded, res);
    return new Promise(resolve => {
      const held = { status: 200, writeHead(status) { held.status = status; return held; }, setHeader() {}, end() { resolve(held); } };
      Promise.resolve(integrations.mcp(forwarded, held)).catch(() => resolve({ status: 500 }));
    });
  }
  async function composio(req, res) {
    if (req.method !== "POST") return integrations.mcp(req, res);
    const input = await body(req);
    if (input?.method !== "tools/call" || !input.params || typeof input.params !== "object") return forward(req, res, input);
    const agent = callingAgent(input.params);
    if (!agent) return rpc(res, input.id, { result: { isError: true, content: [{ type: "text", text: "Connected apps work only in a Timewarp chat." }] } });
    if (input.params.name === "composio_list_assistants") {
      // The token is checked with a ping before answering.
      const held = await forward(req, res, { jsonrpc: "2.0", id: input.id, method: "ping" }, true);
      if (held.status !== 200) { res.writeHead(held.status).end(); return; }
      return rpc(res, input.id, { result: { content: [{ type: "text", text: JSON.stringify([{ id: agent.id, name: agent.name }]) }] } });
    }
    return forward(req, res, { ...input, params: { ...input.params, arguments: { ...(input.params.arguments || {}), assistantId: agent.id } } });
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || "")) return fail(res, 403, "Invalid host.");
      if (req.headers.origin) return fail(res, 403, "Browser pages cannot call the device bridge.");
      const { pathname } = new URL(req.url, "http://127.0.0.1");
      if (pathname === "/healthz") return reply(res, 200, { ok: true, name: "timewarp-device-bridge", version: 2 });
      if (pathname.startsWith("/mascots/") && mascots?.serve(req, res, pathname) !== false) return;
      if (pathname === "/mcp/composio" && integrations) return await composio(req, res);
      // Timewarp's own agent tools (tool-server.cjs), once the harness is ready.
      if (pathname.startsWith("/mcp/") && toolServer()) return toolServer().handle(req, res, pathname.slice(5));
      if (!pathname.startsWith("/v1/")) return fail(res, 404, "Not found.");
      if (!sameToken(token, req.headers.authorization)) return fail(res, 401, "Unauthorized.");
      if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "Method not allowed.");
      const input = req.method === "POST" ? await body(req) : undefined;
      // Client telemetry is not model input; drop it before the privacy check.
      if (pathname === "/v1/responses" && input && typeof input === "object") delete input.client_metadata;
      if (input !== undefined) assertCloudSafe(input);
      const state = await funding.current();
      if (state.source === "chatgpt") {
        if (pathname === "/v1/models" && req.method === "GET") return reply(res, 200, await chatgpt.catalog());
        return fail(res, 409, "Subscription requests use the native Codex provider. Reopen this chat to refresh its provider.");
      }
      return relay(res, await cloud(pathname, input, req.method));
    } catch (error) {
      if (!res.headersSent) fail(res, error.status || 400, error.message || "Request failed.");
      else res.destroy();
    }
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n"));
  // The usual port, or any free one when another app (such as the previous
  // Timewarp app) already uses it.
  const bind = at => new Promise((resolve, reject) => {
    const failed = error => { server.off("listening", done); reject(error); };
    const done = () => { server.off("error", failed); resolve(server.address().port); };
    server.once("error", failed);
    server.once("listening", done);
    server.listen(at, "127.0.0.1");
  });
  let bound = null;
  return {
    server,
    get port() { return bound || port; },
    listen: async () => {
      try { bound = await bind(port); }
      catch (error) {
        if (error.code !== "EADDRINUSE" || !port) throw new Error("The local model bridge could not start.");
        bound = await bind(0).catch(() => { throw new Error("The local model bridge could not start."); });
      }
      return bound;
    },
    close: () => server.close(),
  };
}

module.exports = { createModelBridge, sameToken, PORT };
