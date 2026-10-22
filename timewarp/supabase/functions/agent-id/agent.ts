// What an agent can do as itself, headless: read and send mail, texts and
// calls, keep contacts, pay from its wallet and card within its owner's
// limits, run commands on its machine, and prove who it is. The REST routes
// below and the MCP tools (mcp.ts) are two doors to these same operations.
import { cents, checked, CORS, emailAddress, fail, fromBase64, int, phoneNumber, randomId, str, toBase64 } from './util.ts';
import { fileBytes, filesOf, fileView, MAX_FILE, ownFiles, removeFiles, saveFile, shareFiles } from './files.ts';
import { AI_COST_MARKUP, USD_PER_CREDIT } from './pricing.ts';
import type { AgentCaller, Route } from './app.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { agentView, audit, eventView, listEvents, organizationName, principalOf, rateLimit, resourceFor, resourcesOf, verificationOf } from './shared.ts';
import { pairwiseOwner, signJwt } from './passport.ts';
import { sendResend } from './providers/mail.ts';
import { placeCall, sendSms } from './providers/phone.ts';
import { actionStatus, ASSETS, type Asset, EVM_ADDRESS, explorerUrl, liveBalance, liveTransactions, sanctioned, sendStablecoin } from './providers/wallet.ts';
import { revealCard } from './providers/card.ts';
import { machineCost, machineState, runCommand, startMachine, stopMachine, type Size } from './providers/vm.ts';
import { parseSshKey } from './ssh.ts';
import { appOf, recordApp } from './origin.ts';
import { giveResource } from './provisioning.ts';
import { agentCommand, installCommand, PACKAGE } from './vault/shell.ts';

type Op = (ctx: Ctx, who: AgentCaller, input: any) => Promise<unknown>;
const actor = (who: AgentCaller) => who.via === 'owner' ? 'owner' as const : 'agent' as const;
import { approvalUrl, askFirst, mailOwner } from './ask.ts';

async function seen(ctx: Ctx, agent: AgentRow) {
  if (agent.last_seen_at && ctx.now() - Date.parse(agent.last_seen_at) < 60_000) return;
  await ctx.admin.from('agent_id_agents').update({ last_seen_at: new Date(ctx.now()).toISOString() }).eq('id', agent.id);
}

async function record(ctx: Ctx, resource: ResourceRow, fields: { kind: string; direction: 'in' | 'out' | 'none'; status: string; counterparty?: string | null; subject?: string | null; body?: string | null; amount?: number | null; currency?: string | null; providerRef?: string | null; thread?: string | null; data?: Record<string, unknown> }) {
  const result = checked(await ctx.admin.rpc('agent_id_record_event', {
    p_resource: resource.id, p_kind: fields.kind, p_direction: fields.direction, p_status: fields.status,
    p_counterparty: fields.counterparty ?? null, p_subject: fields.subject ?? null, p_body: fields.body ?? null,
    p_amount: fields.amount ?? null, p_currency: fields.currency ?? null, p_provider_ref: fields.providerRef ?? null,
    p_thread: fields.thread ?? null, p_data: fields.data ?? {},
  })) as any;
  if (result?.status === 'not_found') throw fail(404, 'not_found', 'That resource no longer exists.');
  return String(result.id);
}
const eventById = async (ctx: Ctx, id: string) => eventView(checked(await ctx.admin.from('agent_id_events').select('*').eq('id', id).single()));

// Another agent's active resource of this kind and mode at this address.
async function internalResource(ctx: Ctx, kind: 'mail' | 'phone' | 'wallet', mode: string, address: string) {
  const rows = (checked(await ctx.admin.from('agent_id_resources').select('*').eq('kind', kind).eq('mode', mode).eq('status', 'active').ilike('address', address.replace(/[%_\\]/g, '\\$&')).limit(1)) || []) as ResourceRow[];
  return rows[0] || null;
}

// --- Mail --------------------------------------------------------------------
function addresses(value: unknown, field: string) {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : String(value).split(',');
  return [...new Set(list.map(item => emailAddress(item, field)))];
}

const FOLDERS = ['inbox', 'sent', 'trash', 'all'];
// A mailbox page, newest first: one folder (all = everything but the bin),
// optionally unread only or matching `q` in the subject, body or address.
const mailList: Op = async (ctx, who, input) => {
  await resourceFor(ctx, who.agent.id, 'mail');
  const folder = FOLDERS.includes(input.folder) ? input.folder : 'inbox';
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 25));
  let query = ctx.admin.from('agent_id_events').select('*').eq('agent_id', who.agent.id).eq('kind', 'mail');
  query = folder === 'all' ? query.neq('folder', 'trash') : query.eq('folder', folder);
  if (input.unread === true || input.unread === 'true' || input.unread === '1') query = query.is('read_at', null).eq('direction', 'in');
  const q = str(input.q, 100, 'q').replace(/[,()%*\\]/g, ' ').trim();
  if (q) query = query.or(['subject', 'body', 'counterparty'].map(column => `${column}.ilike.%${q}%`).join(','));
  if (input.before && !Number.isNaN(Date.parse(String(input.before)))) query = query.lt('occurred_at', new Date(String(input.before)).toISOString());
  const rows = (checked(await query.order('occurred_at', { ascending: false }).limit(limit + 1)) || []) as any[];
  const page = rows.slice(0, limit), files = await filesOf(ctx, page.map(row => row.id));
  return {
    messages: page.map(row => { const { text, ...message } = eventView(row); return { ...message, preview: String(text || '').replace(/\s+/g, ' ').slice(0, 200), attachments: files.get(row.id) || [] }; }),
    more: rows.length > limit,
  };
};

const mailCounts: Op = async (ctx, who) => {
  await resourceFor(ctx, who.agent.id, 'mail');
  const rows = (checked(await ctx.admin.from('agent_id_events').select('folder,read_at,direction').eq('agent_id', who.agent.id).eq('kind', 'mail').limit(10000)) || []) as any[];
  const count = (folder: string) => rows.filter(row => row.folder === folder).length;
  return { inbox: { total: count('inbox'), unread: rows.filter(row => row.folder === 'inbox' && !row.read_at).length }, sent: { total: count('sent') }, trash: { total: count('trash') } };
};

async function ownMessage(ctx: Ctx, who: AgentCaller, id: unknown) {
  const row = checked(await ctx.admin.from('agent_id_events').select('*').eq('id', str(id, 60, 'id', { required: true })).eq('agent_id', who.agent.id).eq('kind', 'mail').maybeSingle()) as any;
  if (!row) throw fail(404, 'not_found', 'No message with that id.');
  return row;
}

// Reading marks a message read when the agent itself reads it; the owner
// looking on the dashboard leaves it for the agent.
const mailRead: Op = async (ctx, who, input) => {
  const row = await ownMessage(ctx, who, input.id);
  if (!row.read_at && row.direction === 'in' && who.via === 'key') await ctx.admin.from('agent_id_events').update({ read_at: new Date(ctx.now()).toISOString() }).eq('id', row.id);
  return { message: { ...eventView(row), attachments: (await filesOf(ctx, [row.id])).get(row.id) || [] } };
};
const mailMarkRead: Op = async (ctx, who, input) => {
  const row = await ownMessage(ctx, who, input.id);
  await ctx.admin.from('agent_id_events').update({ read_at: input.read === false ? null : new Date(ctx.now()).toISOString() }).eq('id', row.id);
  return { read: input.read !== false };
};
// To the bin and back: a restored message returns to the folder it was in.
const mailMove: Op = async (ctx, who, input) => {
  const row = await ownMessage(ctx, who, input.id);
  if (input.folder !== 'trash' && input.folder !== 'inbox') throw fail(400, 'invalid', 'folder is trash or inbox (to restore).');
  const folder = input.folder === 'trash' ? 'trash' : (row.data?.previousFolder || (row.direction === 'in' ? 'inbox' : 'sent'));
  await ctx.admin.from('agent_id_events').update({ folder, data: { ...row.data, previousFolder: row.folder === 'trash' ? row.data?.previousFolder : row.folder } }).eq('id', row.id);
  return { folder };
};
const mailDelete: Op = async (ctx, who, input) => {
  const row = await ownMessage(ctx, who, input.id);
  if (row.folder !== 'trash') throw fail(409, 'not_in_trash', 'Move the message to the bin first; deleting from the bin is permanent.');
  await removeFiles(ctx, row.id);
  checked(await ctx.admin.from('agent_id_events').delete().eq('id', row.id).select('id'));
  await audit(ctx, who.userId, who.agent.id, actor(who), 'mail.delete', {});
  return { deleted: true };
};

