// `timewarp-id mcp`: Agent ID as a stdio MCP server. Every JSON-RPC message
// read from stdin (one per line) is POSTed to <api>/mcp with the agent's key,
// and every answer is written to stdout as one line. Notifications (no id)
// are forwarded and get no answer. Anything else goes to stderr, so the
// protocol stream stays clean.
import readline from 'node:readline';
import { UsageError } from '../errors.js';
import { userAgent } from '../api.js';
import { appFromClient } from '../origin.js';

const isRequest = message => message && typeof message === 'object' && typeof message.method === 'string' && message.id !== undefined && message.id !== null;
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

// Messages in a text/event-stream body (Streamable HTTP may answer that way).
function sseMessages(text) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data.trim()) continue;
    try { messages.push(JSON.parse(data)); } catch { /* not JSON */ }
  }
  return messages;
}

// `auth()` gives the headers that prove who is calling: the agent key for
// Agent ID itself, a fresh passport for anyone else's server.
// Messages go through unchanged (the client's clientInfo included, which
// Agent ID records); the user-agent names the tool, from TIMEWARP_ID_TOOL or
// else the client's name.
export function createProxy({ url, auth, fetchImpl = globalThis.fetch, write, log, tool = null, onTool = () => {} }) {
  let sessionId = null, protocolVersion = null, clientTool = tool;

  async function forward(message) {
    const request = isRequest(message);
    if (message.method === 'initialize' && !clientTool) {
      clientTool = appFromClient(message.params?.clientInfo?.name);
      if (clientTool) onTool(clientTool);
    }
    let credentials;
    try { credentials = await auth(); }
    catch (error) { return request ? [rpcError(message.id, -32001, `This agent can't prove who it is right now: ${error.message}${error.code ? ` (${error.code})` : ''}`)] : []; }
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...credentials,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': userAgent(clientTool),
          ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify(message),
      });
    } catch (error) {
      const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
      log(`could not reach ${url}: ${reason}`);
      return request ? [rpcError(message.id, -32603, `Could not reach ${url} (${reason}).`)] : [];
    }
    const session = response.headers.get('mcp-session-id');
    if (session) sessionId = session;
    const body = await response.text();
    if (!response.ok) {
      let error = null;
      try { error = JSON.parse(body)?.error; } catch { /* not JSON */ }
      // Some servers answer JSON-RPC errors with an HTTP error status.
      try { const parsed = JSON.parse(body); if (parsed?.jsonrpc === '2.0') return request ? [parsed] : []; } catch { /* not JSON-RPC */ }
      const text = error?.message ? `${error.message}${error.code ? ` (${error.code})` : ''}` : `Agent ID answered HTTP ${response.status}.`;
      log(text);
      return request ? [rpcError(message.id, response.status === 401 || response.status === 403 ? -32001 : -32603, text, error?.code ? { code: error.code, status: response.status } : { status: response.status })] : [];
    }
    if (!body.trim()) return request ? [rpcError(message.id, -32603, 'Agent ID sent an empty answer.')] : [];
    let replies;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) replies = sseMessages(body);
    else {
      try { const parsed = JSON.parse(body); replies = Array.isArray(parsed) ? parsed : [parsed]; }
      catch { return request ? [rpcError(message.id, -32603, 'Agent ID sent an answer that is not JSON.')] : []; }
    }
    if (message.method === 'initialize') {
      const version = replies.find(r => r?.id === message.id)?.result?.protocolVersion;
      if (typeof version === 'string') protocolVersion = version;
    }
    return request ? replies : [];
  }

  async function handle(message) {
    if (Array.isArray(message)) {
      if (!message.length) return write(rpcError(null, -32600, 'Invalid request: empty batch.'));
      const replies = (await Promise.all(message.map(forward))).flat();
      if (replies.length) write(replies);
      return;
    }
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return write(rpcError(message?.id, -32600, 'Invalid request.'));
    if (typeof message.method !== 'string') return; // A response to a request this server never makes.
    for (const reply of await forward(message)) write(reply);
  }

  return { handle };
}

// Passports for one audience, reused until a minute before they expire.
function passports(ctx, audience, log) {
  let current = null, pending = null;
  return async () => {
    if (current && Date.parse(current.expiresAt) - Date.now() > 60_000) return current.passport;
    pending ??= ctx.self.post('/v1/me/passport', { audience }).then(
      data => { current = data; pending = null; return data.passport; },
      error => { pending = null; log(`could not get a passport for ${audience}: ${error.message}`); throw error; },
    );
    return pending;
  };
}

export async function mcp(ctx) {
  const log = text => ctx.err(`[timewarp-id mcp] ${text}`);
  const agent = ctx.agent();
  const remote = typeof ctx.flags.remote === 'string' ? ctx.flags.remote : null;
  let url, auth;
  if (remote) {
    // Someone else's MCP server that accepts verified agents: it gets a
    // passport for its audience, never the agent's key.
    let origin;
    try { origin = new URL(remote).origin; } catch { throw new UsageError('--remote must be the MCP server\'s URL, like https://mcp.example.com/mcp.'); }
    const audience = typeof ctx.flags.audience === 'string' ? ctx.flags.audience : origin;
    const passport = passports(ctx, audience, log);
    url = remote;
    auth = async () => ({ 'agent-passport': await passport() });
    log(`acting as ${agent.handle || 'the agent of TIMEWARP_AGENT_KEY'} (${agent.source}) at ${url}, with passports for ${audience}`);
  } else {
    url = `${ctx.apiBase}/mcp`;
    auth = async () => ({ authorization: `Bearer ${agent.key}` });
    log(`acting as ${agent.handle || 'the agent of TIMEWARP_AGENT_KEY'} (${agent.source}) via ${url}`);
  }
  const write = message => ctx.stdout.write(`${JSON.stringify(message)}\n`);
  // Requests this command makes itself (passports) carry the tool too.
  const proxy = createProxy({ url, auth, write, log, tool: ctx.tool, onTool: tool => { ctx.api.tool = tool; } });
  const pending = new Set();
  const lines = readline.createInterface({ input: ctx.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); }
    catch { write(rpcError(null, -32700, 'Parse error: each line must be one JSON-RPC message.')); continue; }
    const task = proxy.handle(message).catch(error => log(`unexpected: ${error?.stack || error}`));
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
  await Promise.allSettled([...pending]);
  return 0;
}
