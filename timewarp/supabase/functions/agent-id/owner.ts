// What an account does with its agents: create them, hand out keys, give
// them mail, a number, a wallet, a card and a machine (test or live), set
// their limits, answer approvals, see everything they did, verify who is
// responsible, and register companies that accept only verified agents.
import { agentId, checked, fail, handleFor, int, newSecret, relyingPartyId, sha256Hex, str } from './util.ts';
import { KINDS, type Kind, publicConfig } from './config.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { agentView, audit, listEvents, membership, personOf, planOf, resourcesOf, resourceView, verificationOf } from './shared.ts';
import { businessView, decideReview, listReviews, personView, startVerification } from './verification.ts';
import { transfer } from './agent.ts';
import { provisionMail } from './providers/mail.ts';
import { provisionPhone, releasePhone } from './providers/phone.ts';
import { liveBalance, provisionWallet } from './providers/wallet.ts';
import { provisionCard, updateCard } from './providers/card.ts';
import { provisionVm, releaseMachine, SIZES, type Size } from './providers/vm.ts';
import { originInput } from './origin.ts';
import { adminRoutes } from './admin.ts';

type Handler = Route<Owner>[2];
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();

async function ownedAgent(ctx: Ctx, owner: Owner, id: string) {
  const agent = /^agt_[a-z0-9]{24}$/.test(id) ? checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', id).maybeSingle()) as AgentRow | null : null;
  if (!agent || agent.owner_user_id !== owner.userId) throw fail(404, 'not_found', 'This agent does not exist.');
  return agent;
}
const activeAgent = (agent: AgentRow) => { if (agent.status === 'revoked') throw fail(409, 'agent_revoked', 'This agent has been revoked.'); return agent; };

async function ownerEmail(ctx: Ctx, owner: Owner) {
  if (owner.email) return owner.email;
  const { data } = await ctx.admin.auth.admin.getUserById(owner.userId);
  return data?.user?.email || null;
}

// The name on the account's Timewarp profile, when it has one.
async function profileName(ctx: Ctx, userId: string) {
  const { data, error } = await ctx.admin.from('profiles').select('name').eq('user_id', userId).maybeSingle();
  return error ? null : (String(data?.name || '').trim().slice(0, 100) || null);
}

const keyView = (row: any) => ({ id: row.id, name: row.name, prefix: row.prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at, revoked: !!row.revoked_at });