// --- Files -------------------------------------------------------------------
// The raw file is the request body; its name comes in x-filename.
export async function fileUpload(ctx: Ctx, who: AgentCaller, req: Request) {
  if (Number(req.headers.get('content-length')) > MAX_FILE) throw fail(413, 'too_large', 'A file can be at most 10 MB.');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) throw fail(400, 'invalid', 'Send the file as the request body.');
  let filename = req.headers.get('x-filename') || 'file';
  try { filename = decodeURIComponent(filename); } catch { /* as given */ }
  await rateLimit(ctx, who.userId, `files:${who.agent.id}`, 30, 500, 'uploads');
  const row = await saveFile(ctx, who.agent, { filename, contentType: req.headers.get('content-type') || undefined, bytes });
  return { file: fileView(row) };
}
const fileUploadBase64: Op = async (ctx, who, input) => {
  const content = str(input.content_base64 ?? input.contentBase64, 14_000_000, 'content_base64', { required: true });
  let bytes: Uint8Array;
  try { bytes = fromBase64(content.replace(/\s+/g, '')); } catch { throw fail(400, 'invalid', 'content_base64 is not valid base64.'); }
  await rateLimit(ctx, who.userId, `files:${who.agent.id}`, 30, 500, 'uploads');
  return { file: fileView(await saveFile(ctx, who.agent, { filename: str(input.filename, 255, 'filename', { required: true }), contentType: input.content_type ?? input.contentType, bytes })) };
};
export async function fileDownload(ctx: Ctx, who: AgentCaller, id: string) {
  const row = /^[0-9a-f-]{36}$/.test(id) ? checked(await ctx.admin.from('agent_id_files').select('*').eq('id', id).eq('agent_id', who.agent.id).maybeSingle()) : null;
  if (!row) throw fail(404, 'not_found', 'No file with that id.');
  const bytes = await fileBytes(ctx, row);
  return new Response(bytes, { headers: { ...CORS, 'content-type': row.content_type, 'content-length': String(bytes.byteLength), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}

const mailSend: Op = async (ctx, who, input) => {
  const resource = await resourceFor(ctx, who.agent.id, 'mail');
  let to = addresses(input.to, 'to'), subject = str(input.subject, 998, 'subject'), inReplyTo: string | undefined, thread: string | null = null;
  const cc = addresses(input.cc, 'cc');
  if (input.replyTo) {
    const original = checked(await ctx.admin.from('agent_id_events').select('*').eq('id', str(input.replyTo, 60, 'replyTo')).eq('agent_id', who.agent.id).eq('kind', 'mail').maybeSingle()) as any;
    if (!original) throw fail(404, 'not_found', 'The message to reply to was not found.');
    if (!to.length && original.direction === 'in' && original.counterparty) to = [emailAddress(original.counterparty, 'to')];
    if (!subject) subject = /^re:/i.test(original.subject || '') ? original.subject : `Re: ${original.subject || ''}`.trim();
    // The original's Message-ID came from outside: only a well-formed one is reused.
    inReplyTo = /^<[^<>\s]{1,250}>$/.test(String(original.data?.messageId || '')) ? original.data.messageId : undefined;
    thread = original.thread || original.id;
  }
  if (!to.length) throw fail(400, 'invalid', 'to is required.');
  if (to.length + cc.length > 20) throw fail(400, 'invalid', 'A message can go to at most 20 people.');
  if (!subject) throw fail(400, 'invalid', 'subject is required.');
  const body = str(input.text, 100_000, 'text', { required: true, multiline: true });
  const html = input.html ? str(input.html, 200_000, 'html', { multiline: true }) : undefined;
  const files = await ownFiles(ctx, who.agent.id, input.attachments);
  const waiting = await askFirst(ctx, who, 'mail', 'mailSend', input, { to, cc, subject, preview: body.slice(0, 500), attachments: files.length }, resource.mode);
  if (waiting) return waiting;
  await rateLimit(ctx, who.userId, `mail:${who.agent.id}`, 10, 200, 'emails');
  let status = 'sent', providerRef: string | null = null;
  const delivered: string[] = [];
  if (resource.mode === 'live') {
    const attachments = [];
    for (const file of files) attachments.push({ filename: file.filename, content: toBase64(await fileBytes(ctx, file)), content_type: file.content_type });
    providerRef = await sendResend(ctx, resource, who.agent, { to, cc, subject, text: body, html, inReplyTo, attachments }, `agent-id/${who.agent.id}/${crypto.randomUUID()}`);
  } else {
    // Test mail reaches other test inboxes only.
    for (const address of [...to, ...cc]) {
      const inbox = await internalResource(ctx, 'mail', 'test', address);
      if (!inbox) continue;
      const received = await record(ctx, inbox, { kind: 'mail', direction: 'in', status: 'received', counterparty: resource.address, subject, body, data: { to, cc, fromAgent: who.agent.id } });
      await shareFiles(ctx, files, inbox, received);
      delivered.push(address);
    }
    status = delivered.length === to.length + cc.length ? 'delivered' : 'simulated';
  }
  const id = await record(ctx, resource, { kind: 'mail', direction: 'out', status, counterparty: to.join(', '), subject, body, providerRef, thread, data: { to, cc, ...(html ? { html: html.slice(0, 50_000) } : {}), ...(resource.mode === 'test' ? { deliveredTo: delivered } : {}) } });
  // An upload belongs to the first message it goes out with; sending it again makes a copy.
  const fresh = files.filter(file => !file.event_id);
  if (fresh.length) await ctx.admin.from('agent_id_files').update({ event_id: id }).in('id', fresh.map(file => file.id));
  await shareFiles(ctx, files.filter(file => file.event_id), { agent_id: who.agent.id, owner_user_id: who.agent.owner_user_id }, id);
  await audit(ctx, who.userId, who.agent.id, actor(who), 'mail.send', { to: to.length + cc.length, mode: resource.mode, attachments: files.length });
  return { message: { ...(await eventById(ctx, id)), attachments: (await filesOf(ctx, [id])).get(id) || [] }, ...(status === 'simulated' ? { note: 'Test inboxes only deliver to other Agent ID test inboxes; this message was recorded but not sent.' } : {}) };
};

// --- Phone -------------------------------------------------------------------
const smsList: Op = async (ctx, who, input) => { await resourceFor(ctx, who.agent.id, 'phone'); const page = await listEvents(ctx, who.agent.id, ['sms'], input); return { messages: page.events, more: page.more }; };
const callList: Op = async (ctx, who, input) => { await resourceFor(ctx, who.agent.id, 'phone'); const page = await listEvents(ctx, who.agent.id, ['call'], input); return { calls: page.events, more: page.more }; };

const smsSend: Op = async (ctx, who, input) => {
  const resource = await resourceFor(ctx, who.agent.id, 'phone');
  const to = phoneNumber(input.to), body = str(input.text, 1600, 'text', { required: true, multiline: true });
  const waiting = await askFirst(ctx, who, 'sms', 'smsSend', input, { to, text: body }, resource.mode);
  if (waiting) return waiting;
  await rateLimit(ctx, who.userId, `sms:${who.agent.id}`, 10, 100, 'texts');
  let status: string, providerRef: string | null = null;
  if (resource.mode === 'live') ({ status, providerRef } = await sendSms(ctx, resource, to, body));
  else {
    const phone = await internalResource(ctx, 'phone', 'test', to);
    if (phone) await record(ctx, phone, { kind: 'sms', direction: 'in', status: 'received', counterparty: resource.address, body, data: { fromAgent: who.agent.id } });
    status = phone ? 'delivered' : 'simulated';
  }
  const id = await record(ctx, resource, { kind: 'sms', direction: 'out', status, counterparty: to, body, providerRef });
  await audit(ctx, who.userId, who.agent.id, actor(who), 'sms.send', { mode: resource.mode });
  return { message: await eventById(ctx, id) };
};

const callPlace: Op = async (ctx, who, input) => {
  const resource = await resourceFor(ctx, who.agent.id, 'phone');
  const to = phoneNumber(input.to), say = str(input.say, 1000, 'say', { required: true, multiline: true });
  const waiting = await askFirst(ctx, who, 'call', 'callPlace', input, { to, say }, resource.mode);
  if (waiting) return waiting;
  await rateLimit(ctx, who.userId, `call:${who.agent.id}`, 3, 30, 'calls');
  let status: string, providerRef: string | null = null;
  if (resource.mode === 'live') ({ status, providerRef } = await placeCall(ctx, resource, to, say));
  else {
    const phone = await internalResource(ctx, 'phone', 'test', to);
    if (phone) await record(ctx, phone, { kind: 'call', direction: 'in', status: 'completed', counterparty: resource.address, body: say, data: { fromAgent: who.agent.id } });
    status = phone ? 'completed' : 'simulated';
  }
  const id = await record(ctx, resource, { kind: 'call', direction: 'out', status, counterparty: to, body: say, providerRef });
  await audit(ctx, who.userId, who.agent.id, actor(who), 'call.place', { mode: resource.mode });
  return { call: await eventById(ctx, id) };
};

// --- Contacts ----------------------------------------------------------------
const contactView = (row: any) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, wallet: row.wallet, note: row.note, updatedAt: row.updated_at });
const contactsList: Op = async (ctx, who, input) => {
  let query = ctx.admin.from('agent_id_contacts').select('*').eq('agent_id', who.agent.id);
  const q = str(input.q ?? input.query, 100, 'q');
  if (q) query = query.ilike('name', `%${q.replace(/[%_\\]/g, '\\$&')}%`);
  return { contacts: ((checked(await query.order('name').limit(200)) || []) as any[]).map(contactView) };
};
const contactSave: Op = async (ctx, who, input) => {
  const fields = {
    name: str(input.name, 120, 'name', { required: !input.id }),
    email: input.email ? emailAddress(input.email, 'email') : null,
    phone: input.phone ? phoneNumber(input.phone, 'phone') : null,
    wallet: input.wallet ? str(input.wallet, 300, 'wallet') : null,
    note: input.note ? str(input.note, 1000, 'note', { multiline: true }) : null,
    updated_at: new Date(ctx.now()).toISOString(),
  };
  const waiting = await askFirst(ctx, who, 'contacts', 'contactSave', input, { change: input.id ? 'update' : 'add', name: fields.name || null, email: fields.email, phone: fields.phone, wallet: fields.wallet });
  if (waiting) return waiting;
  if (input.id) {
    const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => key === 'updated_at' || input[key] !== undefined));
    const row = checked(await ctx.admin.from('agent_id_contacts').update(patch).eq('id', str(input.id, 60, 'id')).eq('agent_id', who.agent.id).select('*').maybeSingle());
    if (!row) throw fail(404, 'not_found', 'No contact with that id.');
    return { contact: contactView(row) };
  }
  const count = (checked(await ctx.admin.from('agent_id_contacts').select('id').eq('agent_id', who.agent.id)) || []) as any[];
  if (count.length >= 1000) throw fail(409, 'too_many', 'An agent can keep at most 1000 contacts.');
  return { contact: contactView(checked(await ctx.admin.from('agent_id_contacts').insert({ agent_id: who.agent.id, ...fields }).select('*').single())) };
};
const contactDelete: Op = async (ctx, who, input) => {
  const id = str(input.id, 60, 'id', { required: true });
  const contact = checked(await ctx.admin.from('agent_id_contacts').select('*').eq('id', id).eq('agent_id', who.agent.id).maybeSingle()) as any;
  if (!contact) throw fail(404, 'not_found', 'No contact with that id.');
  const waiting = await askFirst(ctx, who, 'contacts', 'contactDelete', { id }, { change: 'delete', name: contact.name });
  if (waiting) return waiting;
  const rows = checked(await ctx.admin.from('agent_id_contacts').delete().eq('id', id).eq('agent_id', who.agent.id).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No contact with that id.');
  return { deleted: true };
};

// --- Wallet ------------------------------------------------------------------
async function spent(ctx: Ctx, resource: ResourceRow, kind: 'wallet' | 'card', statuses: string[]) {
  const since = (days: number) => new Date(ctx.now() - days * 86_400_000).toISOString();
  // The owner's withdrawals aren't the agent spending.
  const rows = ((checked(await ctx.admin.from('agent_id_events').select('amount_minor,occurred_at,data').eq('resource_id', resource.id).eq('kind', kind).eq('direction', 'out').in('status', statuses).gte('occurred_at', since(30))) || []) as any[]).filter(row => !row.data?.withdrawal);
  const sum = (days: number) => rows.filter(row => row.occurred_at >= since(days)).reduce((total, row) => total + Number(row.amount_minor || 0), 0);
  return { last24Hours: sum(1), last30Days: sum(30) };
}
const asMoney = (amount: number | null, currency: string | null) => amount === null ? null : { amount, currency: currency || 'USD', display: `${(amount / 100).toFixed(2)} ${currency || 'USD'}` };

const usd = (amount: number | null) => asMoney(amount, 'USD');
const chainOf = (ctx: Ctx, resource: ResourceRow) => String(resource.state?.chain || ctx.config.walletChain);

async function finishLive(ctx: Ctx, resource: ResourceRow, eventId: string, action: { status: string; hash: string | null; reason: string | null }) {
  const ok = action.status === 'succeeded';
  checked(await ctx.admin.rpc('agent_id_finish_transfer', { p_event: eventId, p_ok: ok, p_provider_ref: action.hash, p_data: ok ? (action.hash ? { hash: action.hash, explorer: explorerUrl(chainOf(ctx, resource), action.hash) } : {}) : { error: action.reason || 'The transfer did not go through.' } }));
}

// A live wallet's provider activity brought into its history: money that
// arrived, and transfers that finished on chain after they were sent. At most
// every 20 seconds per wallet.
async function syncLive(ctx: Ctx, resource: ResourceRow) {
  if (resource.mode !== 'live' || resource.provider !== 'privy') return;
  if (ctx.now() - (Date.parse(resource.state?.syncedAt || '') || 0) < 20_000) return;
  await ctx.admin.from('agent_id_resources').update({ state: { ...resource.state, syncedAt: new Date(ctx.now()).toISOString() } }).eq('id', resource.id);
  const pending = (checked(await ctx.admin.from('agent_id_events').select('id,data').eq('resource_id', resource.id).eq('kind', 'wallet').eq('direction', 'out').eq('status', 'pending')) || []) as any[];
  for (const row of pending) {
    if (!row.data?.action) continue;
    const action = await actionStatus(ctx, resource, row.data.action).catch(() => null);
    if (action && action.status !== 'pending') await finishLive(ctx, resource, row.id, action);
  }
  for (const tx of await liveTransactions(ctx, resource).catch(() => [])) {
    if (tx.direction !== 'in' || !tx.hash || !['confirmed', 'finalized'].includes(tx.status)) continue;
    await record(ctx, resource, { kind: 'wallet', direction: 'in', status: 'completed', counterparty: tx.counterparty, amount: tx.amount, currency: 'USD', providerRef: tx.hash, data: { asset: tx.asset, hash: tx.hash, explorer: explorerUrl(chainOf(ctx, resource), tx.hash) } });
  }
}

const walletGet: Op = async (ctx, who) => {
  const resource = await resourceFor(ctx, who.agent.id, 'wallet');
  let balance: number | null = Number(resource.balance_minor), assets: { asset: string; amount: number }[] = [], balanceError: string | undefined;
  if (resource.mode === 'live') {
    await syncLive(ctx, resource).catch(error => console.error('[agent-id] wallet sync', error?.message));
    try { ({ total: balance, assets } = await liveBalance(ctx, resource)); } catch (error) { balance = null; balanceError = (error as Error).message; }
  }
  const used = await spent(ctx, resource, 'wallet', ['pending', 'completed']);
  return {
    wallet: {
      address: resource.address, mode: resource.mode, provider: resource.mode === 'live' ? resource.provider : 'test', label: resource.label,
      network: resource.mode === 'live' ? chainOf(ctx, resource) : 'test', currency: 'USD',
      balance: usd(balance), assets: assets.map(a => ({ asset: a.asset, amount: usd(a.amount) })), ...(balanceError ? { balanceError } : {}),
      limits: resource.settings, sent: { last24Hours: usd(used.last24Hours), last30Days: usd(used.last30Days) },
    },
  };
};
const walletHistory: Op = async (ctx, who, input) => {
  const resource = await resourceFor(ctx, who.agent.id, 'wallet');
  await syncLive(ctx, resource).catch(error => console.error('[agent-id] wallet sync', error?.message));
  const page = await listEvents(ctx, who.agent.id, ['wallet'], input);
  return { transactions: page.events, more: page.more };
};

// Which stablecoin pays: the one asked for, else USDC if it covers the
// amount, else USDT.
async function payingAsset(ctx: Ctx, resource: ResourceRow, amount: number, wanted?: string): Promise<Asset> {
  if (wanted) return wanted as Asset;
  const { assets } = await liveBalance(ctx, resource);
  const has = (asset: string) => (assets.find(a => a.asset === asset)?.amount || 0) >= amount;
  if (has('USDC')) return 'usdc';
  if (has('USDT')) return 'usdt';
  throw fail(402, 'insufficient', 'The wallet doesn\'t have enough USDC or USDT for this (one stablecoin has to cover it).');
}

// Who `to` names: another agent (id or handle), a wallet address, or a
// contact with a wallet. Live wallets may also pay any 0x address.
async function recipient(ctx: Ctx, who: AgentCaller, from: ResourceRow, to: string, depth = 0): Promise<{ resource: ResourceRow | null; address: string; label: string }> {
  let agent: AgentRow | null = null;
  if (/^agt_[a-z0-9]{24}$/.test(to)) agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', to).maybeSingle());
  else if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(to)) agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('handle', to).maybeSingle());
  if (agent) {
    const wallet = agent.status === 'active' ? await resourceFor(ctx, agent.id, 'wallet', { required: false }) : null;
    if (!wallet || wallet.status !== 'active' || wallet.mode !== from.mode) throw fail(400, 'unknown_recipient', `${agent.name} has no ${from.mode} wallet to receive this.`);
    return { resource: wallet, address: wallet.address!, label: `${agent.name} (${agent.id})` };
  }
  const wallet = await internalResource(ctx, 'wallet', from.mode, to);
  if (wallet) return { resource: wallet, address: wallet.address!, label: wallet.address! };
  if (depth === 0) {
    const contact = checked(await ctx.admin.from('agent_id_contacts').select('*').eq('agent_id', who.agent.id).ilike('name', to.replace(/[%_\\]/g, '\\$&')).maybeSingle()) as any;
    if (contact?.wallet) return recipient(ctx, who, from, contact.wallet, 1);
  }
  if (from.mode === 'live' && EVM_ADDRESS.test(to)) return { resource: null, address: to, label: to };
  throw fail(400, 'unknown_recipient', from.mode === 'test' ? 'Test money can only go to another agent\'s test wallet (its agent id, handle or test_ address).' : 'Send to an 0x address, another agent, or a contact with a wallet.');
}

