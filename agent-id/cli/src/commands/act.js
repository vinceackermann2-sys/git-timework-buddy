// What an agent does as itself, with its own key: mail, texts, calls,
// contacts, wallet, card, machine, vault and passports.
import fs from 'node:fs';
import path from 'node:path';
import { dollarsString, dollarsToCents } from '../args.js';
import { CliError, UsageError } from '../errors.js';
import { findProfile } from '../config.js';
import { clip, fields, limits as limitText, money, table, usd, when } from '../output.js';
import { describeResource } from './account.js';
import { hostsOf, seal, vaultItem } from '../vault.js';

const sub = (ctx, fallback) => ctx.args[0] || fallback;
const need = (value, message) => { if (value === undefined || value === null || value === '' || value === true) throw new UsageError(message); return String(value); };
const list = value => typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
const unknown = (ctx, name) => { throw new UsageError(`${name} has no "${ctx.args[0]}" command.`); };

async function text(ctx, flag = 'text') {
  const value = ctx.flags[flag];
  if (value === '-') return (await ctx.readStdin()).replace(/\r\n/g, '\n');
  return need(value, `--${flag} is required (use --${flag} - to read it from stdin).`);
}

export async function me(ctx) {
  const data = await ctx.self.get('/v1/me');
  ctx.print(data, ({ agent, owner, organization }) => [
    fields([
      ['Agent', `${agent.name} (${agent.handle})`], ['Id', agent.id], ['Status', agent.status], ['Runtime', agent.runtime],
      ['Git identity', agent.gitPrincipal],
      // Owners are checked the first time money leaves, not before.
      ['Owner', `${owner.verified ? `verified (${owner.level})` : 'identity not checked yet (needed the first time money leaves)'}${owner.business ? `, ${owner.business}` : ''}`],
      ['Organization', organization ? `${organization.name || organization.id}${organization.verified ? ' (verified business)' : ''}` : null],
    ]),
    ...Object.values(agent.resources || {}).map(r => `  ${describeResource(r)}`),
  ].join('\n'));
}

// --- Mail -----------------------------------------------------------------------------
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', json: 'application/json', xml: 'application/xml', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ics: 'text/calendar', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
};
const contentTypeOf = file => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
const sizeText = bytes => bytes === null || bytes === undefined ? '-' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

// Uploads --attach files (POST /v1/me/files, the bytes as they are) and returns their ids.
async function attachments(ctx) {
  const files = [].concat(ctx.flags.attach ?? []).flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean);
  const ids = [];
  for (const file of files) {
    const full = path.resolve(ctx.cwd, file);
    let bytes;
    try { bytes = fs.readFileSync(full); } catch { throw new CliError(`Can't read ${file} to attach it.`); }
    const { file: uploaded } = await ctx.self.upload('/v1/me/files', bytes, { 'content-type': contentTypeOf(full), 'x-filename': encodeURIComponent(path.basename(full)) });
    ids.push(uploaded.id);
  }
  return ids;
}