// --- Account -------------------------------------------------------------------
const account: Handler = async (ctx, owner) => {
  const [person, members, plan, agents] = await Promise.all([
    personOf(ctx, owner.userId),
    ctx.admin.from('timewarp_workspace_members').select('workspace_id,role').eq('user_id', owner.userId).eq('status', 'active'),
    planOf(ctx, owner.userId),
    ctx.admin.from('agent_id_agents').select('id').eq('owner_user_id', owner.userId).neq('status', 'revoked'),
  ]);
  const memberships = (checked(members) || []) as any[];
  const ids = memberships.map(m => m.workspace_id);
  const [workspaces, businesses] = ids.length ? await Promise.all([
    ctx.admin.from('timewarp_workspaces').select('id,name').in('id', ids),
    ctx.admin.from('agent_id_businesses').select('*').in('workspace_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const names = new Map(((checked(workspaces) || []) as any[]).map(w => [w.id, w.name]));
  const verified = new Map(((checked(businesses) || []) as any[]).map(b => [b.workspace_id, b]));
  return {
    user: { id: owner.userId, email: await ownerEmail(ctx, owner), name: await profileName(ctx, owner.userId) },
    person: personView(person),
    organizations: memberships.map(m => ({ id: m.workspace_id, name: names.get(m.workspace_id) || 'Organization', role: m.role, business: businessView(verified.get(m.workspace_id)) })),
    plan, reviewer: owner.via === 'session' && ctx.config.reviewers.has(owner.userId),
    agents: { count: (checked(agents) || []).length, max: ctx.config.maxAgents },
    config: publicConfig(ctx.config),
  };
};

// --- Agents --------------------------------------------------------------------

async function organizationFor(ctx: Ctx, owner: Owner, value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const id = str(value, 60, 'organizationId');
  if (!(await membership(ctx, owner.userId, id))) throw fail(403, 'forbidden', 'You are not a member of that organization.');
  return id;
}

async function createKey(ctx: Ctx, owner: Owner, agent: AgentRow | null, name: string) {
  const { secret, prefix } = newSecret(agent ? 'agent' : 'owner');
  const row = checked(await ctx.admin.from('agent_id_keys').insert({ owner_user_id: owner.userId, agent_id: agent?.id || null, name, prefix, hash: await sha256Hex(secret) }).select('*').single());
  await audit(ctx, owner.userId, agent?.id || null, 'owner', agent ? 'agent_key.create' : 'owner_key.create', { key: row.id, prefix });
  return { key: keyView(row), secret };
}

const listAgents: Handler = async (ctx, owner, input) => {
  let query = ctx.admin.from('agent_id_agents').select('*').eq('owner_user_id', owner.userId);
  if (input.status !== 'all') query = query.neq('status', 'revoked');
  const agents = (checked(await query.order('created_at', { ascending: true })) || []) as AgentRow[];
  const resources = await resourcesOf(ctx, agents.map(a => a.id));
  return { agents: agents.map(agent => agentView(ctx, agent, resources)) };
};

const createAgent: Handler = async (ctx, owner, input) => {
  const name = str(input.name, 60, 'name', { required: true });
  const origin = originInput(input);
  const runtime = String(origin.runtime || 'custom');
  const workspaceId = (await organizationFor(ctx, owner, input.organizationId)) ?? null;
  const desktopAgentId = input.desktopAgentId ? str(input.desktopAgentId, 100, 'desktopAgentId') : null;
  if (ctx.config.verificationRequired('agent')) {
    const verification = await verificationOf(ctx, { owner_user_id: owner.userId, workspace_id: workspaceId });
    if (!verification.verified) throw fail(403, 'verification_required', 'Verify your identity (or your organization) before creating agents.');
  }
  const existing = (checked(await ctx.admin.from('agent_id_agents').select('id').eq('owner_user_id', owner.userId).neq('status', 'revoked')) || []) as any[];
  if (existing.length >= ctx.config.maxAgents) throw fail(409, 'too_many', `An account can have at most ${ctx.config.maxAgents} agents.`);
  let agent: AgentRow | null = null;
  for (let attempt = 0; attempt < 3 && !agent; attempt++) {
    const { data, error } = await ctx.admin.from('agent_id_agents').insert({ id: agentId(), owner_user_id: owner.userId, workspace_id: workspaceId, name, handle: handleFor(name), ...origin, runtime, desktop_agent_id: desktopAgentId }).select('*').single();
    if (error?.code === '23505') continue;
    agent = checked({ data, error });
  }
  if (!agent) throw fail(503, 'unavailable', 'Could not create the agent. Try again.');
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent.create', { name, runtime, organization: workspaceId });
  const key = input.key === false ? null : await createKey(ctx, owner, agent, str(input.keyName, 60, 'keyName') || 'Default key');
  return { agent: agentView(ctx, agent), ...(key ? { key: key.key, secret: key.secret } : {}) };
};

const getAgent: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const [resources, keys, signing, verification] = await Promise.all([
    resourcesOf(ctx, [agent.id]),
    ctx.admin.from('agent_id_keys').select('*').eq('agent_id', agent.id).is('revoked_at', null).order('created_at'),
    ctx.admin.from('agent_id_signing_keys').select('*').eq('agent_id', agent.id).is('revoked_at', null).order('created_at'),
    verificationOf(ctx, agent),
  ]);
  return {
    agent: agentView(ctx, agent, resources),
    keys: ((checked(keys) || []) as any[]).map(keyView),
    signingKeys: ((checked(signing) || []) as any[]).map(row => ({ id: row.id, name: row.name, fingerprint: row.fingerprint, publicKey: row.public_key, createdAt: row.created_at })),
    verification: { verified: verification.verified, level: verification.level },
  };
};

const updateAgent: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  const patch: Record<string, unknown> = { updated_at: iso(ctx) };
  if (input.name !== undefined) patch.name = str(input.name, 60, 'name', { required: true });
  Object.assign(patch, originInput(input));
  if (input.status !== undefined) { if (!['active', 'suspended'].includes(input.status)) throw fail(400, 'invalid', 'status is active or suspended. Revoke with DELETE.'); patch.status = input.status; }
  if (input.desktopAgentId !== undefined) patch.desktop_agent_id = input.desktopAgentId ? str(input.desktopAgentId, 100, 'desktopAgentId') : null;
  if (input.organizationId !== undefined) patch.workspace_id = await organizationFor(ctx, owner, input.organizationId);
  const row = checked(await ctx.admin.from('agent_id_agents').update(patch).eq('id', agent.id).select('*').single()) as AgentRow;
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent.update', Object.fromEntries(Object.keys(patch).filter(k => k !== 'updated_at').map(k => [k, patch[k]])));
  return { agent: agentView(ctx, row, await resourcesOf(ctx, [agent.id])) };
};

// Revoking is final: keys and signing keys stop working, resources go back
// to their providers, and passports already issued fail online checks.
const revokeAgent: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  if (agent.status === 'revoked') return { agent: agentView(ctx, agent) };
  const resources = await resourcesOf(ctx, [agent.id]);
  // A live wallet's money would be stranded: it has to be empty first. Pausing
  // the agent stops it at once in the meantime.
  for (const resource of resources) {
    if (resource.kind !== 'wallet' || resource.mode !== 'live') continue;
    const balance = await liveBalance(ctx, resource).then(b => b.total, () => null);
    if (balance === null) throw fail(503, 'wallet_unreachable', 'The wallet\'s balance can\'t be checked right now, so the agent wasn\'t revoked. Pause it instead and try again later.');
    if (balance > 0) throw fail(409, 'wallet_not_empty', 'Move the money out of this agent\'s live wallet before revoking it. Pausing it stops it at once.');
  }
  checked(await ctx.admin.from('agent_id_agents').update({ status: 'revoked', updated_at: iso(ctx) }).eq('id', agent.id).select('id'));
  await ctx.admin.from('agent_id_keys').update({ revoked_at: iso(ctx) }).eq('agent_id', agent.id).is('revoked_at', null);
  await ctx.admin.from('agent_id_signing_keys').update({ revoked_at: iso(ctx) }).eq('agent_id', agent.id).is('revoked_at', null);
  for (const resource of resources) await release(ctx, resource).catch(error => console.error('[agent-id] release on revoke', resource.id, error?.message));
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent.revoke', {});
  return { agent: agentView(ctx, { ...agent, status: 'revoked' }) };
};

