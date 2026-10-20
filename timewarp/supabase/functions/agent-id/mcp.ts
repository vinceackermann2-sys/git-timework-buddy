// Agent ID as an MCP server (Streamable HTTP, JSON responses), for Claude
// Code, Codex, Claude Desktop, Cursor and anything else that speaks MCP. It
// acts as one agent: the one whose key it was given. Only the tools for what
// the agent has are listed, so an agent without a card isn't told about cards.
import { ApiError, json } from './util.ts';
import type { AgentCaller } from './app.ts';
import type { Ctx } from './context.ts';
import { ops } from './agent.ts';
import { resourcesOf, verificationOf } from './shared.ts';
import { appForClient, appOfClient, recordApp } from './origin.ts';

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
type Schema = Record<string, unknown>;
type Tool = { name: string; op: string; needs?: string; description: string; properties?: Record<string, Schema>; required?: string[]; readOnly?: boolean; map?: (args: any) => any };

const s = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const n = (description: string): Schema => ({ type: 'integer', description });
const b = (description: string): Schema => ({ type: 'boolean', description });

const TOOLS: Tool[] = [
  { name: 'whoami', op: 'me', readOnly: true, description: 'Your Agent ID: your id, name, Git identity, your owner\'s verification and everything you have (mail address, phone number, wallet, card, machine).' },
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
  const reply = (body: Record<string, unknown>) => json({ jsonrpc: '2.0', id: message.id, ...body });
  switch (message.method) {
    case 'initialize': {
      await recordClient(ctx, who, message.params?.clientInfo).catch(error => console.error('[agent-id] client record', error?.message));
      const verification = await verificationOf(ctx, who.agent);
      return reply({ result: {
        protocolVersion: PROTOCOLS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'timewarp-agent-id', title: 'Timewarp Agent ID', version: '1.0.0' },
        instructions: `You are ${who.agent.name} (${who.agent.id}), an AI agent with a Timewarp Agent ID. ${verification.verified ? 'Your owner is verified, so you can be traced to a responsible person.' : 'Your owner has not verified their identity yet.'} These tools are your own mail, phone, wallet, card and machine: use them for your owner's tasks. Your owner sets your spending limits; transfers above the approval amount wait for their OK. Never paste card details, keys or passports into chat.`,
      } });
    }
    case 'ping': return reply({ result: {} });
    case 'tools/list': {
      const kinds = new Set((await resourcesOf(ctx, [who.agent.id])).filter(r => r.status !== 'released').map(r => r.kind as string));
      return reply({ result: { tools: toolList(kinds) } });
    }
    case 'tools/call': {
      const tool = TOOLS.find(item => item.name === message.params?.name);
      if (!tool) return reply({ error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } });
      const args = message.params?.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};
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
