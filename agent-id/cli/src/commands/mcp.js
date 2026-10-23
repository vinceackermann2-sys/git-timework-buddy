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
//
// vault_save is answered here, not by Agent ID: the key or password the agent
// saves is sealed on this computer to its vault's public key, and only then
// sent, so Timewarp never has it in the clear.
import readline from 'node:readline';
import { UsageError } from '../errors.js';
import { userAgent } from '../api.js';
import { appFromClient } from '../origin.js';
import { seal, vaultItem } from '../vault.js';
import { markFile } from './trace.js';

const isRequest = message => message && typeof message === 'object' && typeof message.method === 'string' && message.id !== undefined && message.id !== null;
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

const field = description => ({ type: 'string', description });
export const VAULT_SAVE_TOOL = {
  name: 'vault_save',
  description: 'Save a key or a sign-in you were given into your vault, instead of keeping it in a file, a note or this conversation. It is sealed on this computer before it goes anywhere, so Timewarp never has it; afterwards use a key with vault_request (it only goes to the sites you name here).',
  inputSchema: {
    type: 'object',
    properties: {
      label: field('A name for it, like "Resend API" or "GitHub".'),
      kind: { type: 'string', enum: ['key', 'login'], description: 'key (an API key or token) or login (a website sign-in).' },
      secret: field('The key, or the sign-in\'s password.'),
      hosts: field('For a key: the sites it may be sent to, comma-separated, like api.resend.com.'),
      send_as: field('For a key: how it is sent. bearer (default), header:<Name>, query:<name> or basic:<user>.'),
      site: field('For a sign-in: the website, like https://github.com/login.'),
      username: field('For a sign-in: the username or email.'),
    },
    required: ['label', 'kind', 'secret'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

// Marking a file on this computer, answered here too: the file is read and
// written here, and Agent ID makes the marked copy.
export const TRACE_FILE_TOOL = {
  name: 'trace_mark_file',
  description: 'Mark a file you made on this computer so anyone can trace it back to you, like a watermark: a PNG picture or WAV sound gets a mark no one can see or hear, a text file an invisible one, and code is left as it is and kept as a fingerprint. The file is changed in place unless you give out_path.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file, absolute or relative to the folder this runs in.' },
      out_path: { type: 'string', description: 'Write the marked file here instead of changing the original.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

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
export function createProxy({ url, auth, fetchImpl = globalThis.fetch, write, log, tool = null, onTool = () => {}, approvals = null, vault = null, marker = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), approvalWaitMs = 180_000 }) {
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
  // An action the owner asked to approve first, in a few words.
  const actionText = (kind, s) => {
    const to = Array.isArray(s.to) ? s.to.join(', ') : s.to;
    if (kind === 'mail') return `email ${to}: "${s.subject}"`;
    if (kind === 'sms') return `text ${to}: "${String(s.text || '').slice(0, 120)}"`;
    if (kind === 'call') return `call ${to} and say "${String(s.say || '').slice(0, 120)}"`;
    if (kind === 'contacts') return `${s.change} the contact ${s.name || ''}`.trim();
    if (kind === 'vault') return `save "${s.label}" to its vault`;
    return 'do something you asked to approve first';
  };
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
    const what = details && details.kind !== 'payment' && details.summary ? actionText(details.kind, details.summary)
      : details ? `send ${dollars(details.amount)} to ${details.to}${details.memo ? ` ("${details.memo}")` : ''}` : data.summary ? 'do something you asked to approve first' : 'make a payment above your approval amount';
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
        const done = state === 'completed' && details?.kind && details.kind !== 'payment' ? 'Your owner approved it, and it was done.' : null;
        return respond({ ...status, status: state, message: done || OUTCOMES[state] || `It is ${state}.` });
      }
      await sleep(2000);
    }
    return respond({ ...data, message: `${data.message} No answer yet; check later with approval_status.` });
  }

  // vault_save, here: sealed to the vault's key, then saved.
  async function vaultSave(message) {
    const args = message.params?.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};
    const answer = (body, isError = false) => ({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], ...(isError ? { isError: true } : {}) } });
    try {
      const label = String(args.label ?? '').trim();
      if (!label) return answer('label is required: a name for it, like "Resend API".', true);
      const item = vaultItem({ kind: args.kind, secret: args.secret, hosts: args.hosts, as: args.send_as, site: args.site, username: args.username });
      const listed = await vault.list();
      if (!listed?.ready || !listed.publicKey) return answer(listed?.note || 'Your vault isn\'t set up yet. Your owner sets it up on the Agent ID website.', true);
      const saved = await vault.save({ label, envelope: seal(listed.publicKey, item) });
      log(`saved "${label}" in the vault, sealed on this computer`);
      return answer({ item: saved.item, message: `Saved, sealed on this computer. ${saved.item.kind === 'key' ? 'Use it with vault_request. ' : ''}Delete any other copy you kept.` });
    } catch (error) {
      return answer(error?.message || 'It could not be saved.', true);
    }
  }

  async function markHere(message) {
    const args = message.params?.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};
    const answer = (body, isError = false) => ({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], ...(isError ? { isError: true } : {}) } });
    try {
      if (typeof args.path !== 'string' || !args.path.trim()) return answer('path is required: the file to mark.', true);
      const { data, out } = await marker.mark(args.path, typeof args.out_path === 'string' && args.out_path.trim() ? args.out_path : null);
      log(`marked ${out} (${data.trace.id})`);
      return answer({ ...data, path: out });
    } catch (error) {
      return answer(error?.message || 'It could not be marked.', true);
    }
  }

  async function forward(message) {
    const request = isRequest(message);
    if (vault && request && message.method === 'tools/call' && message.params?.name === VAULT_SAVE_TOOL.name) return [await vaultSave(message)];
    if (marker && request && message.method === 'tools/call' && message.params?.name === TRACE_FILE_TOOL.name) return [await markHere(message)];
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
    // An agent with a vault can save into it, from here.
    if (vault && message.method === 'tools/list') {
      for (const reply of replies) {
        const tools = reply?.id === message.id ? reply.result?.tools : null;
        if (Array.isArray(tools) && tools.some(t => t?.name === 'vault_list') && !tools.some(t => t?.name === VAULT_SAVE_TOOL.name)) tools.push(VAULT_SAVE_TOOL);
      }
    }
    // And mark the files it makes here.
    if (marker && message.method === 'tools/list') {
      for (const reply of replies) {
        const tools = reply?.id === message.id ? reply.result?.tools : null;
        if (Array.isArray(tools) && tools.some(t => t?.name === 'trace_mark') && !tools.some(t => t?.name === TRACE_FILE_TOOL.name)) tools.push(TRACE_FILE_TOOL);
      }
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
  // Saving into the vault goes to Agent ID itself, sealed here first.
  const vault = remote ? null : {
    list: () => ctx.self.get('/v1/me/vault'),
    save: body => ctx.self.post('/v1/me/vault/items', body),
  };
  // Marking files on this computer goes to Agent ID itself too.
  const marker = remote ? null : { mark: (file, out) => markFile(ctx, file, out) };
  const proxy = createProxy({ url, auth, write, log, tool: ctx.tool, onTool: tool => { ctx.api.tool = tool; }, approvals, vault, marker });
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