const createAgentKey: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  const active = (checked(await ctx.admin.from('agent_id_keys').select('id').eq('agent_id', agent.id).is('revoked_at', null)) || []) as any[];
  if (active.length >= 10) throw fail(409, 'too_many', 'An agent can have at most 10 keys. Revoke one first.');
  return createKey(ctx, owner, agent, str(input.name, 60, 'name') || 'Key');
};
const revokeAgentKey: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const rows = checked(await ctx.admin.from('agent_id_keys').update({ revoked_at: iso(ctx) }).eq('id', params.keyId).eq('agent_id', agent.id).is('revoked_at', null).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No active key with that id.');
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent_key.revoke', { key: params.keyId });
  return { revoked: true };
};

// --- Resources -----------------------------------------------------------------
const money = (value: unknown, field: string) => value === null || value === '' ? undefined : int(value, field, { min: 0, max: 100_000_000_00 });
const categories = (value: unknown, field: string) => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw fail(400, 'invalid', `${field} must be a list of up to 50 merchant categories.`);
  return value.map(item => str(item, 80, field, { required: true }).toLowerCase());
};
// The settings an owner controls on each kind; amounts are in cents.
function settingsFor(kind: Kind, input: any, current: Record<string, unknown> = {}) {
  const next: Record<string, unknown> = { ...current };
  const set = (key: string, value: unknown) => { if (value === undefined) return; if (value === null) delete next[key]; else next[key] = value; };
  const amounts = (keys: string[]) => { for (const key of keys) if (key in (input || {})) set(key, input[key] === null ? null : money(input[key], key)); };
  if (kind === 'wallet') amounts(['perTransfer', 'daily', 'approvalAbove']);
  if (kind === 'card') {
    amounts(['perTransaction', 'daily', 'monthly']);
    if ('blockedCategories' in (input || {})) set('blockedCategories', input.blockedCategories === null ? null : categories(input.blockedCategories, 'blockedCategories'));
    if ('allowedCategories' in (input || {})) set('allowedCategories', input.allowedCategories === null ? null : categories(input.allowedCategories, 'allowedCategories'));
  }
  if (kind === 'phone' && 'greeting' in (input || {})) set('greeting', input.greeting === null ? null : str(input.greeting, 300, 'greeting'));
  return next;
}
// New wallets and cards start with modest limits the owner can raise.
const DEFAULTS: Partial<Record<Kind, Record<string, unknown>>> = {
  wallet: { perTransfer: 5000, daily: 10000, approvalAbove: 2500 },
  card: { perTransaction: 5000, daily: 10000, monthly: 50000 },
};