const TRANSFER_ERRORS: Record<string, [number, string]> = {
  insufficient: [402, 'The wallet doesn\'t have enough money for this.'],
  over_limit: [403, 'This is over the wallet\'s limit set by its owner.'],
  wallet_inactive: [403, 'The wallet is paused by its owner.'],
  agent_inactive: [403, 'This agent is paused by its owner.'],
  unknown_recipient: [400, 'The recipient can\'t receive this money.'],
  approval_invalid: [409, 'That approval doesn\'t match this transfer or has expired.'],
  no_wallet: [404, 'This agent doesn\'t have a wallet.'],
  invalid: [400, 'The transfer is not valid.'],
};

// Money leaves a live wallet only once its owner (or their business) is
// verified; receiving needs nothing. The owner verifies once, on the website.
async function mayMoveMoney(ctx: Ctx, agent: AgentRow, byAgent: boolean) {
  if (!ctx.config.verifyToMoveMoney || (await verificationOf(ctx, agent)).verified) return;
  const where = `${ctx.config.siteUrl}/agent-id/verify`;
  throw fail(403, 'verification_required', byAgent
    ? `Your owner needs to verify their identity before money can leave this wallet. Ask them to do it once at ${where}.`
    : `Verify your identity once to send and withdraw money: ${where}`);
}

