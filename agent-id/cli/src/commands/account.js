// What the owner does: sign in, create and manage agents, give them things,
// set limits, answer approvals, and pick the agent commands act as.
import fs from 'node:fs';
import path from 'node:path';
import { dollarsToCents } from '../args.js';
import { CliError, UsageError } from '../errors.js';
import { DASHBOARD, findProfile, PROJECT_FILE, selectAgent } from '../config.js';
import { cents, fields, limits as limitText, money, table, when } from '../output.js';
import { APPS, sendWithOrigin } from '../origin.js';
import { withTerms } from '../terms.js';

const KINDS = ['mail', 'phone', 'wallet', 'card', 'vm'];
const KIND_NAMES = { mail: 'mail inbox', phone: 'phone number', wallet: 'wallet', card: 'virtual card', vm: 'virtual machine' };
const RUNTIMES = [...APPS, 'other', 'any'];

const kindArg = (ctx, verb) => {
  const kind = ctx.args[0];
  if (!kind) throw new UsageError(`Say what to ${verb}: ${KINDS.join(', ')}.`);
  if (!KINDS.includes(kind)) throw new UsageError(`"${kind}" is not one of ${KINDS.join(', ')}.`);
  return kind;
};

export function describeResource(resource) {
  if (!resource) return '-';
  const mode = resource.mode === 'live' ? '' : 'test ';
  const detail = resource.kind === 'wallet' ? `${resource.address}${resource.balance ? `, balance ${money(resource.balance)}` : ''}`
    : resource.kind === 'card' ? `${resource.label}${resource.details?.expMonth ? `, expires ${String(resource.details.expMonth).padStart(2, '0')}/${resource.details.expYear}` : ''}`
    : resource.kind === 'vm' ? `${resource.label}${resource.details?.machine ? `, ${resource.details.machine}` : ''}`
    : resource.address || resource.label;
  return `${mode}${KIND_NAMES[resource.kind] || resource.kind}: ${detail}${resource.status !== 'active' ? ` (${resource.status})` : ''}`;
}

// --- Sign in ----------------------------------------------------------------------
export async function login(ctx) {
  let key = ctx.flags['owner-key'] ?? ctx.args[0];
  if (key === '-') key = (await ctx.readStdin()).trim();
  if (!key || typeof key !== 'string') throw new UsageError(`Pass your owner key: timewarp-id login --owner-key two_… (create one on the dashboard: ${DASHBOARD}).`);
  key = key.trim();
  if (!key.startsWith('two_')) {
    throw new CliError('That is not an owner key: owner keys start with two_.', {
      hint: key.startsWith('twa_') ? 'twa_ keys belong to one agent: set TIMEWARP_AGENT_KEY to act as that agent.' : `Create an owner key on the Agent ID dashboard (${DASHBOARD}).`,
    });
  }
  const account = await ctx.api.get('/v1/account', { token: key });
  ctx.config.ownerKey = key;
  if (ctx.flags.api || ctx.env.AGENT_ID_API) ctx.config.api = ctx.apiBase;
  ctx.save();
  ctx.print({ account }, () => [
    `Signed in as ${account.user?.email || account.user?.id}${account.plan ? ` (${account.plan} plan)` : ''}.`,
    `Identity: ${account.person?.status || 'unverified'}. Agents: ${account.agents?.count ?? 0} of ${account.agents?.max ?? '?'}.`,
    ...(account.terms && account.terms.accepted === false ? ['Before your first agent, accept Agent ID\'s terms of service: `timewarp-id terms`.'] : []),
    account.agents?.count ? 'See them with `timewarp-id agents list`.' : 'Create your first agent: `timewarp-id agents create "Research agent" --origin claude-code`.',
  ].join('\n'));
}

export async function logout(ctx) {
  const had = !!ctx.config.ownerKey;
  delete ctx.config.ownerKey;
  if (ctx.flags.all) { ctx.config.profiles = {}; delete ctx.config.default; }
  ctx.save();
  ctx.print({ loggedOut: true, profilesRemoved: !!ctx.flags.all }, () => [
    had ? 'Forgot your owner key on this computer. It still works elsewhere until you revoke it on the dashboard.' : 'You were not signed in.',
    ctx.flags.all ? 'Forgot every agent key on this computer too.' : Object.keys(ctx.config.profiles).length ? 'Agent keys stay; `timewarp-id logout --all` forgets them too.' : '',
  ].filter(Boolean).join('\n'));
}