async function gate(ctx: Ctx, owner: Owner, agent: AgentRow, kind: Kind) {
  if (!ctx.config.liveListed(kind)) throw fail(403, 'live_unavailable', `Live ${kind === 'vm' ? 'machines' : kind} isn't available yet. Use test mode for now.`);
  if (!ctx.config.isLive(kind)) throw fail(503, 'provider_unavailable', `Live ${kind === 'vm' ? 'machines are' : kind + ' is'} not set up on this deployment.`);
  if (ctx.config.verificationRequired(kind) && !(await verificationOf(ctx, agent)).verified) throw fail(403, 'verification_required', 'Verify your identity (or your organization) to give agents this for real.');
  if (ctx.config.paidPlanRequired(kind) && (await planOf(ctx, owner.userId)) === 'free') throw fail(402, 'plan_required', `A live ${kind === 'phone' ? 'phone number' : kind} needs a paid Timewarp plan.`);
}

const provision: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  if (agent.status !== 'active') throw fail(409, 'agent_suspended', 'Resume the agent first.');
  const kind = String(input.kind) as Kind;
  if (!KINDS.includes(kind)) throw fail(400, 'invalid', `kind is one of ${KINDS.join(', ')}.`);
  const mode = input.mode === 'live' ? 'live' : 'test';
  if (mode === 'live') await gate(ctx, owner, agent, kind);
  const settings = settingsFor(kind, input.settings || {}, DEFAULTS[kind] || {});
  const size = (input.options?.size in SIZES ? input.options.size : 'medium') as Size;
  // The row comes first: it holds the agent's one slot for this kind, and a
  // phone number's webhooks need its id.
  const { data: placeholder, error } = await ctx.admin.from('agent_id_resources').insert({ agent_id: agent.id, owner_user_id: owner.userId, kind, provider: 'pending', mode, status: 'provisioning', settings }).select('*').single();
  if (error?.code === '23505') throw fail(409, 'already_has', `This agent already has a ${kind === 'vm' ? 'machine' : kind}. Remove it first to get a new one.`);
  checked({ data: placeholder, error });
  try {
    let fields: Record<string, unknown>;
    if (kind === 'mail') { const r = await provisionMail(ctx, agent, mode); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, status: 'active' }; }
    else if (kind === 'phone') { const r = await provisionPhone(ctx, agent, placeholder.id, mode, input.options || {}); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, status: 'active' }; }
    else if (kind === 'wallet') { const r = await provisionWallet(ctx, agent, mode, placeholder.id); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, currency: r.currency, status: 'active' }; }
    else if (kind === 'card') {
      const person = await personOf(ctx, owner.userId);
      const r = await provisionCard(ctx, agent, mode, { person, email: await ownerEmail(ctx, owner) || '', billing: input.options?.billing, currency: input.options?.currency, settings });
      if (r.cardholder && r.cardholder !== person?.cardholder_ref) await ctx.admin.from('agent_id_people').update({ cardholder_ref: r.cardholder }).eq('user_id', owner.userId);
      fields = { provider: r.provider, label: r.label, provider_ref: r.providerRef, state: r.state, currency: r.currency, status: 'active' };
    }
    else { const r = await provisionVm(ctx, agent, mode, size); fields = { provider: r.provider, label: r.label, provider_ref: r.providerRef, state: r.state, status: r.status }; }
    const row = checked(await ctx.admin.from('agent_id_resources').update({ ...fields, updated_at: iso(ctx) }).eq('id', placeholder.id).select('*').single()) as ResourceRow;
    await audit(ctx, owner.userId, agent.id, 'owner', 'resource.provision', { kind, mode, provider: row.provider });
    return { resource: resourceView(row) };
  } catch (caught) {
    await ctx.admin.from('agent_id_resources').delete().eq('id', placeholder.id);
    throw caught;
  }
};