export async function mail(ctx) {
  const action = sub(ctx, 'list');
  if (action === 'trash' || action === 'restore') {
    const id = need(ctx.args[1], `Which message? timewarp-id mail ${action} <id>`);
    const data = await ctx.self.post(`/v1/me/mail/${encodeURIComponent(id)}/move`, { folder: action === 'trash' ? 'trash' : 'inbox' });
    return ctx.print(data, () => action === 'trash' ? 'Moved to the trash. `timewarp-id mail restore <id>` brings it back.' : 'Back in the inbox.');
  }
  if (action === 'list' || action === 'ls') {
    const folder = ctx.flags.folder;
    if (folder !== undefined && !['inbox', 'sent', 'trash', 'all'].includes(folder)) throw new UsageError('--folder is inbox, sent, trash or all.');
    const data = await ctx.self.get('/v1/me/mail', { query: { folder, unread: ctx.flags.unread ? 'true' : undefined, limit: ctx.flags.limit, before: ctx.flags.before } });
    return ctx.print(data, ({ messages, more }) => messages.length ? table(messages, [
      ['ID', m => m.id], ['WHEN', m => when(m.at)], ['', m => (m.direction === 'in' ? (m.read ? '' : 'new') : 'sent')],
      [folder === 'sent' ? 'TO' : 'FROM/TO', m => clip(m.counterparty, 36)], ['SUBJECT', m => clip(m.subject, 50)],
    ]) + (more ? '\n(more: add --before <time of the last one>)' : '') : 'No messages.');
  }
  if (action === 'read' || action === 'show') {
    const id = need(ctx.args[1], 'Which message? timewarp-id mail read <id>');
    const data = await ctx.self.get(`/v1/me/mail/${encodeURIComponent(id)}`);
    return ctx.print(data, ({ message }) => [
      fields([[message.direction === 'in' ? 'From' : 'To', message.counterparty], ['Subject', message.subject], ['Date', when(message.at)], ['Id', message.id],
        ['Attachments', (message.attachments || []).map(a => `${a.filename} (${sizeText(a.size)}, ${a.id})`).join(', ')]]),
      '', message.text || '',
    ].join('\n'));
  }
  if (action === 'send') {
    const to = list(ctx.flags.to);
    if (!to?.length) throw new UsageError('--to is required: timewarp-id mail send --to a@example.com --subject "…" --text "…" [--attach file]');
    const subject = need(ctx.flags.subject, '--subject is required.');
    const body = { to, subject, text: await text(ctx), ...(list(ctx.flags.cc)?.length ? { cc: list(ctx.flags.cc) } : {}) };
    const files = await attachments(ctx);
    const data = await ctx.self.post('/v1/me/mail', { ...body, ...(files.length ? { attachments: files } : {}) });
    return ctx.print(data, sent => `Sent "${sent.message.subject}" to ${sent.message.counterparty} (${sent.message.status})${files.length ? ` with ${files.length} attachment${files.length === 1 ? '' : 's'}` : ''}. Id ${sent.message.id}${sent.note ? `\n${sent.note}` : ''}`);
  }
  if (action === 'reply') {
    const id = need(ctx.args[1], 'Which message? timewarp-id mail reply <id> --text "…"');
    const files = await attachments(ctx);
    const data = await ctx.self.post('/v1/me/mail', { replyTo: id, text: await text(ctx), ...(list(ctx.flags.to)?.length ? { to: list(ctx.flags.to) } : {}), ...(typeof ctx.flags.subject === 'string' ? { subject: ctx.flags.subject } : {}), ...(files.length ? { attachments: files } : {}) });
    return ctx.print(data, sent => `Replied to ${sent.message.counterparty}: "${sent.message.subject}" (${sent.message.status}). Id ${sent.message.id}${sent.note ? `\n${sent.note}` : ''}`);
  }
  unknown(ctx, 'mail');
}

// --- Phone ----------------------------------------------------------------------------
export async function sms(ctx) {
  const action = sub(ctx, 'list');
  if (action === 'list' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/sms', { query: { limit: ctx.flags.limit, direction: ctx.flags.direction } });
    return ctx.print(data, ({ messages }) => messages.length ? table(messages, [
      ['WHEN', m => when(m.at)], ['', m => (m.direction === 'in' ? 'from' : 'to')], ['NUMBER', m => m.counterparty], ['STATUS', m => m.status], ['TEXT', m => clip(m.text, 60)],
    ]) : 'No text messages.');
  }
  if (action === 'send') {
    const to = need(ctx.args[1], 'timewarp-id sms send <+14155550123> <text…>');
    const message = ctx.args.slice(2).join(' ') || (ctx.flags.text !== undefined ? await text(ctx) : '');
    const data = await ctx.self.post('/v1/me/sms', { to, text: need(message, 'What should the text say? timewarp-id sms send <number> <text…>') });
    return ctx.print(data, ({ message: m }) => `Texted ${m.counterparty} (${m.status}).`);
  }
  unknown(ctx, 'sms');
}

export async function call(ctx) {
  const action = sub(ctx, 'list');
  if (action === 'list' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/calls', { query: { limit: ctx.flags.limit } });
    return ctx.print(data, ({ calls }) => calls.length ? table(calls, [
      ['WHEN', c => when(c.at)], ['', c => (c.direction === 'in' ? 'from' : 'to')], ['NUMBER', c => c.counterparty], ['STATUS', c => c.status], ['SAID', c => clip(c.text, 60)],
    ]) : 'No calls.');
  }
  if (action === 'place') {
    const to = need(ctx.args[1], 'timewarp-id call place <+14155550123> --say "…"');
    const say = need(ctx.flags.say ?? ctx.args.slice(2).join(' '), '--say is required: what should the call say?');
    const data = await ctx.self.post('/v1/me/calls', { to, say });
    return ctx.print(data, ({ call: c }) => `Called ${c.counterparty} (${c.status}).`);
  }
  unknown(ctx, 'call');
}