export async function whoami(ctx) {
  const ownerKey = ctx.env.TIMEWARP_OWNER_KEY || ctx.config.ownerKey;
  let chosen = null, chooseError = null;
  try { chosen = ctx.agent(); } catch (error) { chooseError = error; }
  if (!ownerKey && !chosen) throw chooseError instanceof CliError && Object.keys(ctx.config.profiles).length ? chooseError : new CliError('You are not signed in.', { hint: `Create an owner key on the Agent ID dashboard (${DASHBOARD}) and run \`timewarp-id login --owner-key two_…\`.` });
  const [account, me] = await Promise.all([ownerKey ? ctx.owner.get('/v1/account') : null, chosen ? ctx.self.get('/v1/me') : null]);
  ctx.print({ owner: account, agent: me, agentSource: chosen?.source || null }, () => {
    const lines = [];
    if (account) {
      lines.push(`Owner: ${account.user?.email || account.user?.id}${account.plan ? ` (${account.plan} plan)` : ''}, identity ${account.person?.status || 'unverified'}`);
      for (const org of account.organizations || []) lines.push(`  ${org.role} of ${org.name} (${org.id})${org.business?.status === 'verified' ? ', verified business' : ''}`);
    } else lines.push('Owner: not signed in (no owner key)');
    if (me) lines.push(`Agent: ${me.agent.name} (${me.agent.handle}, ${me.agent.id}), from ${chosen.source}`);
    else lines.push('Agent: none selected');
    return lines.join('\n');
  });
}

// --- Agents -------------------------------------------------------------------------
export function saveProfile(ctx, agent, secret) {
  ctx.config.profiles[agent.handle] = { agentId: agent.id, key: secret, name: agent.name };
  if (!ctx.config.default || !findProfile(ctx.config, ctx.config.default)) ctx.config.default = agent.handle;
  ctx.save();
}

const confirm = async (ctx, question) => ctx.interactive && /^y(es)?$/i.test((await ctx.ask(`${question} [y/N] `)).trim());