// Shared with owner approvals: sends once the limits (and, with an
// approval, the owner) allow it.
export async function transfer(ctx: Ctx, who: AgentCaller, input: { to: string; amount: number; memo?: string; asset?: string }, approvalId: string | null = null) {
  const from = await resourceFor(ctx, who.agent.id, 'wallet');
  if (from.mode === 'live') await mayMoveMoney(ctx, who.agent, who.via !== 'owner');
  const target = await recipient(ctx, who, from, input.to);
  if (target.resource?.id === from.id) throw fail(400, 'invalid', 'A wallet can\'t pay itself.');
  if (from.mode === 'live' && await sanctioned(ctx, target.address)) {
    await audit(ctx, who.userId, who.agent.id, actor(who), 'wallet.blocked_sanctioned', { to: target.address });
    throw fail(403, 'sanctioned_address', 'This address is on a sanctions list, so money can\'t be sent to it.');
  }
  const result = checked(await ctx.admin.rpc('agent_id_wallet_send', { p_agent: who.agent.id, p_amount: input.amount, p_counterparty: target.label, p_to_resource: target.resource?.id || null, p_memo: input.memo || null, p_approval: approvalId })) as any;
  if (result?.status === 'needs_approval') {
    // What the agent asked for, so the approved transfer finds the same recipient.
    await ctx.admin.from('agent_id_approvals').update({ request: { amount: input.amount, currency: from.currency, to: target.label, memo: input.memo || null, input: input.to } }).eq('id', result.approval);
    await audit(ctx, who.userId, who.agent.id, actor(who), 'wallet.approval_requested', { amount: input.amount, approval: result.approval });
    const approveUrl = approvalUrl(ctx, result.approval);
    ctx.background(notifyApproval(ctx, who, input.amount, target.label, input.memo || null, approveUrl).catch(error => console.error('[agent-id] approval mail', error?.message)));
    return {
      status: 'needs_approval', approval: result.approval, approveUrl,
      message: `This is above the amount your owner approves automatically, so it waits for them. Show them this link to approve or decline it: ${approveUrl} (they were emailed it too). Check the answer with approval_status. It expires in 24 hours.`,
    };
  }
  if (result?.status !== 'ok') {
    const [status, message] = TRANSFER_ERRORS[result?.status] || [400, 'The transfer could not be made.'];
    throw fail(status, result?.status || 'transfer_failed', message, result?.max !== undefined ? { limit: result.limit, max: asMoney(Number(result.max), from.currency) } : {});
  }
  let outcome = 'completed';
  if (result.mode === 'live') {
    let actionId: string | null = null;
    try {
      const asset = await payingAsset(ctx, from, input.amount, input.asset);
      const sent = await sendStablecoin(ctx, from, target.address, input.amount, asset, `agent-id-transfer-${result.event}`);
      actionId = sent.actionId;
      await ctx.admin.from('agent_id_events').update({ data: { ...(target.resource ? { to_agent: target.resource.agent_id } : {}), action: actionId, asset: asset.toUpperCase() } }).eq('id', result.event);
      // Usually on chain within seconds: wait briefly before answering.
      let action = { status: sent.status === 'created' ? 'pending' : sent.status, hash: null as string | null, reason: null as string | null };
      for (let i = 0; i < 6 && action.status === 'pending'; i++) {
        await ctx.sleep(1500);
        action = await actionStatus(ctx, from, actionId).catch(() => action);
      }
      if (action.status === 'pending') outcome = 'pending';
      else {
        await finishLive(ctx, from, result.event, action);
        if (action.status !== 'succeeded') throw fail(502, 'wallet_failed', action.reason || 'The transfer did not go through.');
        if (target.resource && action.hash) await record(ctx, target.resource, { kind: 'wallet', direction: 'in', status: 'completed', counterparty: from.address, subject: input.memo || null, amount: input.amount, currency: 'USD', providerRef: action.hash, data: { fromAgent: who.agent.id, asset: asset.toUpperCase() } });
      }
    } catch (error) {
      // Not started with the provider: it frees its share of the limits. A
      // started one finishes through the provider's answer.
      if (!actionId) await ctx.admin.rpc('agent_id_finish_transfer', { p_event: result.event, p_ok: false, p_provider_ref: null, p_data: { error: (error as Error).message } });
      throw error;
    }
  }
  await audit(ctx, who.userId, who.agent.id, actor(who), 'wallet.send', { amount: input.amount, currency: 'USD', to: target.label, mode: from.mode, approval: approvalId });
  return { status: outcome, transfer: await eventById(ctx, result.event), ...(result.balance !== null && result.balance !== undefined ? { balance: usd(Number(result.balance)) } : {}), ...(outcome === 'pending' ? { message: 'Sent to the network; it confirms within a minute. Check wallet history.' } : {}) };
}