async function release(ctx: Ctx, resource: ResourceRow) {
  if (resource.kind === 'phone') await releasePhone(ctx, resource);
  if (resource.kind === 'vm') await releaseMachine(ctx, resource);
  if (resource.kind === 'card') await updateCard(ctx, resource, { status: 'canceled' });
  await ctx.admin.from('agent_id_resources').update({ status: 'released', released_at: iso(ctx), updated_at: iso(ctx) }).eq('id', resource.id);
}

async function ownedResource(ctx: Ctx, owner: Owner, agentIdValue: string, kind: string) {
  const agent = await ownedAgent(ctx, owner, agentIdValue);
  if (!KINDS.includes(kind as Kind)) throw fail(404, 'not_found', 'Unknown resource kind.');
  const resource = checked(await ctx.admin.from('agent_id_resources').select('*').eq('agent_id', agent.id).eq('kind', kind).neq('status', 'released').maybeSingle()) as ResourceRow | null;
  if (!resource) throw fail(404, 'not_found', `This agent has no ${kind}.`);
  return { agent, resource };
}

const updateResource: Handler = async (ctx, owner, input, params) => {
  const { agent, resource } = await ownedResource(ctx, owner, params.id, params.kind);
  const patch: Record<string, unknown> = { updated_at: iso(ctx) };
  if (input.settings !== undefined) patch.settings = settingsFor(resource.kind, input.settings, resource.settings);
  if (input.status !== undefined) {
    if (!['active', 'suspended'].includes(input.status) || resource.status === 'provisioning') throw fail(400, 'invalid', 'status is active or suspended.');
    patch.status = input.status;
  }
  if (resource.kind === 'card') await updateCard(ctx, resource, { ...(patch.status ? { status: patch.status === 'active' ? 'active' : 'inactive' } : {}), ...(patch.settings ? { settings: patch.settings as Record<string, unknown> } : {}) });
  const row = checked(await ctx.admin.from('agent_id_resources').update(patch).eq('id', resource.id).select('*').single()) as ResourceRow;
  await audit(ctx, owner.userId, agent.id, 'owner', 'resource.update', { kind: resource.kind, ...(patch.status ? { status: patch.status } : {}), ...(patch.settings ? { settings: patch.settings } : {}) });
  return { resource: resourceView(row) };
};

const removeResource: Handler = async (ctx, owner, _input, params) => {
  const { agent, resource } = await ownedResource(ctx, owner, params.id, params.kind);
  if (resource.kind === 'wallet' && resource.mode === 'live' && (await liveBalance(ctx, resource)).total > 0) throw fail(409, 'wallet_not_empty', 'Move the money out of this wallet before removing it.');
  await release(ctx, resource);
  await audit(ctx, owner.userId, agent.id, 'owner', 'resource.release', { kind: resource.kind, mode: resource.mode });
  return { released: true };
};

const testFunds: Handler = async (ctx, owner, input, params) => {
  const { agent, resource } = await ownedResource(ctx, owner, params.id, 'wallet');
  const amount = int(input.amount ?? 10000, 'amount', { min: 1, max: 100000 });
  const result = checked(await ctx.admin.rpc('agent_id_test_fund', { p_resource: resource.id, p_amount: amount })) as any;
  if (result?.status === 'not_test_wallet') throw fail(409, 'live_wallet', 'Only test wallets get test money. Fund a live wallet by sending USDC to its address.');
  if (result?.status === 'over_limit') throw fail(409, 'over_limit', 'A test wallet holds at most 10,000.00.');
  if (result?.status !== 'ok') throw fail(400, 'invalid', 'Could not add test money.');
  await audit(ctx, owner.userId, agent.id, 'owner', 'wallet.test_funds', { amount });
  return { balance: { amount: Number(result.balance), currency: resource.currency || 'USD' } };
};