export async function agents(ctx) {
  const [sub = 'list', ...rest] = ctx.args;
  const ref = rest.join(' ') || (typeof ctx.flags.agent === 'string' ? ctx.flags.agent : '');
  const needRef = () => { if (!ref) throw new UsageError(`Name the agent: timewarp-id agents ${sub} <agent>.`); return ref; };

  if (sub === 'list' || sub === 'ls') {
    const data = await ctx.owner.get('/v1/agents', { query: { status: ctx.flags.all ? 'all' : undefined } });
    return ctx.print(data, ({ agents }) => agents.length ? table(agents, [
      ['', a => a.handle === ctx.config.default ? '*' : ''],
      ['HANDLE', a => a.handle], ['NAME', a => a.name], ['STATUS', a => a.status], ['RUNTIME', a => a.runtime],
      ['HAS', a => Object.keys(a.resources || {}).join(' ')],
      ['KEY HERE', a => (Object.values(ctx.config.profiles).some(p => p.agentId === a.id) ? 'yes' : 'no')],
      ['ID', a => a.id],
    ]) : 'No agents yet. Create one: `timewarp-id agents create "Research agent"`.');
  }

  if (sub === 'create' || sub === 'new') {
    const name = rest.join(' ').trim() || (typeof ctx.flags.name === 'string' ? ctx.flags.name : '');
    if (!name) throw new UsageError('Name the agent: timewarp-id agents create <name>.');
    const runtime = ctx.flags.runtime;
    if (runtime !== undefined && !RUNTIMES.includes(runtime)) throw new UsageError(`--runtime is one of ${RUNTIMES.join(', ')}.`);
    const app = typeof ctx.flags.origin === 'string' ? ctx.flags.origin : APPS.includes(runtime) ? runtime : ctx.tool && APPS.includes(ctx.tool) ? ctx.tool : 'custom';
    if (!APPS.includes(app)) throw new UsageError(`--origin is one of ${APPS.join(', ')}.`);
    const origin = { app, detail: typeof ctx.flags['origin-detail'] === 'string' ? ctx.flags['origin-detail'] : null };
    const created = await withTerms(ctx, () => sendWithOrigin(body => ctx.owner.post('/v1/agents', body), { name, ...(runtime || app !== 'custom' ? { runtime: runtime || app } : {}), origin,...(ctx.flags.org ? { organizationId: ctx.flags.org } : {}), keyName: ctx.hostname() }));
    if (created.secret) saveProfile(ctx, created.agent, created.secret);
    const { secret: _secret, ...shown } = created;
    return ctx.print({ ...shown, profile: created.agent.handle, default: ctx.config.default === created.agent.handle }, () => [
      `Created ${created.agent.name} (${created.agent.id}), handle ${created.agent.handle}.`,
      `Its key is saved on this computer as "${created.agent.handle}"${ctx.config.default === created.agent.handle ? ' (the default agent)' : ''}.`,
      `Git identity: ${created.agent.gitPrincipal}`,
      `Next: timewarp-id give mail --agent ${created.agent.handle}`,
    ].join('\n'));
  }

  if (sub === 'show' || sub === 'get') {
    const id = await ctx.agentIdFor(needRef());
    const data = await ctx.owner.get(`/v1/agents/${id}`);
    return ctx.print(data, ({ agent, keys, signingKeys, verification }) => [
      fields([
        ['Agent', `${agent.name} (${agent.handle})`], ['Id', agent.id], ['Status', agent.status], ['Runtime', agent.runtime],
        ['Organization', agent.organizationId], ['Git identity', agent.gitPrincipal], ['Owner verified', verification ? `${verification.verified ? 'yes' : 'no'} (${verification.level})` : null],
        ['Created', when(agent.createdAt)], ['Last seen', when(agent.lastSeenAt)],
        ['Keys', `${keys.length} active${Object.values(ctx.config.profiles).some(p => p.agentId === agent.id) ? ', one saved on this computer' : ''}`],
        ['Signing keys', signingKeys.length ? signingKeys.map(k => `${k.name} ${k.fingerprint}`).join('; ') : 'none'],
      ]),
      ...Object.values(agent.resources || {}).map(r => `  ${describeResource(r)}`),
    ].join('\n'));
  }

  if (sub === 'key') {
    const id = await ctx.agentIdFor(needRef());
    const { agent } = await ctx.owner.get(`/v1/agents/${id}`);
    const created = await ctx.owner.post(`/v1/agents/${id}/keys`, { name: ctx.hostname() });
    saveProfile(ctx, agent, created.secret);
    return ctx.print({ key: created.key, profile: agent.handle }, () => `Saved a new key for ${agent.name} as "${agent.handle}". Keys on other computers keep working.`);
  }

  if (sub === 'pause' || sub === 'resume') {
    const id = await ctx.agentIdFor(needRef());
    const data = await ctx.owner.patch(`/v1/agents/${id}`, { status: sub === 'pause' ? 'suspended' : 'active' });
    return ctx.print(data, ({ agent }) => sub === 'pause' ? `Paused ${agent.name}: it can't act until you resume it.` : `${agent.name} is active again.`);
  }

  if (sub === 'revoke' || sub === 'delete' || sub === 'rm') {
    const id = await ctx.agentIdFor(needRef());
    if (!ctx.flags.yes && !(await confirm(ctx, `Revoke ${ref} for good? Its keys stop working and its resources are released.`))) {
      throw new CliError('Not revoked.', { hint: `Add --yes to revoke ${ref} without asking.` });
    }
    const data = await ctx.owner.delete(`/v1/agents/${id}`);
    for (const [handle, profile] of Object.entries(ctx.config.profiles)) if (profile.agentId === id) delete ctx.config.profiles[handle];
    if (ctx.config.default && !ctx.config.profiles[ctx.config.default]) delete ctx.config.default;
    ctx.save();
    return ctx.print(data, ({ agent }) => `Revoked ${agent.name} (${agent.id}). Its keys, signing keys and passports no longer work.`);
  }

  throw new UsageError(`agents has no "${sub}" command.`);
}

// --- Resources ------------------------------------------------------------------------
export async function give(ctx) {
  const kind = kindArg(ctx, 'give');
  if (kind === 'card' && !ctx.flags.test) throw new UsageError('Cards are applied for: `timewarp-id card apply --agent <agent> --use-case "…" --monthly 200 --country US`. (`give card --test` gives a test card while developing.)');
  const id = await ctx.agentIdFor();
  const options = {};
  if (ctx.flags.size !== undefined) { if (!['small', 'medium'].includes(ctx.flags.size)) throw new UsageError('--size is small or medium.'); options.size = ctx.flags.size; }
  if (ctx.flags.country !== undefined) options.country = String(ctx.flags.country).toUpperCase();
  if (ctx.flags['area-code'] !== undefined) options.areaCode = String(ctx.flags['area-code']);
  const data = await ctx.owner.post(`/v1/agents/${id}/resources`, { kind, mode: ctx.flags.test ? 'test' : 'live', ...(Object.keys(options).length ? { options } : {}) });
  ctx.print(data, ({ resource }) => [
    `Gave it a ${describeResource(resource)}`,
    resource.kind === 'wallet' || resource.kind === 'card' ? `Limits: ${limitText(resource.settings)}. Change them with \`timewarp-id limits ${resource.kind}\`.` : '',
    resource.mode === 'test' ? 'Test resources only work inside Agent ID.' : '',
  ].filter(Boolean).join('\n'));
}