// --- Contacts ---------------------------------------------------------------------------
export async function contacts(ctx) {
  const action = sub(ctx, 'list');
  const contactFields = () => Object.fromEntries(['name', 'email', 'phone', 'wallet', 'note'].filter(k => typeof ctx.flags[k] === 'string').map(k => [k, ctx.flags[k]]));
  if (action === 'list' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/contacts', { query: { q: ctx.args.slice(1).join(' ') || undefined } });
    return ctx.print(data, ({ contacts: rows }) => rows.length ? table(rows, [
      ['ID', c => c.id], ['NAME', c => c.name], ['EMAIL', c => c.email], ['PHONE', c => c.phone], ['WALLET', c => c.wallet], ['NOTE', c => clip(c.note, 30)],
    ]) : 'No contacts.');
  }
  if (action === 'add') {
    const body = { ...contactFields(), ...(ctx.args.length > 1 ? { name: ctx.args.slice(1).join(' ') } : {}) };
    need(body.name, 'Name the contact: timewarp-id contacts add <name> [--email …] [--phone …]');
    const data = await ctx.self.post('/v1/me/contacts', body);
    return ctx.print(data, ({ contact }) => `Saved ${contact.name} (${contact.id}).`);
  }
  if (action === 'update' || action === 'edit') {
    const id = need(ctx.args[1], 'Which contact? timewarp-id contacts update <id> --email …');
    const data = await ctx.self.patch(`/v1/me/contacts/${encodeURIComponent(id)}`, contactFields());
    return ctx.print(data, ({ contact }) => `Updated ${contact.name}.`);
  }
  if (action === 'rm' || action === 'remove' || action === 'delete') {
    const id = need(ctx.args[1], 'Which contact? timewarp-id contacts rm <id>');
    const data = await ctx.self.delete(`/v1/me/contacts/${encodeURIComponent(id)}`);
    return ctx.print(data, () => 'Removed.');
  }
  unknown(ctx, 'contacts');
}

// --- Wallet -----------------------------------------------------------------------------
// Amounts come as money ({ amount, currency }) or plain cents.
const amountText = value => value && typeof value === 'object' ? money(value) : usd(value);
const ASSETS = ['usdc', 'usdt'];
const NETWORKS = { base: 'Base', 'base-sepolia': 'Base Sepolia' };

// "$12.34 USD · USDC/USDT on Base", or "$12.34 USD · test dollars".
export function balanceLine(w) {
  const total = w.balance ? usd(w.balance.amount, w.balance.currency) : '-';
  const network = NETWORKS[w.network] || (w.network && w.network !== 'test' ? w.network : null);
  const assets = Array.isArray(w.assets) ? w.assets.filter(a => a && a.asset) : [];
  if (w.mode === 'test' && !network) return `${total} · test dollars`;
  const names = assets.length ? [...new Set(assets.map(a => String(a.asset).toUpperCase()))] : ['USDC'];
  return `${total} · ${names.join('/')} on ${network || 'Base'}`;
}

