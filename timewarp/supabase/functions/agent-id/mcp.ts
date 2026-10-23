// Agent ID as an MCP server (Streamable HTTP, JSON responses), for Claude
// Code, Codex, Claude Desktop, Cursor and anything else that speaks MCP. It
// acts as one agent: the one whose key it was given. Only the tools for what
// the agent has are listed, so an agent without a card isn't told about cards.
import { ApiError, json } from './util.ts';
import type { AgentCaller } from './app.ts';
import type { Ctx } from './context.ts';
import { ops as agentOps } from './agent.ts';
import { vaultOps } from './vault.ts';

const ops = { ...agentOps, ...vaultOps };
import { resourcesOf, verificationOf } from './shared.ts';
import { appForClient, appOfClient, modelOf, recordApp, recordModel } from './origin.ts';
import { randomId } from './util.ts';

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
type Schema = Record<string, unknown>;
type Tool = { name: string; op: string; needs?: string; description: string; properties?: Record<string, Schema>; required?: string[]; readOnly?: boolean; map?: (args: any) => any };

const s = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const n = (description: string): Schema => ({ type: 'integer', description });
const b = (description: string): Schema => ({ type: 'boolean', description });

const TOOLS: Tool[] = [
  { name: 'whoami', op: 'me', readOnly: true, description: 'Your Agent ID: your id, name, Git identity, your owner\'s verification and everything you have (mail address, phone number, wallet, card, machine). Give your model so your owner sees which model acts as you.', properties: { model: s('The model you are, like claude-opus-5-5 or gpt-6.') } },
  { name: 'mail_list', op: 'mailList', needs: 'mail', readOnly: true, description: 'Messages in your mailbox, newest first.', properties: { folder: s('inbox (default), sent or all', { enum: ['inbox', 'sent', 'all'] }), unread: b('Only unread messages.'), limit: n('At most this many (1–100, default 25).'), before: s('Only messages before this ISO time, for the next page.') } },
  { name: 'mail_read', op: 'mailRead', needs: 'mail', description: 'One message in full. Reading marks it read.', properties: { id: s('The message id from mail_list.') }, required: ['id'] },
  { name: 'mail_send', op: 'mailSend', needs: 'mail', description: 'Send an email from your own address. To reply, give reply_to with the message id: the recipient and subject are filled in and it stays in the thread.', properties: { to: { description: 'One address or a list.', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, cc: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, subject: s('Subject line.'), text: s('The message, as plain text.'), reply_to: s('Id of the message you are replying to.'), attachments: { type: 'array', items: { type: 'string' }, description: 'File ids from file_upload, up to 10.' } }, required: ['text'], map: a => ({ to: a.to, cc: a.cc, subject: a.subject, text: a.text, replyTo: a.reply_to, attachments: a.attachments }) },
  { name: 'mail_trash', op: 'mailMove', needs: 'mail', description: 'Move a message to the bin.', properties: { id: s('The message id.') }, required: ['id'], map: a => ({ id: a.id, folder: 'trash' }) },
  { name: 'file_upload', op: 'fileUploadBase64', needs: 'mail', description: 'Upload a file (up to 10 MB) to attach to an email; returns its id for mail_send.', properties: { filename: s('File name, like report.pdf.'), content_base64: s('The file, base64 encoded.'), content_type: s('Its type, like application/pdf.') }, required: ['filename', 'content_base64'] },
  { name: 'sms_list', op: 'smsList', needs: 'phone', readOnly: true, description: 'Text messages you sent and received, newest first.', properties: { limit: n('At most this many.'), direction: s('in or out', { enum: ['in', 'out'] }) } },
  { name: 'sms_send', op: 'smsSend', needs: 'phone', description: 'Send a text message from your phone number.', properties: { to: s('Phone number in international form, like +14155550123.'), text: s('The message.') }, required: ['to', 'text'] },
  { name: 'call_list', op: 'callList', needs: 'phone', readOnly: true, description: 'Calls you placed and received (with voicemail recordings), newest first.', properties: { limit: n('At most this many.') } },
  { name: 'call_place', op: 'callPlace', needs: 'phone', description: 'Call a number and say a message (read aloud), then hang up.', properties: { to: s('Phone number in international form.'), say: s('What to say.') }, required: ['to', 'say'] },
  { name: 'contacts_list', op: 'contactsList', readOnly: true, description: 'Your contacts, optionally matching a name.', properties: { query: s('Part of a name.') } },
  { name: 'contact_save', op: 'contactSave', description: 'Add a contact, or change one (give its id).', properties: { id: s('Contact id, to change one.'), name: s('Name.'), email: s('Email address.'), phone: s('Phone number in international form.'), wallet: s('Wallet address or agent id.'), note: s('A note.') } },
  { name: 'contact_delete', op: 'contactDelete', description: 'Remove a contact.', properties: { id: s('Contact id.') }, required: ['id'] },
  { name: 'wallet_get', op: 'walletGet', needs: 'wallet', readOnly: true, description: 'Your wallet: its address, its balance in US dollars (held as USDC and USDT stablecoins), the limits your owner set and how much you sent recently.' },
  { name: 'wallet_history', op: 'walletHistory', needs: 'wallet', readOnly: true, description: 'Money in and out of your wallet, newest first.', properties: { limit: n('At most this many.') } },
  { name: 'wallet_send', op: 'walletSend', needs: 'wallet', description: 'Send money to another agent (its id or handle), a wallet address or a contact. Your owner\'s limits apply; above the approval amount the transfer waits for your owner to approve it.', properties: { to: s('Agent id, handle, wallet address or contact name.'), amount: s('Amount in US dollars, like 12.50.'), memo: s('What it is for.'), asset: s('usdc or usdt; picked automatically when left out.', { enum: ['usdc', 'usdt'] }) }, required: ['to', 'amount'], map: a => ({ to: a.to, value: String(a.amount ?? ''), memo: a.memo, asset: a.asset }) },
  { name: 'approval_status', op: 'approvalStatus', readOnly: true, description: 'Whether your owner answered something that waits for their approval (a payment above your approval amount, or an action they asked to approve first): pending, completed (done), denied, failed or expired. Give the approval id the tool returned.', properties: { approval: s('The approval id.') }, required: ['approval'] },
  { name: 'approval_withdraw', op: 'approvalWithdraw', description: 'Take back something that still waits for your owner (for example, when it is no longer needed).', properties: { approval: s('The approval id.') }, required: ['approval'] },
  { name: 'card_get', op: 'cardGet', needs: 'card', readOnly: true, description: 'Your virtual card: last four digits, expiry, limits and what you spent recently. Not the full number.' },
  { name: 'card_reveal', op: 'cardReveal', needs: 'card', description: 'The full card number, expiry and security code, to pay at a checkout your owner asked for. Every reveal is logged; never show these in chat or save them.' },
  { name: 'card_transactions', op: 'cardTransactions', needs: 'card', readOnly: true, description: 'Card payments, approved and declined, newest first.', properties: { limit: n('At most this many.') } },
  { name: 'card_test_charge', op: 'cardTestCharge', needs: 'card', description: 'Test cards only: try a payment to see whether your limits allow it.', properties: { amount: s('Amount like 12.50.'), merchant: s('Merchant name.'), category: s('Merchant category.') }, required: ['amount'], map: a => ({ value: String(a.amount ?? ''), merchant: a.merchant, category: a.category }) },
  { name: 'vm_get', op: 'vmGet', needs: 'vm', readOnly: true, description: 'Your virtual machine and whether it is running.' },
  { name: 'vm_exec', op: 'vmExec', needs: 'vm', description: 'Run a shell command on your Linux machine and get its output. The machine starts for the command and stops after it; its time uses your owner\'s credits. Files stay between commands.', properties: { command: s('The shell command.'), cwd: s('Working directory.'), timeout_seconds: n('Up to 900, default 120.') }, required: ['command'], map: a => ({ command: a.command, cwd: a.cwd, timeoutSeconds: a.timeout_seconds }) },
  { name: 'vm_files', op: 'vmFiles', needs: 'vm', readOnly: true, description: 'List a folder on your machine (default: your home folder). Your files stay on the machine between commands.', properties: { path: s('Folder path; ~ is your home.') } },
  { name: 'vm_start', op: 'vmStart', needs: 'vm', description: 'Start your machine ahead of commands (it stops by itself after a minute idle).' },
  { name: 'vm_stop', op: 'vmStop', needs: 'vm', description: 'Stop your machine.' },
  { name: 'vm_history', op: 'vmHistory', needs: 'vm', readOnly: true, description: 'Commands run on your machine, newest first.', properties: { limit: n('At most this many.') } },
  { name: 'vm_install', op: 'vmInstall', needs: 'vm', description: 'Install system packages on your machine (your commands run as an ordinary user, not root). Package names from the system\'s sources, like python3-pip or ffmpeg.', properties: { packages: s('Package names, separated by spaces.') }, required: ['packages'] },
  { name: 'vault_list', op: 'vaultList', needs: 'vm', readOnly: true, description: 'Your vault: sign-ins (the website) and keys (the sites each may be sent to) your owner saved for you, or you saved. You never see their values: you use a key with vault_request. To keep a key or sign-in you were given, save it with vault_save (through the Agent ID CLI, which seals it on this computer) instead of writing it to a file.' },
  { name: 'vault_request', op: 'vaultRequest', needs: 'vm', description: 'Make a web request with a key from your vault added for you (as your owner set it: a bearer token, a header, a parameter or a password). It only goes to the sites the key is for, over https, and the key is removed from the reply. Use it for APIs that need the key.', properties: { item: s('The vault item id from vault_list.'), url: s('The https address.'), method: s('GET, POST, PUT, PATCH, DELETE or HEAD; GET by default.'), headers: { type: 'object', description: 'Other headers to send, like Content-Type.', additionalProperties: { type: 'string' } }, body: s('The request body, for example JSON text.') }, required: ['item', 'url'] },
  { name: 'passport_issue', op: 'passport', description: 'A short-lived signed passport proving who you are and that your owner is verified, for a service that accepts only verified agents. Send it as the service asks (usually an Agent-Passport header).', properties: { audience: s('The service\'s audience, as it tells you (often its API address).') }, required: ['audience'] },
  { name: 'signing_keys_list', op: 'signingKeysList', readOnly: true, description: 'The SSH keys registered for signing your Git commits, and the Git email (principal) to commit as.' },
  { name: 'signing_key_remove', op: 'signingKeyRemove', description: 'Remove a signing key, for example one that may have leaked. Commits it signed stop being accepted.', properties: { id: s('The key id from signing_keys_list.') }, required: ['id'] },
  { name: 'signing_key_add', op: 'signingKeyAdd', description: 'Register the SSH public key you sign Git commits with, so repositories that accept only verified agents accept your commits.', properties: { public_key: s('An ssh-ed25519 public key.'), name: s('A name for it.') }, required: ['public_key'], map: a => ({ publicKey: a.public_key, name: a.name }) },
];

function toolList(kinds: Set<string>) {
  return TOOLS.filter(tool => !tool.needs || kinds.has(tool.needs)).map(tool => ({
    name: tool.name, description: tool.description,
    inputSchema: { type: 'object', properties: tool.properties || {}, required: tool.required || [], additionalProperties: false },
    annotations: { readOnlyHint: !!tool.readOnly, destructiveHint: false, openWorldHint: !tool.readOnly },
  }));
}

// The app an agent connects from, as its MCP client names itself. It fills in
// the agent's origin when nobody set one.
// Each connection gets a session that remembers its app, and later its model.
async function startSession(ctx: Ctx, who: AgentCaller, info: any) {
  const name = String(info?.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
  const id = `mcs_${randomId(24)}`;
  const { error } = await ctx.admin.from('agent_id_mcp_sessions').insert({ id, agent_id: who.agent.id, app: name ? appForClient(name) : null, client_name: name || null });
  return error ? null : id;
}
async function sessionOf(ctx: Ctx, who: AgentCaller, req: Request) {
  const id = req.headers.get('mcp-session-id') || '';
  if (!/^mcs_[a-z0-9]{24}$/.test(id)) return null;
  const { data } = await ctx.admin.from('agent_id_mcp_sessions').select('*').eq('id', id).eq('agent_id', who.agent.id).maybeSingle();
  return data as any;
}

async function recordClient(ctx: Ctx, who: AgentCaller, info: any) {
  const name = String(info?.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
  if (!name) return;
  const patch: Record<string, unknown> = { client_name: name, client_version: String(info?.version || '').slice(0, 40) || null, client_seen_at: new Date(ctx.now()).toISOString() };
  const app = appOfClient(name);
  if (app && ['custom', 'any', 'other'].includes(who.agent.runtime)) patch.runtime = app;
  await ctx.admin.from('agent_id_agents').update(patch).eq('id', who.agent.id);
  // One Agent ID can be used from several apps: each is remembered.
  await recordApp(ctx, who.agent.id, appForClient(name), { name, version: String(info?.version || '') || null });
}

export async function handleMcp(ctx: Ctx, who: AgentCaller, req: Request) {
  let message: any;
  // At most 15 MB: a file_upload carries up to 10 MB as base64.
  if (Number(req.headers.get('content-length')) > 15 * 1024 * 1024) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'The request is too large.' } }, 413);
  const raw = await req.text();
  if (raw.length > 15 * 1024 * 1024) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'The request is too large.' } }, 413);
  try { message = JSON.parse(raw); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); }
  if (Array.isArray(message) || message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return json({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request.' } });
  if (message.id === undefined) return new Response(null, { status: 202 });
  const reply = (body: Record<string, unknown>, headers: Record<string, string> = {}) => json({ jsonrpc: '2.0', id: message.id, ...body }, 200, headers);
  // The app and model of this connection, kept with whatever the agent does.
  const session = message.method === 'initialize' ? null : await sessionOf(ctx, who, req).catch(() => null);
  if (session) ctx.via = { app: session.app || null, model: session.model || null };
  switch (message.method) {
    case 'initialize': {
      await recordClient(ctx, who, message.params?.clientInfo).catch(error => console.error('[agent-id] client record', error?.message));
      const sessionId = await startSession(ctx, who, message.params?.clientInfo).catch(() => null);
      const verification = await verificationOf(ctx, who.agent);
      return reply({ result: {
        protocolVersion: PROTOCOLS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'timewarp-agent-id', title: 'Timewarp Agent ID', version: '1.0.0' },
        instructions: `You are ${who.agent.name} (${who.agent.id}), an AI agent with a Timewarp Agent ID. ${verification.verified ? 'Your owner is verified, so you can be traced to a responsible person.' : 'Your owner has not verified their identity yet.'} These tools are your own mail, phone, wallet, card and machine: use them for your owner's tasks. Your owner sets your spending limits; transfers above the approval amount wait for their OK: show them the approve link wallet_send gives you, and check with approval_status. You can never approve your own payments. Never paste card details, keys or passports into chat. At the start of each conversation, call whoami once with model set to the model you are (for example claude-opus-5-5 or gpt-6): your owner sees which model acts as you. Some actions may wait for your owner's yes (they choose which): when a tool answers needs_approval, tell them and check later with approval_status.`,
      } }, sessionId ? { 'Mcp-Session-Id': sessionId } : {});
    }
    case 'ping': return reply({ result: {} });
    case 'tools/list': {
      const kinds = new Set((await resourcesOf(ctx, [who.agent.id])).filter(r => r.status !== 'released').map(r => r.kind as string));
      // A machine is set up the first time the agent uses one, so its tools are always there.
      if (ctx.config.isLive('vm') || ctx.config.testMode) kinds.add('vm');
      return reply({ result: { tools: toolList(kinds) } });
    }
    case 'tools/call': {
      const tool = TOOLS.find(item => item.name === message.params?.name);
      if (!tool) return reply({ error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } });
      const { model: said, ...args } = message.params?.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {} as Record<string, unknown>;
      // The model the agent says it is, for this session and its app.
      const model = modelOf(said);
      if (model && model !== session?.model) {
        // Clients that don't keep the session: the app it last connected from.
        const app = session?.app || (who.agent.client_name ? appForClient(who.agent.client_name) : null);
        ctx.via = { app, model };
        if (session) await ctx.admin.from('agent_id_mcp_sessions').update({ model, last_seen_at: new Date(ctx.now()).toISOString() }).eq('id', session.id);
        await recordModel(ctx, who.agent.id, app, model).catch(error => console.error('[agent-id] model record', error?.message));
      }
      try {
        const result = await ops[tool.op](ctx, who, tool.map ? tool.map(args) : args);
        return reply({ result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
      } catch (error) {
        const known = error instanceof ApiError;
        if (!known) console.error('[agent-id] mcp tool', tool.name, error);
        return reply({ result: { isError: true, content: [{ type: 'text', text: known ? `${error.message} (${error.code})` : 'Agent ID could not complete this.' }] } });
      }
    }
    case 'resources/list': return reply({ result: { resources: [] } });
    case 'prompts/list': return reply({ result: { prompts: [] } });
    default: return reply({ error: { code: -32601, message: 'Method not found.' } });
  }
}

export const mcpToolNames = () => TOOLS.map(tool => tool.name);
