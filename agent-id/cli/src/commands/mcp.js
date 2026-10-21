// `timewarp-id mcp`: Agent ID as a stdio MCP server. Every JSON-RPC message
// read from stdin (one per line) is POSTed to <api>/mcp with the agent's key,
// and every answer is written to stdout as one line. Notifications (no id)
// are forwarded and get no answer. Anything else goes to stderr, so the
// protocol stream stays clean.
//
// A payment that waits for the owner's approval is shown to the person in the
// app (Claude Code) with MCP elicitation: it opens the approval page, the call
// waits while they answer on Agent ID, and the agent gets the outcome. The
// person approves on the website, signed in; the agent can never approve.
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
export function createProxy({ url, auth, fetchImpl = globalThis.fetch, write, log, tool = null, onTool = () => {}, approvals = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), approvalWaitMs = 180_000 }) {
  let sessionId = null, protocolVersion = null, clientTool = tool, clientElicitation = null, nextAsk = 0;
  const asks = new Map();

  // A request to the client (the app); its answer comes back on stdin.
  function ask(method, params, timeoutMs = 10 * 60_000) {
    const id = `timewarp-id-${++nextAsk}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => { asks.delete(id); resolve(null); }, timeoutMs);
      asks.set(id, reply => { clearTimeout(timer); resolve(reply); });
      write({ jsonrpc: '2.0', id, method, params });
    });
  }

  const dollars = money => money && typeof money.amount === 'number' ? `$${(money.amount / 100).toFixed(2)}` : 'money';
  const OUTCOMES = {
    completed: 'Your owner approved it, and the money was sent.',
    denied: 'It was declined, so nothing was sent.',
    failed: 'It was approved, but the transfer did not go through.',
    expired: 'It expired without an answer.',
  };

  // wallet_send answered "needs_approval": ask the person in the app.
  async function approvalFlow(reply) {
    let data;
    try { data = JSON.parse(reply?.result?.content?.[0]?.text ?? ''); } catch { return reply; }
    if (data?.status !== 'needs_approval' || !data.approval || !data.approveUrl) return reply;
    let details = null;
    try { details = (await approvals.status(data.approval)).approval; } catch { /* the link still works */ }
    const what = details ? `send ${dollars(details.amount)} to ${details.to}${details.memo ? ` ("${details.memo}")` : ''}` : 'make a payment above your approval amount';
    const message = `Your agent wants to ${what}. Approve or decline it on Agent ID.`;
    const urlMode = !!clientElicitation?.url && String(protocolVersion || '') >= '2025-11-25';
    const params = urlMode
      ? { mode: 'url', message, url: data.approveUrl, elicitationId: data.approval }
      : { message: `${message}\n\nOpen ${data.approveUrl}, answer there, then choose Accept. Decline cancels the payment.`, requestedSchema: { type: 'object', properties: {} } };
    log(`asking you to approve payment ${data.approval} on Agent ID`);
    const answer = await ask('elicitation/create', params);
    const action = answer?.result?.action;
    const respond = body => ({ ...reply, result: { content: [{ type: 'text', text: JSON.stringify(body) }] } });
    if (action === 'decline') {
      try {
        const withdrawn = await approvals.withdraw(data.approval);
        return respond({ ...withdrawn, status: 'declined', message: 'The person declined it, so the payment was cancelled.' });
      } catch { return reply; }
    }
    if (action !== 'accept') return reply;
    const deadline = Date.now() + approvalWaitMs;
    while (Date.now() < deadline) {
      let status;
      try { status = await approvals.status(data.approval); } catch { break; }
      const state = status?.approval?.status;
      // "approved" is a live transfer still on its way: wait for it.
      if (state && state !== 'pending' && state !== 'approved') {
        if (urlMode) write({ jsonrpc: '2.0', method: 'notifications/elicitation/complete', params: { elicitationId: data.approval } });
        return respond({ ...status, status: state, message: OUTCOMES[state] || `It is ${state}.` });
      }
      await sleep(2000);
    }
    return respond({ ...data, message: `${data.message} No answer yet; check later with approval_status.` });
  }

  async function forward(message) {
    const request = isRequest(message);
    if (message.method === 'initialize') {
      clientElicitation = message.params?.capabilities?.elicitation ?? null;
      if (!clientTool) {
        clientTool = appFromClient(message.params?.clientInfo?.name);
        if (clientTool) onTool(clientTool);
      }
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
    if (request && message.method === 'tools/call' && approvals && clientElicitation) {
      replies = await Promise.all(replies.map(reply => reply?.id === message.id ? approvalFlow(reply) : reply));
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
    if (typeof message.method !== 'string') {
      // The app answering a request of ours (elicitation).
      const done = asks.get(message.id);
      if (done) { asks.delete(message.id); done(message); }
      return;
    }
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
  // Approvals are followed on Agent ID itself, not on someone else's server.
  const approvals = remote ? null : {
    status: id => ctx.self.get(`/v1/me/approvals/${encodeURIComponent(id)}`),
    withdraw: id => ctx.self.post(`/v1/me/approvals/${encodeURIComponent(id)}/withdraw`, {}),
  };
  const proxy = createProxy({ url, auth, write, log, tool: ctx.tool, onTool: tool => { ctx.api.tool = tool; }, approvals });
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