export async function wallet(ctx) {
  const action = sub(ctx, 'show');
  if (action === 'show' || action === 'balance') {
    const data = await ctx.self.get('/v1/me/wallet');
    return ctx.print(data, ({ wallet: w }) => fields([
      ['Wallet', `${w.label || ''} ${w.address}`.trim()], ['Mode', w.mode], ['Balance', balanceLine(w)],
      ['Assets', Array.isArray(w.assets) && w.assets.length > 1 ? w.assets.map(a => `${String(a.asset).toUpperCase()} ${amountText(a.amount)}`).join(', ') : null],
      ['Balance error', w.balanceError], ['Limits', limitText(w.limits)], ['Sent today', money(w.sent?.last24Hours)], ['Sent in 30 days', money(w.sent?.last30Days)],
    ]));
  }
  if (action === 'history' || action === 'transactions') {
    const data = await ctx.self.get('/v1/me/wallet/transactions', { query: { limit: ctx.flags.limit } });
    return ctx.print(data, ({ transactions }) => transactions.length ? table(transactions, [
      ['WHEN', t => when(t.at)], ['', t => (t.direction === 'in' ? 'in' : 'out')], ['AMOUNT', t => money(t.amount)], ['WHO', t => clip(t.counterparty, 40)], ['STATUS', t => t.status], ['MEMO', t => clip(t.subject, 30)],
    ]) : 'No transactions yet.');
  }
  if (action === 'send' || action === 'pay') {
    let to = need(ctx.args[1], 'timewarp-id wallet send <to> <amount> [--memo "…"]');
    // Another of your agents by the name you know it by here.
    if (!/^(agt_|test_|0x)/i.test(to)) {
      let profile = null;
      try { profile = findProfile(ctx.config, to); } catch { /* ambiguous: let Agent ID decide */ }
      if (profile?.agentId) to = profile.agentId;
    }
    const value = dollarsString(need(ctx.args[2] ?? ctx.flags.amount, 'How much? timewarp-id wallet send <to> <amount> [--asset usdc|usdt]'), 'The amount');
    const asset = ctx.flags.asset === undefined ? undefined : String(ctx.flags.asset).toLowerCase();
    if (asset !== undefined && !ASSETS.includes(asset)) throw new UsageError('--asset is usdc or usdt.');
    const data = await ctx.self.post('/v1/me/wallet/transfers', { to, value, ...(asset ? { asset } : {}), ...(typeof ctx.flags.memo === 'string' ? { memo: ctx.flags.memo } : {}) });
    if (data.status === 'needs_approval') {
      return ctx.print(data, () => [
        `Waiting for the owner: $${value} USD to ${ctx.args[1]} is above the amount sent without approval.`,
        `Approval id: ${data.approval}`,
        data.approveUrl ? `Approve or decline it here: ${data.approveUrl}` : 'The owner approves it on the Agent ID website.',
      ].join('\n'));
    }
    return ctx.print(data, ({ transfer, balance }) => `Sent ${money(transfer.amount)} to ${transfer.counterparty}.${balance ? ` Balance: ${money(balance)}.` : ''}`);
  }
  unknown(ctx, 'wallet');
}

// --- Card ---------------------------------------------------------------------------------
const applicationText = a => a ? fields([
  ['Card application', a.status], ['Use', a.useCase], ['Monthly spend', a.monthlySpend !== undefined && a.monthlySpend !== null ? amountText(a.monthlySpend) : null], ['Country', a.country], ['Applied', when(a.createdAt)],
]) : 'No card application yet. Apply with `timewarp-id card apply --use-case "…" --monthly 200 --country US`.';

export async function card(ctx) {
  const action = sub(ctx, 'show');
  // The owner applies for a live card for an agent (it replaces giving one).
  if (action === 'apply' || action === 'application') {
    const id = await ctx.agentIdFor();
    if (action === 'application' || (ctx.flags['use-case'] === undefined && ctx.flags.monthly === undefined && ctx.flags.country === undefined)) {
      const data = await ctx.owner.get(`/v1/agents/${id}/card-application`);
      return ctx.print(data, ({ application }) => applicationText(application));
    }
    const useCase = need(ctx.flags['use-case'], '--use-case is required: what the agent will pay for.');
    const monthlySpend = dollarsToCents(need(ctx.flags.monthly, '--monthly is required: the most it spends a month, in dollars.'), '--monthly');
    const country = need(ctx.flags.country, '--country is required: the two-letter country the card is for.').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new UsageError('--country is a two-letter country code, like US or SE.');
    const data = await ctx.owner.post(`/v1/agents/${id}/card-application`, { useCase, monthlySpend, country });
    return ctx.print(data, ({ application }) => `Applied for a card.\n${applicationText(application)}`);
  }
  if (action === 'show') {
    const data = await ctx.self.get('/v1/me/card');
    return ctx.print(data, ({ card: c }) => fields([
      ['Card', c.label], ['Mode', c.mode], ['Status', c.status], ['Last four', c.last4],
      ['Expires', c.expMonth ? `${String(c.expMonth).padStart(2, '0')}/${c.expYear}` : null], ['Limits', limitText(c.limits)],
      ['Spent today', money(c.spent?.last24Hours)], ['Spent in 30 days', money(c.spent?.last30Days)],
    ]));
  }
  if (action === 'reveal') {
    const data = await ctx.self.post('/v1/me/card/reveal', {});
    ctx.err('Card details: use them only for purchases your owner asked for, and never paste them into a chat. This reveal is logged.');
    return ctx.print(data, ({ card: c }) => fields([
      ['Number', c.number], ['Expires', `${String(c.expMonth).padStart(2, '0')}/${c.expYear}`], ['CVC', c.cvc], ['Name', c.name], ['Test card', c.test ? 'yes' : null],
    ]));
  }
  if (action === 'transactions' || action === 'history') {
    const data = await ctx.self.get('/v1/me/card/transactions', { query: { limit: ctx.flags.limit } });
    return ctx.print(data, ({ transactions }) => transactions.length ? table(transactions, [
      ['WHEN', t => when(t.at)], ['AMOUNT', t => money(t.amount)], ['MERCHANT', t => clip(t.counterparty, 30)], ['STATUS', t => t.status], ['REASON', t => t.data?.reason],
    ]) : 'No card payments yet.');
  }
  if (action === 'test-charge' || action === 'charge') {
    const value = dollarsString(need(ctx.args[1] ?? ctx.flags.amount, 'How much? timewarp-id card test-charge <amount>'), 'The amount');
    const data = await ctx.self.post('/v1/me/card/test-charge', { value, ...(typeof ctx.flags.merchant === 'string' ? { merchant: ctx.flags.merchant } : {}), ...(typeof ctx.flags.category === 'string' ? { category: ctx.flags.category } : {}) });
    return ctx.print(data, result => result.approved ? `Approved: $${value} at ${result.transaction?.counterparty || 'the test merchant'}.` : `Declined: $${value} (${result.reason || 'declined'}).`);
  }
  unknown(ctx, 'card');
}