// The owner taking money out of their agent's live wallet: to their own wallet
// or an exchange (USDC or USDT on Base), or to their bank (bank.ts: `to` is
// then Bridge's deposit address, shown as `label`, with the payout in `data`).
// Screened like any transfer, but not held to the limits the owner set for
// the agent.
export async function withdraw(ctx: Ctx, agent: AgentRow, input: { to: string; amount: number; asset?: string; memo?: string; label?: string; data?: Record<string, unknown> }) {
  const from = await resourceFor(ctx, agent.id, 'wallet');
  if (!EVM_ADDRESS.test(input.to)) throw fail(400, 'invalid', 'Withdraw to an address that starts with 0x, on Base.');
  if (from.mode === 'test') {
    // Test dollars leave the test balance; nothing reaches a blockchain.
    const result = checked(await ctx.admin.rpc('agent_id_wallet_withdraw', { p_agent: agent.id, p_amount: input.amount, p_to: input.to, p_memo: input.memo || 'Withdrawal' })) as any;
    if (result?.status === 'insufficient') throw fail(402, 'insufficient', 'The wallet doesn\'t have enough money for this.');
    if (result?.status !== 'ok') throw fail(409, result?.status || 'withdraw_failed', 'The withdrawal could not be made.');
    await audit(ctx, agent.owner_user_id, agent.id, 'owner', 'wallet.withdraw', { amount: input.amount, to: input.to, mode: 'test' });
    return { status: 'completed', transfer: await eventById(ctx, result.event), balance: usd(Number(result.balance)) };
  }
  await mayMoveMoney(ctx, agent, false);
  if (input.to.toLowerCase() === String(from.address).toLowerCase()) throw fail(400, 'invalid', 'That is this wallet\'s own address.');
  if (await sanctioned(ctx, input.to)) {
    await audit(ctx, agent.owner_user_id, agent.id, 'owner', 'wallet.blocked_sanctioned', { to: input.to });
    throw fail(403, 'sanctioned_address', 'This address is on a sanctions list, so money can\'t be sent to it.');
  }
  const asset = await payingAsset(ctx, from, input.amount, input.asset);
  const result = checked(await ctx.admin.rpc('agent_id_wallet_withdraw', { p_agent: agent.id, p_amount: input.amount, p_to: input.to, p_memo: input.memo || 'Withdrawal' })) as any;
  if (result?.status !== 'ok') throw fail(result?.status === 'no_wallet' ? 404 : 409, result?.status || 'withdraw_failed', 'The withdrawal could not be started.');
  if (input.label) await ctx.admin.from('agent_id_events').update({ counterparty: input.label.slice(0, 300), data: { withdrawal: true, ...input.data } }).eq('id', result.event);
  let actionId: string | null = null, outcome = 'pending';
  try {
    const sent = await sendStablecoin(ctx, from, input.to, input.amount, asset, `agent-id-withdraw-${result.event}`);
    actionId = sent.actionId;
    await ctx.admin.from('agent_id_events').update({ data: { withdrawal: true, ...input.data, action: actionId, asset: asset.toUpperCase() } }).eq('id', result.event);
    let action = { status: sent.status === 'created' ? 'pending' : sent.status, hash: null as string | null, reason: null as string | null };
    for (let i = 0; i < 6 && action.status === 'pending'; i++) {
      await ctx.sleep(1500);
      action = await actionStatus(ctx, from, actionId).catch(() => action);
    }
    if (action.status !== 'pending') {
      await finishLive(ctx, from, result.event, action);
      if (action.status !== 'succeeded') throw fail(502, 'wallet_failed', action.reason || 'The withdrawal did not go through.');
      outcome = 'completed';
    }
  } catch (error) {
    if (!actionId) await ctx.admin.rpc('agent_id_finish_transfer', { p_event: result.event, p_ok: false, p_provider_ref: null, p_data: { error: (error as Error).message } });
    throw error;
  }
  await audit(ctx, agent.owner_user_id, agent.id, 'owner', 'wallet.withdraw', { amount: input.amount, to: input.label || input.to, asset });
  return { status: outcome, transfer: await eventById(ctx, result.event) };
}

// --- Approvals ------------------------------------------------------------------
// Payments above the approval amount wait for the owner, who answers on the
// signed-in website (or from the email link), never from the agent's side.
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function notifyApproval(ctx: Ctx, who: AgentCaller, amount: number, to: string, memo: string | null, url: string) {
  return mailOwner(ctx, who, {
    subject: `Approve ${dollars(amount)} from ${who.agent.name}?`,
    line: `${who.agent.name} wants to send ${dollars(amount)} to ${to}.`,
    quote: memo, button: 'Review payment', url, note: 'It expires in 24 hours. Nothing is sent unless you approve.',
  });
}