export async function take(ctx) {
  const kind = kindArg(ctx, 'take');
  const id = await ctx.agentIdFor();
  const data = await ctx.owner.delete(`/v1/agents/${id}/resources/${kind}`);
  ctx.print(data, () => `Took away its ${KIND_NAMES[kind]}.`);
}

const LIMIT_FLAGS = {
  wallet: { 'per-transfer': 'perTransfer', daily: 'daily', 'approval-above': 'approvalAbove' },
  card: { 'per-transaction': 'perTransaction', daily: 'daily', monthly: 'monthly', 'blocked-categories': 'blockedCategories', 'allowed-categories': 'allowedCategories' },
};
const NONE = /^(none|off|null|no)$/i;

export async function limits(ctx) {
  const kind = ctx.args[0];
  if (kind !== 'wallet' && kind !== 'card') throw new UsageError('Limits are for a wallet or a card: timewarp-id limits wallet|card …');
  const known = LIMIT_FLAGS[kind];
  const other = Object.keys(LIMIT_FLAGS[kind === 'wallet' ? 'card' : 'wallet']).filter(name => !(name in known) && ctx.flags[name] !== undefined);
  if (other.length) throw new UsageError(`--${other[0]} is not a ${kind} limit; ${kind} limits are ${Object.keys(known).map(k => `--${k}`).join(', ')}.`);
  const settings = {};
  for (const [flag, key] of Object.entries(known)) {
    const value = ctx.flags[flag];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new UsageError(`--${flag} needs a value.`);
    if (NONE.test(value)) settings[key] = null;
    else if (key.endsWith('Categories')) settings[key] = value.split(',').map(s => s.trim()).filter(Boolean);
    else settings[key] = dollarsToCents(value, `--${flag}`);
  }
  const id = await ctx.agentIdFor();
  if (!Object.keys(settings).length) {
    const { agent } = await ctx.owner.get(`/v1/agents/${id}`);
    const resource = agent.resources?.[kind];
    if (!resource) throw new CliError(`This agent has no ${kind}.`, { hint: `Give it one: timewarp-id give ${kind} --agent ${agent.handle}` });
    return ctx.print({ settings: resource.settings }, () => `${agent.name}'s ${kind}: ${limitText(resource.settings)}.`);
  }
  const data = await ctx.owner.patch(`/v1/agents/${id}/resources/${kind}`, { settings });
  ctx.print(data, ({ resource }) => `New ${kind} limits: ${limitText(resource.settings)}.`);
}

export async function fund(ctx) {
  const raw = ctx.args[0] ?? ctx.flags.amount;
  if (raw === undefined) throw new UsageError('How much? timewarp-id fund --agent <agent> 100');
  const amount = dollarsToCents(raw, 'The amount');
  if (amount <= 0) throw new UsageError('The amount must be more than zero.');
  const id = await ctx.agentIdFor();
  const data = await ctx.owner.post(`/v1/agents/${id}/wallet/test-funds`, { amount });
  ctx.print(data, ({ balance }) => `Added ${cents(amount)} of test money. Balance: ${cents(balance.amount)} ${balance.currency === 'USD' ? '' : balance.currency}`.trim());
}

// --- Approvals ------------------------------------------------------------------------
const describeRequest = r => `${cents(r?.amount)}${r?.to ? ` to ${r.to}` : ''}${r?.memo ? ` (${r.memo})` : ''}`;