// --- Machine ----------------------------------------------------------------------------
export async function vm(ctx) {
  const action = sub(ctx, 'status');
  if (action === 'status' || action === 'show') {
    const data = await ctx.self.get('/v1/me/vm');
    return ctx.print(data, ({ machine }) => fields([['Machine', machine.label], ['Mode', machine.mode], ['Size', machine.size], ['State', machine.state], ['Status', machine.status], ['Note', machine.note]]));
  }
  if (action === 'start' || action === 'stop') {
    const data = await ctx.self.post(`/v1/me/vm/${action}`, {});
    return ctx.print(data, ({ machine }) => `Machine ${machine.state}.${machine.note ? ` ${machine.note}` : ''}`);
  }
  if (action === 'exec' || action === 'run') {
    const command = (ctx.rest.length ? ctx.rest : ctx.args.slice(1)).join(' ').trim();
    if (!command) throw new UsageError('What should it run? timewarp-id vm exec -- <command…>');
    const timeout = ctx.flags.timeout === undefined ? undefined : Number(ctx.flags.timeout);
    if (timeout !== undefined && !Number.isInteger(timeout)) throw new UsageError('--timeout is a whole number of seconds.');
    const data = await ctx.self.post('/v1/me/vm/exec', { command, ...(typeof ctx.flags.cwd === 'string' ? { cwd: ctx.flags.cwd } : {}), ...(timeout !== undefined ? { timeoutSeconds: timeout } : {}) });
    if (ctx.json) { ctx.print(data); return data.exitCode === 0 ? 0 : 1; }
    if (data.stdout) ctx.stdout.write(data.stdout.endsWith('\n') ? data.stdout : `${data.stdout}\n`);
    if (data.stderr) ctx.stderr.write(data.stderr.endsWith('\n') ? data.stderr : `${data.stderr}\n`);
    return Number.isInteger(data.exitCode) ? Math.min(Math.max(data.exitCode, 0), 255) : 1;
  }
  if (action === 'files' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/vm/files', { query: { path: ctx.args[1] } });
    return ctx.print(data, ({ path: where, entries }) => `${where || '/'}\n${entries?.length ? table([...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)), [
      ['NAME', e => (e.type === 'dir' ? `${e.name}/` : e.name)], ['SIZE', e => (e.type === 'dir' ? '' : sizeText(e.size))], ['MODIFIED', e => when(e.modifiedAt)],
    ]) : '(empty)'}`);
  }
  if (action === 'history') {
    const data = await ctx.self.get('/v1/me/vm/commands', { query: { limit: ctx.flags.limit } });
    return ctx.print(data, ({ commands }) => commands.length ? table(commands, [
      ['WHEN', c => when(c.at)], ['STATUS', c => c.status], ['EXIT', c => c.data?.exitCode], ['SECONDS', c => c.data?.seconds], ['COMMAND', c => clip(c.subject, 60)],
    ]) : 'No commands yet.');
  }
  unknown(ctx, 'vm');
}