const EVENT_KINDS = ['mail', 'sms', 'call', 'wallet', 'card', 'vm'];
const agentEvents: Handler = async (ctx, owner, input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const kinds = input.kind ? String(input.kind).split(',').filter(kind => EVENT_KINDS.includes(kind)) : EVENT_KINDS;
  if (!kinds.length) throw fail(400, 'invalid', `kind is one of ${EVENT_KINDS.join(', ')}.`);
  return listEvents(ctx, agent.id, kinds, input);
};
const agentContacts: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const rows = (checked(await ctx.admin.from('agent_id_contacts').select('*').eq('agent_id', agent.id).order('name').limit(1000)) || []) as any[];
  return { contacts: rows.map(row => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, wallet: row.wallet, note: row.note, updatedAt: row.updated_at })) };
};

// --- Card early access -----------------------------------------------------------
// Until virtual cards open, an owner applies for one per agent.
const applicationView = (row: any) => row ? { status: row.status, useCase: row.use_case, monthlySpend: row.monthly_spend === null ? null : { amount: Number(row.monthly_spend), currency: 'USD', display: `${(Number(row.monthly_spend) / 100).toFixed(2)} USD` }, country: row.country, createdAt: row.created_at } : null;
const cardApplication: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  return { application: applicationView(checked(await ctx.admin.from('agent_id_card_applications').select('*').eq('agent_id', agent.id).maybeSingle())) };
};
const applyForCard: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  const country = input.country ? str(input.country, 2, 'country').toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw fail(400, 'invalid', 'country is a two-letter country code.');
  const row = checked(await ctx.admin.from('agent_id_card_applications').upsert({
    agent_id: agent.id, owner_user_id: owner.userId, status: 'submitted',
    use_case: str(input.useCase, 500, 'useCase', { required: true, multiline: true }),
    monthly_spend: input.monthlySpend === undefined || input.monthlySpend === null ? null : int(input.monthlySpend, 'monthlySpend', { min: 0, max: 100_000_000_00 }),
    country, updated_at: iso(ctx),
  }, { onConflict: 'agent_id' }).select('*').single());
  await audit(ctx, owner.userId, agent.id, 'owner', 'card.apply', {});
  return { application: applicationView(row) };
};

// --- Approvals -------------------------------------------------------------------
const approvalView = (row: any, names: Map<string, string>) => ({ id: row.id, agentId: row.agent_id, agentName: names.get(row.agent_id) || null, kind: row.kind, request: row.request, status: row.status, reason: row.reason, result: row.result, createdAt: row.created_at, expiresAt: row.expires_at, decidedAt: row.decided_at });
const listApprovals: Handler = async (ctx, owner, input) => {
  let query = ctx.admin.from('agent_id_approvals').select('*').eq('owner_user_id', owner.userId);
  if (input.status !== 'all') query = query.eq('status', 'pending').gt('expires_at', iso(ctx));
  const rows = (checked(await query.order('created_at', { ascending: false }).limit(100)) || []) as any[];
  const agents = rows.length ? (checked(await ctx.admin.from('agent_id_agents').select('id,name').in('id', [...new Set(rows.map(r => r.agent_id))])) || []) as any[] : [];
  const names = new Map(agents.map(a => [a.id, a.name]));
  return { approvals: rows.map(row => approvalView(row, names)) };
};
const decideApproval: Handler = async (ctx, owner, input, params) => {
  const decision = input.decision === 'approve' ? 'approve' : input.decision === 'deny' ? 'deny' : null;
  if (!decision) throw fail(400, 'invalid', 'decision is approve or deny.');
  const result = checked(await ctx.admin.rpc('agent_id_decide_approval', { p_owner: owner.userId, p_approval: params.id, p_decision: decision })) as any;
  if (result?.status === 'not_found') throw fail(404, 'not_found', 'No approval with that id.');
  if (result?.status === 'already_decided') throw fail(409, 'already_decided', `This was already ${result.decision}.`);
  if (result?.status === 'expired') throw fail(409, 'expired', 'This request expired; the agent can ask again.');
  if (result?.status !== 'ok') throw fail(400, 'invalid', 'Could not record the decision.');
  await audit(ctx, owner.userId, result.agent, 'owner', `approval.${decision}`, { approval: params.id });
  if (decision === 'deny') return { status: 'denied' };
  const agent = activeAgent(await ownedAgent(ctx, owner, result.agent));
  const who: AgentCaller = { kind: 'agent', userId: owner.userId, agent, via: 'owner' };
  try {
    const done = await transfer(ctx, who, { to: String(result.request.input || result.request.to), amount: Number(result.request.amount), memo: result.request.memo || undefined }, params.id);
    return { decision: 'approved', ...done };
  } catch (error) {
    await ctx.admin.from('agent_id_approvals').update({ status: 'failed', reason: String((error as Error).message || 'failed').slice(0, 500) }).eq('id', params.id).eq('status', 'approved');
    throw error;
  }
};