const approvalView = async (ctx: Ctx, row: any) => {
  const expired = row.status === 'pending' && Date.parse(row.expires_at) <= ctx.now();
  const transfer = row.result?.event ? await eventById(ctx, row.result.event).catch(() => null) : null;
  const action = row.kind === 'action';
  return {
    approval: {
      id: row.id, status: expired ? 'expired' : row.status, kind: action ? row.request?.kind : 'payment',
      ...(action ? { summary: row.request?.summary || {} } : { amount: usd(Number(row.request?.amount) || 0), to: row.request?.to || null, memo: row.request?.memo || null }),
      reason: row.reason, createdAt: row.created_at, decidedAt: row.decided_at, expiresAt: row.expires_at,
    },
    ...(action && row.result ? { result: row.result } : {}),
    approveUrl: approvalUrl(ctx, row.id),
    ...(transfer ? { transfer } : {}),
  };
};
async function ownApproval(ctx: Ctx, who: AgentCaller, id: unknown) {
  const value = str(id, 60, 'approval', { required: true });
  const row = /^[0-9a-f-]{36}$/.test(value) ? checked(await ctx.admin.from('agent_id_approvals').select('*').eq('id', value).eq('agent_id', who.agent.id).maybeSingle()) : null;
  if (!row) throw fail(404, 'not_found', 'No approval with that id.');
  return row;
}
// Whether the owner answered: pending, approved, completed (sent), denied, failed or expired.
const approvalStatus: Op = async (ctx, who, input) => approvalView(ctx, await ownApproval(ctx, who, input.id ?? input.approval));
// The agent takes its own request back (it can never approve one).
const approvalWithdraw: Op = async (ctx, who, input) => {
  const row = await ownApproval(ctx, who, input.id ?? input.approval);
  const rows = checked(await ctx.admin.from('agent_id_approvals').update({ status: 'denied', reason: 'Withdrawn by the agent', decided_at: new Date(ctx.now()).toISOString() }).eq('id', row.id).eq('status', 'pending').select('*')) as any[];
  if (!rows?.length) throw fail(409, 'not_pending', 'This request was already answered.');
  await audit(ctx, who.userId, who.agent.id, actor(who), row.kind === 'action' ? 'approval.withdrawn' : 'wallet.approval_withdrawn', { approval: row.id });
  return approvalView(ctx, rows[0]);
};

const walletSend: Op = async (ctx, who, input) => {
  const to = str(input.to, 300, 'to', { required: true });
  const amount = cents(input);
  const memo = str(input.memo, 300, 'memo');
  const asset = input.asset ? str(input.asset, 10, 'asset').toLowerCase() : undefined;
  if (asset && !(ASSETS as readonly string[]).includes(asset)) throw fail(400, 'invalid', 'asset is usdc or usdt.');
  await rateLimit(ctx, who.userId, `wallet:${who.agent.id}`, 10, 200, 'transfers');
  return transfer(ctx, who, { to, amount, memo, asset });
};

// --- Card --------------------------------------------------------------------
const cardGet: Op = async (ctx, who) => {
  const resource = await resourceFor(ctx, who.agent.id, 'card');
  const used = await spent(ctx, resource, 'card', ['approved']);
  const { cvc: _cvc, ...details } = resource.state || {};
  return { card: { label: resource.label, mode: resource.mode, status: resource.status, currency: resource.currency, ...details, limits: resource.settings, spent: { last24Hours: asMoney(used.last24Hours, resource.currency), last30Days: asMoney(used.last30Days, resource.currency) } } };
};
const cardReveal: Op = async (ctx, who) => {
  const resource = await resourceFor(ctx, who.agent.id, 'card');
  await rateLimit(ctx, who.userId, `card-reveal:${who.agent.id}`, 5, 50, 'card reveals');
  // Recorded before the details leave, so every reveal is on the audit log.
  await audit(ctx, who.userId, who.agent.id, actor(who), 'card.reveal', { mode: resource.mode }, { required: true });
  const person = checked(await ctx.admin.from('agent_id_people').select('legal_name').eq('user_id', who.userId).maybeSingle()) as any;
  return { card: await revealCard(ctx, resource, person?.legal_name || who.agent.name), note: 'Use these details only for purchases your owner asked for. Every payment is checked against the card\'s limits.' };
};
const cardTransactions: Op = async (ctx, who, input) => { await resourceFor(ctx, who.agent.id, 'card'); const page = await listEvents(ctx, who.agent.id, ['card'], input); return { transactions: page.events, more: page.more }; };
// A test card's payment, decided by the same rules as a live card's.
const cardTestCharge: Op = async (ctx, who, input) => {
  const resource = await resourceFor(ctx, who.agent.id, 'card');
  if (resource.mode !== 'test') throw fail(409, 'live_card', 'Test charges are for test cards. A live card pays at a real checkout.');
  const amount = cents(input), merchant = str(input.merchant, 200, 'merchant') || 'Test merchant', category = str(input.category, 80, 'category') || null;
  const decision = checked(await ctx.admin.rpc('agent_id_card_authorize', { p_resource: resource.id, p_amount: amount, p_currency: resource.currency, p_merchant: merchant, p_category: category, p_provider_ref: `test_${randomId(20)}`, p_data: { test: true } })) as any;
  return { approved: !!decision.approved, ...(decision.reason ? { reason: decision.reason } : {}), transaction: await eventById(ctx, decision.event) };
};

// --- Machine -----------------------------------------------------------------
// The agent's machine. None is set up in advance: the first time the agent
// uses one, it gets it (live where machines are, its time on its owner's credits).
export async function machine(ctx: Ctx, who: AgentCaller) {
  let resource = await resourceFor(ctx, who.agent.id, 'vm', { required: false });
  if (!resource) {
    resource = await giveResource(ctx, who.agent, 'vm');
    await audit(ctx, who.userId, who.agent.id, actor(who), 'vm.first_use', { mode: resource.mode });
  }
  let state = await machineState(ctx, resource).catch(() => 'unknown');
  if (resource.status === 'provisioning' && ['running', 'stopped', 'suspended', 'idle'].includes(state)) {
    await ctx.admin.from('agent_id_resources').update({ status: 'active', state: { ...resource.state, machine: state }, updated_at: new Date(ctx.now()).toISOString() }).eq('id', resource.id);
    resource.status = 'active';
  }
  return { resource, state };
}
const vmGet: Op = async (ctx, who) => {
  const { resource, state } = await machine(ctx, who);
  return { machine: { label: resource.label, mode: resource.mode, status: resource.status, state, size: resource.state?.size, ...(resource.mode === 'test' ? { note: 'Test computers show a state but don\'t run commands.' } : {}) } };
};
const setTestState = async (ctx: Ctx, resource: ResourceRow, state: string) => {
  await ctx.admin.from('agent_id_resources').update({ state: { ...resource.state, machine: state }, updated_at: new Date(ctx.now()).toISOString() }).eq('id', resource.id);
  return state;
};
const vmStart: Op = async (ctx, who) => {
  const { resource } = await machine(ctx, who);
  await rateLimit(ctx, who.userId, `vm-power:${who.agent.id}`, 10, 300, 'machine starts');
  const state = resource.mode === 'test' ? await setTestState(ctx, resource, 'running') : await startMachine(ctx, resource);
  await audit(ctx, who.userId, who.agent.id, actor(who), 'vm.start', {});
  return { machine: { state, note: resource.mode === 'live' ? 'A running machine stops by itself after a minute without commands.' : undefined } };
};
const vmStop: Op = async (ctx, who) => {
  const { resource } = await machine(ctx, who);
  const state = resource.mode === 'test' ? await setTestState(ctx, resource, 'stopped') : await stopMachine(ctx, resource);
  await audit(ctx, who.userId, who.agent.id, actor(who), 'vm.stop', {});
  return { machine: { state } };
};
const vmExec: Op = async (ctx, who, input) => {
  const { resource } = await machine(ctx, who);
  const command = str(input.command, 20_000, 'command', { required: true, multiline: true });
  const cwd = input.cwd ? str(input.cwd, 500, 'cwd') : undefined;
  const timeoutSeconds = input.timeoutSeconds === undefined ? 120 : int(input.timeoutSeconds, 'timeoutSeconds', { min: 5, max: 900 });
  const result = await metered(ctx, who, resource, command, { cwd, timeoutSeconds, history: true });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, seconds: result.seconds };
};