// --- Vault ----------------------------------------------------------------------------------
// Keys and sign-ins in the vault on the agent's own computer. A secret comes
// from stdin or is typed (never a flag: shell history would keep it), and is
// sealed here before it's sent.
async function readSecret(ctx, what) {
  if (ctx.stdin?.isTTY) return (await ctx.askSecret(`${what} (not shown): `)) ?? '';
  return (await ctx.readStdin()).replace(/\r?\n$/, '');
}

export async function vault(ctx) {
  const action = sub(ctx, 'list');
  if (action === 'list' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/vault');
    return ctx.print(data, ({ ready, items, note }) => !ready ? note || 'The vault isn\'t set up yet.' : items.length ? table(items, [
      ['ID', i => i.id], ['KIND', i => (i.kind === 'login' ? 'sign-in' : 'key')], ['NAME', i => i.label],
      ['FOR', i => (i.kind === 'login' ? i.site : (i.hosts || []).join(', '))], ['SAVED BY', i => (i.savedBy === 'agent' ? 'agent' : 'owner')],
    ]) : 'The vault is empty.');
  }
  if (action === 'save' || action === 'add') {
    for (const flag of ['secret', 'value', 'password', 'key']) {
      if (ctx.flags[flag] !== undefined) throw new UsageError(`A secret isn't taken as --${flag}: your shell would keep it in its history. Pipe it in, or type it when asked.`);
    }
    const login = ctx.flags.site !== undefined;
    const label = need(ctx.flags.label ?? ctx.args[1], `Give it a name: ${ctx.bin} vault save --label "Resend API" --for api.resend.com`);
    if (!login) hostsOf(ctx.flags.for === true ? '' : ctx.flags.for);
    const listed = await ctx.self.get('/v1/me/vault');
    if (!listed.ready || !listed.publicKey) throw new CliError(listed.note || 'The vault isn\'t set up yet. Your owner sets it up on the Agent ID website.');
    const secret = await readSecret(ctx, login ? 'Password' : 'Key');
    const item = vaultItem({ kind: login ? 'login' : 'key', secret, hosts: ctx.flags.for, as: ctx.flags.as, username: ctx.flags.username, site: ctx.flags.site });
    const data = await ctx.self.post('/v1/me/vault/items', { label, envelope: seal(listed.publicKey, item) });
    return ctx.print(data, ({ item: saved }) => `Saved "${saved.label}" in the vault (${saved.id}), sealed on this computer.${saved.kind === 'key' ? `\nUse it with: ${ctx.bin} vault request ${saved.id} <https address>` : ''}`);
  }
  if (action === 'request' || action === 'use') {
    const item = need(ctx.args[1], `Which item? ${ctx.bin} vault request <item> <https address>`);
    const url = need(ctx.args[2] ?? ctx.flags.url, `Where to? ${ctx.bin} vault request ${item} https://api.example.com/…`);
    const body = ctx.flags.data === undefined ? undefined : ctx.flags.data === '-' ? await ctx.readStdin() : String(ctx.flags.data);
    const data = await ctx.self.post('/v1/me/vault/request', {
      item, url,
      ...(typeof ctx.flags.method === 'string' ? { method: ctx.flags.method } : {}),
      ...(typeof ctx.flags.type === 'string' ? { headers: { 'Content-Type': ctx.flags.type } } : {}),
      ...(body !== undefined ? { body } : {}),
    });
    if (ctx.json) { ctx.print(data); return data.status < 400 ? 0 : 1; }
    ctx.err(`HTTP ${data.status}${data.truncated ? ' (cut short)' : ''}`);
    if (data.body) ctx.stdout.write(data.body.endsWith('\n') ? data.body : `${data.body}\n`);
    return data.status < 400 ? 0 : 1;
  }
  unknown(ctx, 'vault');
}

// --- Passport -------------------------------------------------------------------------------
export async function passport(ctx) {
  const audience = ctx.flags.audience ?? ctx.args[0];
  if (!audience || typeof audience !== 'string') throw new UsageError('Which service is it for? timewarp-id passport --audience https://api.example.com');
  const data = await ctx.self.post('/v1/me/passport', { audience });
  if (!data?.passport) throw new CliError('Agent ID did not return a passport.');
  // Only the token, so $(timewarp-id passport --audience …) works.
  ctx.print(data, () => data.passport);
}