// Waiting transfers; in a terminal, answered one by one.
export async function approvals(ctx) {
  const sub = ctx.args[0];
  if (sub === 'approve' || sub === 'deny') return decide(ctx, sub, ctx.args[1]);
  const data = await ctx.owner.get('/v1/approvals', { query: { status: ctx.flags.all ? 'all' : undefined } });
  const rows = data.approvals || [];
  ctx.print(data, () => rows.length ? `${rows.length} waiting for your approval:\n${table(rows, [
    ['AGENT', a => a.agentName || a.agentId], ['AMOUNT', a => cents(a.request?.amount)], ['TO', a => a.request?.to],
    ['MEMO', a => a.request?.memo], ...(ctx.flags.all ? [['STATUS', a => a.status]] : []), ['EXPIRES', a => when(a.expiresAt)], ['ID', a => a.id],
  ])}${ctx.interactive ? '' : '\n\nAnswer with `timewarp-id approve <id>` or `timewarp-id deny <id>`.'}` : 'Nothing is waiting for your approval.');
  if (ctx.json || !ctx.interactive) return;
  for (const row of rows.filter(r => r.status === 'pending')) {
    const answer = (await ctx.ask(`${row.agentName || row.agentId}: ${describeRequest(row.request)}. [a]pprove, [d]eny or [s]kip? `)).trim().toLowerCase();
    if (answer === 'a' || answer === 'approve') await decide(ctx, 'approve', row.id, { confirmed: true });
    else if (answer === 'd' || answer === 'deny') await decide(ctx, 'deny', row.id);
  }
}

async function decide(ctx, decision, id, { confirmed = false } = {}) {
  if (!id) throw new UsageError(`Which approval? timewarp-id ${decision} <id> (see \`timewarp-id approvals\`).`);
  // Approving moves money, so a person answers it: in a terminal they type
  // in, or on the website. An agent running commands (no terminal of its own)
  // can't approve its own payments, even on a computer signed in as the owner.
  if (decision === 'approve' && !confirmed) {
    if (!ctx.interactive) throw new CliError('Approve payments yourself: in a terminal you type in, or with the link on the Agent ID website.', { hint: 'Agents can\'t approve their own payments. `timewarp-id deny <id>` works anywhere.' });
    const { approvals: waiting } = await ctx.owner.get('/v1/approvals');
    const row = (waiting || []).find(a => a.id === id);
    if (row) {
      const answer = (await ctx.ask(`Approve ${row.agentName || row.agentId}: ${describeRequest(row.request)}? [y/N] `)).trim().toLowerCase();
      if (!/^y(es)?$/.test(answer)) { ctx.out('Not approved.'); return; }
    }
  }
  const data = await ctx.owner.post(`/v1/approvals/${encodeURIComponent(id)}`, { decision });
  ctx.print(data, result => decision === 'deny' ? 'Denied. The agent is told the transfer was not approved.'
    : result.status === 'completed' ? `Approved and sent${result.transfer?.amount ? ` ${money(result.transfer.amount)}` : ''}${result.transfer?.counterparty ? ` to ${result.transfer.counterparty}` : ''}.` : `Approved (${result.status}).`);
}

export const approve = ctx => decide(ctx, 'approve', ctx.args[0]);
export const deny = ctx => decide(ctx, 'deny', ctx.args[0]);

// --- Which agent ----------------------------------------------------------------------
export async function use(ctx) {
  const ref = ctx.args[0] || (typeof ctx.flags.agent === 'string' ? ctx.flags.agent : '');
  if (!ref) {
    const chosen = selectAgent(ctx.config, { flags: ctx.flags, env: ctx.env, cwd: ctx.cwd });
    return ctx.print({ agent: chosen.handle, source: chosen.source }, () => `Acting as ${chosen.handle || 'the agent of TIMEWARP_AGENT_KEY'} (from ${chosen.source}).`);
  }
  const profile = findProfile(ctx.config, ref);
  if (!profile) throw new CliError(`There is no key for "${ref}" on this computer.`, { hint: `Get one with \`timewarp-id agents key ${ref}\`, or create the agent with \`timewarp-id agents create\`.` });
  if (ctx.flags.project) {
    const file = path.join(ctx.cwd, PROJECT_FILE);
    fs.writeFileSync(file, `${JSON.stringify({ agent: profile.handle }, null, 2)}\n`);
    return ctx.print({ agent: profile.handle, file }, () => `This project (${ctx.cwd}) now uses ${profile.name} (${profile.handle}).\n${PROJECT_FILE} holds only the handle, no key; each person needs their own key for it.`);
  }
  ctx.config.default = profile.handle;
  ctx.save();
  ctx.print({ agent: profile.handle, default: true }, () => `Commands now act as ${profile.name} (${profile.handle}) by default.`);
}