// The agent's commands don't run as root, so system packages come through
// here: installed by name from the system's own signed sources.
const vmInstall: Op = async (ctx, who, input) => {
  const { resource } = await machine(ctx, who);
  const packages = (Array.isArray(input.packages) ? input.packages : String(input.packages || '').split(/[\s,]+/)).map((p: unknown) => String(p).trim()).filter(Boolean);
  if (!packages.length || packages.length > 30 || !packages.every((p: string) => PACKAGE.test(p))) throw fail(400, 'invalid', 'packages: up to 30 package names, like python3-pip or ffmpeg.');
  const result = await metered(ctx, who, resource, installCommand(packages), { timeoutSeconds: 600, history: true, as: 'system', subject: `Install ${packages.join(' ')}` });
  return { exitCode: result.exitCode, installed: result.exitCode === 0 ? packages : [], output: (result.stderr || result.stdout).slice(-4000), seconds: result.seconds };
};

// What is in a folder on the machine (the agent's files stay there between
// commands, until the machine is removed). Paid like any command.
const vmFiles: Op = async (ctx, who, input) => {
  const { resource } = await machine(ctx, who);
  const path = str(input.path, 500, 'path') || '~';
  if (/[\u0000-\u001f]/.test(path)) throw fail(400, 'invalid', 'path is not valid.');
  const quoted = `'${path.replace(/'/g, `'\\''`)}'`;
  const command = `p=${quoted}; case "$p" in "~"|"~/"*) p="$HOME\${p#\\~}";; esac; cd -- "$p" && pwd && find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null | head -500`;
  const result = await metered(ctx, who, resource, command, { timeoutSeconds: 60, history: false });
  if (result.exitCode !== 0) throw fail(404, 'not_found', result.stderr.trim().split('\n').pop() || 'That folder does not exist on the machine.');
  const [where, ...lines] = result.stdout.trim().split('\n');
  const entries = lines.map(line => line.split('\t')).filter(parts => parts.length === 4).map(([type, size, modified, name]) => ({
    name, type: type === 'd' ? 'dir' : type === 'l' ? 'link' : 'file', size: Number(size) || 0, modifiedAt: new Date(Number(modified) * 1000).toISOString(),
  })).sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
  return { path: where, entries };
};

// Runs a command on a live machine. Its time comes out of the owner's free
// machine hours first, then their credits: the most it can use is taken from
// both up front, one command runs at a time, and what it didn't use goes back.
// The agent's commands run as its ordinary account (vault/shell.ts); Agent ID's
// own (the vault, installing packages) as the computer's root.
export async function metered(ctx: Ctx, who: AgentCaller, resource: ResourceRow, command: string, options: { cwd?: string; timeoutSeconds: number; history: boolean; as?: 'agent' | 'system'; subject?: string }) {
  const { cwd, timeoutSeconds, history, as = 'agent' } = options;
  if (resource.mode === 'test') throw fail(409, 'test_machine', 'Test machines don\'t run commands. The owner can give this agent a live machine in Agent ID.');
  if (resource.status !== 'active') throw fail(409, 'machine_not_ready', 'The machine is still being set up. Try again in a minute.');
  await rateLimit(ctx, who.userId, `vm-exec:${who.agent.id}`, 30, 1000, 'commands');
  // The longest this command can take, with starting and stopping the machine.
  const size = (resource.state?.size || 'medium') as Size;
  const maxSeconds = timeoutSeconds + 180;
  const allowance = Math.round(ctx.config.computeFreeHours * 3600);
  const free = allowance > 0 ? Number(checked(await ctx.admin.rpc('agent_id_take_free_compute', { p_user: who.userId, p_seconds: maxSeconds, p_allowance: allowance }))) || 0 : 0;
  const giveBack = (seconds: number) => seconds > 0 ? ctx.admin.rpc('agent_id_return_free_compute', { p_user: who.userId, p_seconds: seconds }) : null;
  // Beyond the free time, the most the rest can cost is reserved from credits.
  const maxCost = maxSeconds > free ? machineCost(ctx, size, maxSeconds - free) : 0;
  const reservation = maxCost > 0 ? crypto.randomUUID() : null;
  const release = () => reservation ? ctx.admin.rpc('timewarp_energy_complete_ai', { p_id: reservation, p_user_id: who.userId, p_model: 'agent-id-vm', p_input: 0, p_output: 0, p_cost: 0, p_outcome: 'released' }) : null;
  if (reservation) {
    const { data: reserved, error: reserveError } = await ctx.admin.rpc('timewarp_reserve_agent_ai', { p_id: reservation, p_user_id: who.userId, p_credits: maxCost * AI_COST_MARKUP / USD_PER_CREDIT });
    if (reserveError || reserved !== true) {
      await giveBack(free);
      throw fail(reserveError ? 503 : 402, reserveError ? 'unavailable' : 'credits_required', reserveError ? 'Machine time can\'t be reserved right now.' : `The ${ctx.config.computeFreeHours} free machine hours are used up, and running commands now uses the owner's Timewarp credits. Add credits on the Agent ID website (Pricing).`);
    }
  }
  const holder = randomId(16);
  const leased = checked(await ctx.admin.rpc('agent_id_machine_lease', { p_resource: resource.id, p_holder: holder, p_seconds: timeoutSeconds + 240 }));
  if (leased !== true) {
    await Promise.all([release(), giveBack(free)]);
    throw fail(409, 'machine_busy', 'The machine is running another command. Try again when it finishes.');
  }
  let result;
  try { result = await runCommand(ctx, resource, as === 'agent' ? agentCommand(command, cwd) : command, { timeoutSeconds }); }
  catch (error) {
    await Promise.all([release(), giveBack(free)]);
    throw error;
  }
  finally {
    await ctx.admin.rpc('agent_id_machine_release', { p_resource: resource.id, p_holder: holder });
  }
  const usedFree = Math.min(free, result.seconds);
  await giveBack(free - usedFree);
  const cost = reservation && result.seconds > usedFree ? Math.min(maxCost, machineCost(ctx, size, result.seconds - usedFree)) : 0;
  if (reservation) {
    const { error: settleError } = await ctx.admin.rpc('timewarp_energy_complete_ai', { p_id: reservation, p_user_id: who.userId, p_model: 'agent-id-vm', p_input: 0, p_output: 0, p_cost: cost, p_outcome: 'settled' });
    if (settleError) console.error('[agent-id] machine time settlement pending', reservation, cost);
  }
  if (history) {
    await record(ctx, resource, { kind: 'vm', direction: 'none', status: result.failed ? 'failed' : result.exitCode === 0 ? 'completed' : 'exited', subject: (options.subject ?? command).slice(0, 1000), body: (result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(-20_000), data: { exitCode: result.exitCode, seconds: result.seconds, freeSeconds: usedFree, credits: Math.round(cost * AI_COST_MARKUP / USD_PER_CREDIT * 1000) / 1000 } });
    await audit(ctx, who.userId, who.agent.id, actor(who), 'vm.exec', { seconds: result.seconds, freeSeconds: usedFree, exitCode: result.exitCode });
  }
  return result;
}
const vmHistory: Op = async (ctx, who, input) => { const page = await listEvents(ctx, who.agent.id, ['vm'], input); return { commands: page.events, more: page.more }; };

// --- Identity ----------------------------------------------------------------
export async function identity(ctx: Ctx, agent: AgentRow) {
  const [verification, resources, orgName] = await Promise.all([verificationOf(ctx, agent), resourcesOf(ctx, [agent.id]), organizationName(ctx, agent.workspace_id)]);
  return { verification, resources, orgName };
}

const me: Op = async (ctx, who) => {
  const { verification, resources, orgName } = await identity(ctx, who.agent);
  return {
    agent: agentView(ctx, who.agent, resources),
    owner: { verified: verification.verified, level: verification.level, ...(verification.business ? { business: verification.business.legalName } : {}) },
    organization: verification.organizationId ? { id: verification.organizationId, name: orgName, verified: verification.level === 'kyb' } : null,
    mcp: `${ctx.config.publicUrl}/mcp`,
  };
};