const auditLog: Handler = async (ctx, owner, input) => {
  let query = ctx.admin.from('agent_id_audit').select('*').eq('owner_user_id', owner.userId);
  if (input.agent) query = query.eq('agent_id', String(input.agent));
  const rows = (checked(await query.order('at', { ascending: false }).limit(Math.max(1, Math.min(200, Number(input.limit) || 50)))) || []) as any[];
  return { entries: rows.map(row => ({ id: row.id, agentId: row.agent_id, actor: row.actor, action: row.action, detail: row.detail, at: row.at })) };
};

// --- Owner keys (for the CLI) ----------------------------------------------------
const listOwnerKeys: Handler = async (ctx, owner) => ({ keys: ((checked(await ctx.admin.from('agent_id_keys').select('*').eq('owner_user_id', owner.userId).is('agent_id', null).is('revoked_at', null).order('created_at')) || []) as any[]).map(keyView) });
const createOwnerKey: Handler = async (ctx, owner, input) => {
  // Only a signed-in session mints owner keys: a leaked key can't make more.
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Create owner keys on the Agent ID dashboard.');
  return createKey(ctx, owner, null, str(input.name, 60, 'name') || 'CLI');
};
const revokeOwnerKey: Handler = async (ctx, owner, _input, params) => {
  const rows = checked(await ctx.admin.from('agent_id_keys').update({ revoked_at: iso(ctx) }).eq('id', params.keyId).eq('owner_user_id', owner.userId).is('agent_id', null).is('revoked_at', null).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No active owner key with that id.');
  await audit(ctx, owner.userId, null, 'owner', 'owner_key.revoke', { key: params.keyId });
  return { revoked: true };
};

// --- Companies that accept only verified agents ---------------------------------
const REQUIRE = ['any', 'verified', 'kyc', 'kyb'];
function policyFor(input: any, current: Record<string, unknown> = {}) {
  const policy: Record<string, unknown> = { require: 'verified', ...current };
  if (input?.require !== undefined) { if (!REQUIRE.includes(input.require)) throw fail(400, 'invalid', `policy.require is one of ${REQUIRE.join(', ')}.`); policy.require = input.require; }
  for (const key of ['organizations', 'agents']) {
    if (input?.[key] === undefined) continue;
    if (input[key] === null) { delete policy[key]; continue; }
    if (!Array.isArray(input[key]) || input[key].length > 100) throw fail(400, 'invalid', `policy.${key} must be a list.`);
    policy[key] = input[key].map((item: unknown) => str(item, 60, `policy.${key}`, { required: true }));
  }
  return policy;
}
const rpView = (row: any) => ({ id: row.id, name: row.name, audience: row.audience, organizationId: row.workspace_id, policy: row.policy, secretPrefix: row.secret_prefix, createdAt: row.created_at, revoked: !!row.revoked_at });
const listRelyingParties: Handler = async (ctx, owner) => ({ relyingParties: ((checked(await ctx.admin.from('agent_id_relying_parties').select('*').eq('owner_user_id', owner.userId).is('revoked_at', null).order('created_at')) || []) as any[]).map(rpView) });
const createRelyingParty: Handler = async (ctx, owner, input) => {
  const name = str(input.name, 80, 'name', { required: true });
  const audience = str(input.audience, 300, 'audience', { required: true });
  if (audience.length < 3) throw fail(400, 'invalid', 'audience must name your service, such as https://api.example.com.');
  let workspaceId: string | null = null;
  if (input.organizationId) {
    workspaceId = str(input.organizationId, 60, 'organizationId');
    const role = await membership(ctx, owner.userId, workspaceId);
    if (role !== 'owner' && role !== 'admin') throw fail(403, 'forbidden', 'Only an owner or admin can register a company for the organization.');
  }
  const { secret, prefix } = newSecret('relyingParty');
  const data = checked(await ctx.admin.from('agent_id_relying_parties').insert({ id: relyingPartyId(), owner_user_id: owner.userId, workspace_id: workspaceId, name, audience, secret_hash: await sha256Hex(secret), secret_prefix: prefix, policy: policyFor(input.policy) }).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'relying_party.create', { id: data.id, audience });
  return { relyingParty: rpView(data), secret };
};
const updateRelyingParty: Handler = async (ctx, owner, input, params) => {
  const row = checked(await ctx.admin.from('agent_id_relying_parties').select('*').eq('id', params.rpId).eq('owner_user_id', owner.userId).is('revoked_at', null).maybeSingle()) as any;
  if (!row) throw fail(404, 'not_found', 'No company with that id.');
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = str(input.name, 80, 'name', { required: true });
  if (input.policy !== undefined) patch.policy = policyFor(input.policy, row.policy);
  const updated = checked(await ctx.admin.from('agent_id_relying_parties').update(patch).eq('id', row.id).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'relying_party.update', { id: row.id });
  return { relyingParty: rpView(updated) };
};
// A new secret; the old one stops working at once.
const rotateRelyingPartySecret: Handler = async (ctx, owner, _input, params) => {
  const { secret, prefix } = newSecret('relyingParty');
  const rows = checked(await ctx.admin.from('agent_id_relying_parties').update({ secret_hash: await sha256Hex(secret), secret_prefix: prefix }).eq('id', params.rpId).eq('owner_user_id', owner.userId).is('revoked_at', null).select('*')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No company with that id.');
  await audit(ctx, owner.userId, null, 'owner', 'relying_party.rotate_secret', { id: params.rpId });
  return { relyingParty: rpView(rows[0]), secret };
};
const revokeRelyingParty: Handler = async (ctx, owner, _input, params) => {
  const rows = checked(await ctx.admin.from('agent_id_relying_parties').update({ revoked_at: iso(ctx) }).eq('id', params.rpId).eq('owner_user_id', owner.userId).is('revoked_at', null).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No company with that id.');
  await audit(ctx, owner.userId, null, 'owner', 'relying_party.revoke', { id: params.rpId });
  return { revoked: true };
};

export const ownerRoutes: Route<Owner>[] = [
  ...adminRoutes,
  ['GET', '/v1/account', account],
  ['POST', '/v1/account/verification', (ctx, owner, input) => startVerification(ctx, owner, input)],
  ['GET', '/v1/agents', listAgents], ['POST', '/v1/agents', createAgent],
  ['GET', '/v1/agents/:id', getAgent], ['PATCH', '/v1/agents/:id', updateAgent], ['DELETE', '/v1/agents/:id', revokeAgent],
  ['POST', '/v1/agents/:id/keys', createAgentKey], ['DELETE', '/v1/agents/:id/keys/:keyId', revokeAgentKey],
  ['POST', '/v1/agents/:id/resources', provision], ['PATCH', '/v1/agents/:id/resources/:kind', updateResource], ['DELETE', '/v1/agents/:id/resources/:kind', removeResource],
  ['POST', '/v1/agents/:id/wallet/test-funds', testFunds],
  ['GET', '/v1/agents/:id/events', agentEvents], ['GET', '/v1/agents/:id/contacts', agentContacts],
  ['GET', '/v1/agents/:id/card-application', cardApplication], ['POST', '/v1/agents/:id/card-application', applyForCard],
  ['GET', '/v1/approvals', listApprovals], ['POST', '/v1/approvals/:id', decideApproval],
  ['GET', '/v1/audit', auditLog],
  ['GET', '/v1/keys', listOwnerKeys], ['POST', '/v1/keys', createOwnerKey], ['DELETE', '/v1/keys/:keyId', revokeOwnerKey],
  ['GET', '/v1/relying-parties', listRelyingParties], ['POST', '/v1/relying-parties', createRelyingParty],
  ['PATCH', '/v1/relying-parties/:rpId', updateRelyingParty], ['DELETE', '/v1/relying-parties/:rpId', revokeRelyingParty],
  ['POST', '/v1/relying-parties/:rpId/secret', rotateRelyingPartySecret],
  ['GET', '/v1/reviews', (ctx, owner) => listReviews(ctx, owner)],
  ['POST', '/v1/reviews/:kind/:id', (ctx, owner, input, params) => decideReview(ctx, owner, params.kind, params.id, input)],
];