const passport: Op = async (ctx, who, input) => {
  const audience = str(input.audience, 300, 'audience', { required: true });
  await rateLimit(ctx, who.userId, `passport:${who.agent.id}`, 60, 5000, 'passports');
  const { verification, resources, orgName } = await identity(ctx, who.agent);
  const now = Math.floor(ctx.now() / 1000), jti = randomId(20);
  const claims = {
    iss: ctx.config.issuer, sub: who.agent.id, aud: audience, iat: now, nbf: now, exp: now + ctx.config.passportSeconds, jti,
    agent: { name: who.agent.name, handle: who.agent.handle, runtime: who.agent.runtime, principal: principalOf(ctx, who.agent) },
    owner: {
      ref: await pairwiseOwner(ctx.config, who.agent.owner_user_id, audience),
      type: verification.level === 'kyb' ? 'business' : 'person', verified: verification.verified, level: verification.level,
      ...(verification.business ? { name: verification.business.legalName, country: verification.business.country } : verification.person ? { country: verification.person.country } : {}),
    },
    org: verification.organizationId ? { id: verification.organizationId, name: orgName, verified: verification.level === 'kyb' } : null,
    resources: resources.filter(r => r.status === 'active').map(r => r.kind).sort(),
  };
  const token = await signJwt(ctx.config, claims);
  await audit(ctx, who.userId, who.agent.id, actor(who), 'passport.issue', { audience, jti });
  return { passport: token, expiresAt: new Date((now + ctx.config.passportSeconds) * 1000).toISOString(), claims };
};

const signingKeysList: Op = async (ctx, who) => ({
  keys: ((checked(await ctx.admin.from('agent_id_signing_keys').select('*').eq('agent_id', who.agent.id).is('revoked_at', null).order('created_at')) || []) as any[])
    .map(row => ({ id: row.id, name: row.name, publicKey: row.public_key, fingerprint: row.fingerprint, createdAt: row.created_at })),
  principal: principalOf(ctx, who.agent),
});
const signingKeyAdd: Op = async (ctx, who, input) => {
  const { publicKey, fingerprint } = await parseSshKey(input.publicKey);
  const name = str(input.name, 60, 'name') || 'Signing key';
  const active = (checked(await ctx.admin.from('agent_id_signing_keys').select('id').eq('agent_id', who.agent.id).is('revoked_at', null)) || []) as any[];
  if (active.length >= 5) throw fail(409, 'too_many', 'An agent can have at most 5 signing keys. Remove one first.');
  const { data, error } = await ctx.admin.from('agent_id_signing_keys').insert({ agent_id: who.agent.id, public_key: publicKey, fingerprint, name }).select('*').single();
  if (error?.code === '23505') throw fail(409, 'key_in_use', 'This key is already registered to an agent.');
  checked({ data, error });
  await audit(ctx, who.userId, who.agent.id, actor(who), 'signing_key.add', { fingerprint });
  return { key: { id: data.id, name: data.name, publicKey: data.public_key, fingerprint: data.fingerprint, createdAt: data.created_at }, principal: principalOf(ctx, who.agent) };
};
const signingKeyRemove: Op = async (ctx, who, input) => {
  const rows = checked(await ctx.admin.from('agent_id_signing_keys').update({ revoked_at: new Date(ctx.now()).toISOString() }).eq('id', str(input.id, 60, 'id', { required: true })).eq('agent_id', who.agent.id).is('revoked_at', null).select('fingerprint')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No signing key with that id.');
  await audit(ctx, who.userId, who.agent.id, actor(who), 'signing_key.remove', { fingerprint: rows[0].fingerprint });
  return { removed: true };
};

export const ops: Record<string, Op> = {
  me, mailList, mailCounts, mailRead, mailSend, mailMove, mailMarkRead, mailDelete, fileUploadBase64, smsList, smsSend, callList, callPlace,
  contactsList, contactSave, contactDelete,
  walletGet, walletHistory, walletSend, approvalStatus, approvalWithdraw,
  cardGet, cardReveal, cardTransactions, cardTestCharge,
  vmGet, vmStart, vmStop, vmExec, vmFiles, vmHistory, vmInstall,
  passport, signingKeysList, signingKeyAdd, signingKeyRemove,
};

// Every agent request marks the agent as seen.
const wrap = (op: Op): Route<AgentCaller>[2] => async (ctx, who, input, params) => {
  seen(ctx, who.agent).catch(() => {});
  return op(ctx, who, { ...input, ...params });
};
export const agentRoutes: Route<AgentCaller>[] = [
  // Files travel as raw bytes, not JSON (app.ts leaves this body unread).
  ['POST', '/v1/me/files', async (ctx, who, _input, _params, req) => { seen(ctx, who.agent).catch(() => {}); return fileUpload(ctx, who, req); }],
  ['GET', '/v1/me/files/:id', async (ctx, who, _input, params) => fileDownload(ctx, who, params.id)],
  ...([
  ['GET', '/v1/me', me],
  // The CLI saying which app it set this Agent ID up in.
  ['POST', '/v1/me/apps', async (ctx, who, input) => { const app = appOf(input.app, 'app'); await recordApp(ctx, who.agent.id, app, { name: str(input.clientName, 100, 'clientName') || null }); return { app }; }],
  ['GET', '/v1/me/mail', mailList], ['POST', '/v1/me/mail', mailSend], ['GET', '/v1/me/mail/counts', mailCounts], ['GET', '/v1/me/mail/:id', mailRead],
  ['POST', '/v1/me/mail/:id/move', mailMove], ['POST', '/v1/me/mail/:id/read', mailMarkRead], ['DELETE', '/v1/me/mail/:id', mailDelete],
  ['GET', '/v1/me/sms', smsList], ['POST', '/v1/me/sms', smsSend],
  ['GET', '/v1/me/calls', callList], ['POST', '/v1/me/calls', callPlace],
  ['GET', '/v1/me/contacts', contactsList], ['POST', '/v1/me/contacts', contactSave],
  ['PATCH', '/v1/me/contacts/:id', contactSave], ['DELETE', '/v1/me/contacts/:id', contactDelete],
  ['GET', '/v1/me/approvals/:id', wrap(approvalStatus)], ['POST', '/v1/me/approvals/:id/withdraw', wrap(approvalWithdraw)],
  ['GET', '/v1/me/wallet', walletGet], ['GET', '/v1/me/wallet/transactions', walletHistory], ['POST', '/v1/me/wallet/transfers', walletSend],
  ['GET', '/v1/me/card', cardGet], ['POST', '/v1/me/card/reveal', cardReveal], ['GET', '/v1/me/card/transactions', cardTransactions], ['POST', '/v1/me/card/test-charge', cardTestCharge],
  ['GET', '/v1/me/vm', vmGet], ['POST', '/v1/me/vm/start', vmStart], ['POST', '/v1/me/vm/stop', vmStop], ['POST', '/v1/me/vm/exec', vmExec], ['POST', '/v1/me/vm/install', vmInstall], ['GET', '/v1/me/vm/files', vmFiles], ['GET', '/v1/me/vm/commands', vmHistory],
  ['POST', '/v1/me/passport', passport],
  ['GET', '/v1/me/signing-keys', signingKeysList], ['POST', '/v1/me/signing-keys', signingKeyAdd], ['DELETE', '/v1/me/signing-keys/:id', signingKeyRemove],
  ] as [string, string, Op][]).map(([method, pattern, op]) => [method, pattern, wrap(op)] as Route<AgentCaller>),
];
export const RAW_ROUTES = new Set(['POST /v1/me/files', 'POST /v1/account/verification/document']);
