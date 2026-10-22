// What an account does with its agents: create them, hand out keys, give
// them mail, a number, a wallet, a card and a machine (test or live), set
// their limits, answer approvals, see everything they did, verify who is
// responsible, and register companies that accept only verified agents.
import { agentId, cents, checked, fail, handleFor, int, newSecret, randomId, relyingPartyId, sha256Hex, str } from './util.ts';
import { autoGive, giveResource, kindsFor, settingsFor } from './provisioning.ts';
import { bankAvailable, KINDS, type Kind, publicConfig } from './config.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { agentView, audit, MASCOTS, mascotOf, listEvents, membership, personOf, planOf, rateLimit, resourcesOf, resourceView, verificationOf } from './shared.ts';
import { businessView, decideReview, listReviews, personView, reviewDocument, startVerification, uploadBusinessDocument } from './verification.ts';
import { transfer, withdraw } from './agent.ts';
import { releasePhone } from './providers/phone.ts';
import { liveBalance } from './providers/wallet.ts';
import { updateCard } from './providers/card.ts';
import { releaseMachine } from './providers/vm.ts';
import { appsOf, originInput } from './origin.ts';
import { stripe } from './providers/stripe.ts';
import { adminRoutes } from './admin.ts';
import { addBankAccount, bankDeposit, bankPayins, bankStatus, cancelBankPayin, refreshBridgeCheck, refreshBusinessCheck, refreshPayouts, removeBankAccount, startBankPayin, startBankVerification, withdrawToBank } from './bank.ts';
import { cardCurrency, moonpayOn, moonpayUrl } from './providers/moonpay.ts';
import { CREDIT_PACKS } from './pricing.ts';
import { vaultOwnerRoutes } from './vault.ts';

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
  // A check running at Bridge: look how it's going (at most every few seconds).
  await refreshBridgeCheck(ctx, owner.userId).catch(error => console.error('[agent-id] identity check', (error as Error).message));
  const [person, members, plan, agents, compute] = await Promise.all([
    personOf(ctx, owner.userId),
    ctx.admin.from('timewarp_workspace_members').select('workspace_id,role').eq('user_id', owner.userId).eq('status', 'active'),
    planOf(ctx, owner.userId),
    ctx.admin.from('agent_id_agents').select('id').eq('owner_user_id', owner.userId).neq('status', 'revoked'),
    ctx.admin.from('agent_id_compute_allowance').select('used_seconds').eq('user_id', owner.userId).maybeSingle(),
  ]);
  const memberships = (checked(members) || []) as any[];
  const ids = memberships.map(m => m.workspace_id);
  // Businesses Bridge is checking: how it's going, and where to finish.
  const links = new Map(await Promise.all(ids.map(async id => [id, await refreshBusinessCheck(ctx, id).catch(() => null)] as const)));
  const [workspaces, businesses] = ids.length ? await Promise.all([
    ctx.admin.from('timewarp_workspaces').select('id,name').in('id', ids),
    ctx.admin.from('agent_id_businesses').select('*').in('workspace_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const names = new Map(((checked(workspaces) || []) as any[]).map(w => [w.id, w.name]));
  const verified = new Map(((checked(businesses) || []) as any[]).map(b => [b.workspace_id, b]));
  return {
    user: { id: owner.userId, email: await ownerEmail(ctx, owner), name: await profileName(ctx, owner.userId) },
    person: personView(person),
    terms: termsView(ctx, person),
    organizations: memberships.map(m => ({ id: m.workspace_id, name: names.get(m.workspace_id) || 'Organization', role: m.role, business: businessView(verified.get(m.workspace_id), links.get(m.workspace_id)) })),
    plan, reviewer: owner.via === 'session' && ctx.config.reviewers.has(owner.userId),
    agents: { count: (checked(agents) || []).length, max: ctx.config.maxAgents },
    // Free machine time: how much of it this account has used.
    compute: { freeSeconds: Math.round(ctx.config.computeFreeHours * 3600), usedSeconds: Math.max(0, Number((compute.data as any)?.used_seconds) || 0) },
    config: publicConfig(ctx.config),
  };
};

// --- Who a payment goes to -------------------------------------------------------
// Before sending: the agent an id or handle names (anyone's), with its name,
// mascot, and whether its owner is verified, as payment apps show who you pay.
const lookupRecipient: Handler = async (ctx, owner, input) => {
  const to = str(input.to, 100, 'to', { required: true }).trim();
  await rateLimit(ctx, owner.userId, 'recipient-lookup', 60, 2000, 'lookups');
  const query = ctx.admin.from('agent_id_agents').select('*');
  const agent = /^agt_[a-z0-9]{24}$/.test(to) ? checked(await query.eq('id', to).maybeSingle())
    : /^[a-z0-9][a-z0-9-]{0,39}$/.test(to) ? checked(await query.eq('handle', to).maybeSingle()) : null;
  if (!agent || agent.status !== 'active') return { found: false };
  const [resources, verification] = await Promise.all([resourcesOf(ctx, [agent.id]), verificationOf(ctx, agent)]);
  const wallet = resources.find(r => r.kind === 'wallet' && r.status === 'active');
  return {
    found: true,
    agent: { id: agent.id, name: agent.name, handle: agent.handle, mascot: agent.mascot || mascotOf(agent.id), verified: verification.verified, yours: agent.owner_user_id === owner.userId, wallet: wallet ? wallet.mode : null },
  };
};

// --- Credits ---------------------------------------------------------------------
// Timewarp credits pay for what isn't free (machine time after the free hours).
// Bought here in the same packs and at the same Stripe prices as in the
// Timewarp app; Stripe's webhook (stripe-webhook) adds them once paid.
const buyCredits: Handler = async (ctx, owner, input) => {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Buy credits on the Agent ID website.');
  const pack = CREDIT_PACKS.find(p => p.credits === Number(input.credits));
  if (!pack) throw fail(400, 'invalid', `Choose a pack of ${CREDIT_PACKS.map(p => p.credits.toLocaleString('en-US')).join(', ')} credits.`);
  await rateLimit(ctx, owner.userId, 'credits-checkout', 5, 30, 'checkouts');
  const lookup = `timewarp_energy_credits_${pack.credits}_${pack.priceCents}_v1`;
  const found = (await stripe(ctx, 'GET', `/v1/prices?lookup_keys[]=${encodeURIComponent(lookup)}&active=true&limit=1`))?.data?.[0];
  const price = found && found.currency === 'usd' && found.unit_amount === pack.priceCents && !found.recurring ? String(found.id) : null;
  const customer = await ctx.admin.from('timewarp_billing_customers').select('stripe_customer_id').eq('user_id', owner.userId).maybeSingle();
  const customerId = !customer.error && (customer.data as any)?.stripe_customer_id ? String((customer.data as any).stripe_customer_id) : null;
  const email = customerId ? null : await ownerEmail(ctx, owner);
  const session = await stripe(ctx, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    line_items: [price ? { price, quantity: 1 } : { quantity: 1, price_data: { currency: 'usd', unit_amount: pack.priceCents, tax_behavior: 'inclusive', product_data: { name: `Timewarp ${pack.credits.toLocaleString('en-US')} credits`, metadata: { credits: String(pack.credits) } } } }],
    ...(customerId ? { customer: customerId } : email ? { customer_email: email } : {}),
    client_reference_id: owner.userId,
    // What stripe-webhook grants from: the purchase record.
    metadata: { kind: 'credits', pack_credits: String(pack.credits), workspace_id: '', supabase_user_id: owner.userId, source: 'agent-id' },
    allow_promotion_codes: true,
    success_url: `${ctx.config.siteUrl}/agent-id/pricing?credits=added`,
    cancel_url: `${ctx.config.siteUrl}/agent-id/pricing`,
  }, `agent-id-credits-${owner.userId}-${pack.credits}-${Math.floor(ctx.now() / 60_000)}`);
  await audit(ctx, owner.userId, null, 'owner', 'credits.checkout', { credits: pack.credits });
  return { url: String(session.url) };
};

// --- Terms -----------------------------------------------------------------------
// Accepting the current Agent ID Terms is recorded with its version and time.
function termsView(ctx: Ctx, person: any) {
  return { accepted: person?.terms_version === ctx.config.termsVersion && !!person?.terms_accepted_at, version: person?.terms_version || null, acceptedAt: person?.terms_accepted_at || null, current: ctx.config.termsVersion };
}
const acceptTerms: Handler = async (ctx, owner, input) => {
  if (input.version !== ctx.config.termsVersion) throw fail(409, 'terms_changed', 'The Agent ID Terms have changed. Read the current version and accept it.', { current: ctx.config.termsVersion });
  const row = checked(await ctx.admin.from('agent_id_people').upsert({ user_id: owner.userId, terms_version: ctx.config.termsVersion, terms_accepted_at: iso(ctx), updated_at: iso(ctx) }, { onConflict: 'user_id' }).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'terms.accept', { version: ctx.config.termsVersion });
  return { terms: termsView(ctx, row) };
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
  const [resources, apps] = await Promise.all([resourcesOf(ctx, agents.map(a => a.id)), appsOf(ctx, agents.map(a => a.id))]);
  return { agents: agents.map(agent => agentView(ctx, agent, resources, apps)) };
};

const createAgent: Handler = async (ctx, owner, input) => {
  const name = str(input.name, 60, 'name', { required: true });
  const origin = originInput(input);
  const runtime = String(origin.runtime || 'custom');
  const workspaceId = (await organizationFor(ctx, owner, input.organizationId)) ?? null;
  const desktopAgentId = input.desktopAgentId ? str(input.desktopAgentId, 100, 'desktopAgentId') : null;
  await kindsFor(ctx, owner.userId, input.resources);
  if (ctx.config.termsRequired && !termsView(ctx, await personOf(ctx, owner.userId)).accepted) throw fail(403, 'terms_required', 'Accept the Agent ID Terms first (on the dashboard, or with `timewarp-id terms`).');
  if (ctx.config.verificationRequired('agent')) {
    const verification = await verificationOf(ctx, { owner_user_id: owner.userId, workspace_id: workspaceId });
    if (!verification.verified) throw fail(403, 'verification_required', 'Verify your identity (or your organization) before creating agents.');
  }
  const existing = (checked(await ctx.admin.from('agent_id_agents').select('id').eq('owner_user_id', owner.userId).neq('status', 'revoked')) || []) as any[];
  if (existing.length >= ctx.config.maxAgents) throw fail(409, 'too_many', `An account can have at most ${ctx.config.maxAgents} agents.`);
  let agent: AgentRow | null = null;
  for (let attempt = 0; attempt < 3 && !agent; attempt++) {
    const id = agentId();
    const { data, error } = await ctx.admin.from('agent_id_agents').insert({ id, owner_user_id: owner.userId, workspace_id: workspaceId, name, handle: handleFor(name), mascot: mascotOf(id), ...origin, runtime, desktop_agent_id: desktopAgentId }).select('*').single();
    if (error?.code === '23505') continue;
    agent = checked({ data, error });
  }
  if (!agent) throw fail(503, 'unavailable', 'Could not create the agent. Try again.');
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent.create', { name, runtime, organization: workspaceId });
  const key = input.key === false ? null : await createKey(ctx, owner, agent, str(input.keyName, 60, 'keyName') || 'Default key');
  // Ready to use at once: its mail, wallet and (on paid plans) number and machine.
  const setup = await autoGive(ctx, agent, input.resources);
  return { agent: agentView(ctx, agent, await resourcesOf(ctx, [agent.id])), setup: { given: setup.given, skipped: setup.skipped }, ...(key ? { key: key.key, secret: key.secret } : {}) };
};

const getAgent: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const [resources, keys, signing, verification, apps] = await Promise.all([
    resourcesOf(ctx, [agent.id]),
    ctx.admin.from('agent_id_keys').select('*').eq('agent_id', agent.id).is('revoked_at', null).order('created_at'),
    ctx.admin.from('agent_id_signing_keys').select('*').eq('agent_id', agent.id).is('revoked_at', null).order('created_at'),
    verificationOf(ctx, agent),
    appsOf(ctx, [agent.id]),
  ]);
  return {
    agent: agentView(ctx, agent, resources, apps),
    keys: ((checked(keys) || []) as any[]).map(keyView),
    signingKeys: ((checked(signing) || []) as any[]).map(row => ({ id: row.id, name: row.name, fingerprint: row.fingerprint, publicKey: row.public_key, createdAt: row.created_at })),
    verification: { verified: verification.verified, level: verification.level },
  };
};

const updateAgent: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  const patch: Record<string, unknown> = { updated_at: iso(ctx) };
  if (input.name !== undefined) patch.name = str(input.name, 60, 'name', { required: true });
  if (input.mascot !== undefined) {
    if (!(MASCOTS as readonly string[]).includes(input.mascot)) throw fail(400, 'invalid', `mascot is one of ${MASCOTS.join(', ')}.`);
    patch.mascot = input.mascot;
  }
  Object.assign(patch, originInput(input));
  if (input.status !== undefined) { if (!['active', 'suspended'].includes(input.status)) throw fail(400, 'invalid', 'status is active or suspended. Revoke with DELETE.'); patch.status = input.status; }
  if (input.desktopAgentId !== undefined) patch.desktop_agent_id = input.desktopAgentId ? str(input.desktopAgentId, 100, 'desktopAgentId') : null;
  if (input.organizationId !== undefined) patch.workspace_id = await organizationFor(ctx, owner, input.organizationId);
  const row = checked(await ctx.admin.from('agent_id_agents').update(patch).eq('id', agent.id).select('*').single()) as AgentRow;
  await audit(ctx, owner.userId, agent.id, 'owner', 'agent.update', Object.fromEntries(Object.keys(patch).filter(k => k !== 'updated_at').map(k => [k, patch[k]])));
  return { agent: agentView(ctx, row, await resourcesOf(ctx, [agent.id]), await appsOf(ctx, [agent.id])) };
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
// One at a time ("Add mail", the CLI's --give); a new agent gets its set in createAgent.
const provision: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  if (agent.status !== 'active') throw fail(409, 'agent_suspended', 'Resume the agent first.');
  const kind = String(input.kind) as Kind;
  if (!KINDS.includes(kind)) throw fail(400, 'invalid', `kind is one of ${KINDS.join(', ')}.`);
  return { resource: resourceView(await giveResource(ctx, agent, kind, input)) };
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

// --- Wallet: adding and taking out money ---------------------------------------
// Adding money: the wallet's address for a transfer from an exchange or another
// wallet (USDC or USDT on Base), a SEPA transfer of a set amount (bank.ts), and
// a card. Cards go through Privy's funding by default: the onramps switched on
// in Privy's dashboard (Stripe, MoonPay, Meld), opened in the browser by
// Privy's SDK once the owner confirms their email with Privy. Otherwise MoonPay
// where its own keys are set, or Stripe's crypto onramp where Stripe approved
// it (the US only). AGENT_ID_CARD_PROVIDER picks one of them.
const stripeOnramp = (ctx: Ctx) => /^(sk|rk)_(live|test)_/.test(ctx.config.env('STRIPE_SECRET_KEY')) && !['', 'false', '0', 'off'].includes(ctx.config.env('STRIPE_CRYPTO_ONRAMP_ENABLED').toLowerCase());
const privyAppId = (ctx: Ctx) => ctx.config.env('PRIVY_CLIENT_APP_ID') || ctx.config.env('PRIVY_APP_ID');
function cardProvider(ctx: Ctx) {
  if (ctx.config.env('AGENT_ID_CARD_PAYMENTS') === 'off') return null;
  const available: Record<string, boolean> = { privy: ctx.config.providers.wallet.configured && !!privyAppId(ctx), moonpay: moonpayOn(ctx), stripe: stripeOnramp(ctx) };
  const chosen = ctx.config.env('AGENT_ID_CARD_PROVIDER').toLowerCase();
  if (chosen) return available[chosen] ? chosen : null;
  return (['privy', 'moonpay', 'stripe'] as const).find(name => available[name]) ?? null;
}
// USDC's contract on Base, where card purchases land.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Privy's onramps take US dollars and euros: euros for people in Europe.
const privyCurrency = (country: string | null | undefined) => cardCurrency(country) === 'usd' ? 'usd' : 'eur';
// Development deployments buy in the providers' sandboxes, never with real money.
const privyCard = (ctx: Ctx) => ({ appId: privyAppId(ctx), environment: ctx.config.testMode ? 'sandbox' : 'production' });
const addMoneyInfo: Handler = async (ctx, owner, _input, params) => {
  const { resource } = await ownedResource(ctx, owner, params.id, 'wallet');
  const live = resource.mode === 'live';
  const chain = String(resource.state?.chain || ctx.config.walletChain);
  const card = live && chain === 'base' ? cardProvider(ctx) : null;
  return {
    address: resource.address, mode: resource.mode,
    network: live ? { id: chain, name: chain === 'base_sepolia' ? 'Base Sepolia (testnet)' : 'Base' } : null,
    assets: live ? ['USDC', 'USDT'] : [],
    card: { available: !!card, ...(card ? { provider: card } : {}), ...(card === 'privy' ? { privy: privyCard(ctx) } : {}) },
    bank: { available: live && chain === 'base' && bankAvailable(ctx.config) },
    test: !live,
  };
};
const addMoneyByCard: Handler = async (ctx, owner, input, params, req) => {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Add money on the Agent ID website.');
  const { agent, resource } = await ownedResource(ctx, owner, params.id, 'wallet');
  const provider = resource.mode === 'live' && String(resource.state?.chain || ctx.config.walletChain) === 'base' ? cardProvider(ctx) : null;
  if (!provider) throw fail(409, 'card_unavailable', 'Buying with a card isn\'t available for this wallet. Send USDC on Base to its address instead.');
  const amount = input.amount === undefined || input.amount === null || input.amount === '' ? null : cents({ value: input.amount }, 'amount');
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  await rateLimit(ctx, owner.userId, 'card-payment', 10, 50, 'card payments');
  if (provider === 'privy') {
    // The browser opens Privy's payment window for this wallet; recorded here first.
    const currency = privyCurrency((await personOf(ctx, owner.userId))?.country);
    const reference = `card_${randomId(24)}`;
    const email = owner.email || (await ctx.admin.auth.admin.getUserById(owner.userId)).data?.user?.email || null;
    await audit(ctx, owner.userId, agent.id, 'owner', 'wallet.add_money_card', { provider, amount, currency, reference });
    return { provider, ...privyCard(ctx), address: resource.address, chain: 'eip155:8453', asset: USDC_BASE, currency, email, reference };
  }
  if (provider === 'moonpay') {
    const currency = cardCurrency((await personOf(ctx, owner.userId))?.country);
    const reference = `card_${randomId(24)}`;
    const email = owner.email || (await ctx.admin.auth.admin.getUserById(owner.userId)).data?.user?.email || null;
    const url = await moonpayUrl(ctx, {
      address: resource.address!, currency, amount, email, customer: owner.userId, reference, ip: ip || null,
      returnTo: `${ctx.config.siteUrl}/agent-id/agents/${agent.id}?tab=wallet`,
    });
    await audit(ctx, owner.userId, agent.id, 'owner', 'wallet.add_money_card', { provider, amount, currency, reference });
    return { provider, url };
  }
  const session = await stripe(ctx, 'POST', '/v1/crypto/onramp_sessions', {
    wallet_addresses: { base_network: resource.address }, lock_wallet_address: true,
    destination_networks: ['base'], destination_network: 'base', destination_currencies: ['usdc'], destination_currency: 'usdc',
    ...(amount ? { source_currency: 'usd', source_amount: (amount / 100).toFixed(2) } : {}),
    ...(ip ? { customer_ip_address: ip } : {}),
    metadata: { agent_id: agent.id },
  }).catch(error => {
    // Stripe sells USDC on Base to buyers in the US only (not the EU, not Hawaii).
    if (String((error as any)?.code || '').startsWith('crypto_onramp_')) throw fail(409, 'card_unavailable_here', 'Buying USDC on Base by card isn\'t available where you are. Use a bank transfer or send crypto instead.');
    throw error;
  });
  await audit(ctx, owner.userId, agent.id, 'owner', 'wallet.add_money_card', { provider, amount });
  const publishableKey = ctx.config.env('STRIPE_PUBLISHABLE_KEY');
  return { provider, clientSecret: String(session.client_secret), ...(publishableKey ? { publishableKey } : {}), ...(session.redirect_url ? { url: String(session.redirect_url) } : {}) };
};
const withdrawMoney: Handler = async (ctx, owner, input, params) => {
  // Money leaves only from a signed-in session: a leaked CLI key can't empty a wallet.
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Withdraw on the Agent ID website.');
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  if (input.bankAccount !== undefined) {
    await rateLimit(ctx, owner.userId, `withdraw:${agent.id}`, 5, 50, 'withdrawals');
    return withdrawToBank(ctx, owner, agent, { bankAccount: str(input.bankAccount, 40, 'bankAccount', { required: true }), amount: cents(input), memo: str(input.memo, 300, 'memo') || undefined });
  }
  const to = str(input.to, 100, 'to', { required: true });
  const asset = input.asset ? str(input.asset, 10, 'asset').toLowerCase() : undefined;
  if (asset && asset !== 'usdc' && asset !== 'usdt') throw fail(400, 'invalid', 'asset is usdc or usdt.');
  await rateLimit(ctx, owner.userId, `withdraw:${agent.id}`, 5, 50, 'withdrawals');
  const result = await withdraw(ctx, agent, { to, amount: cents(input), asset, memo: str(input.memo, 300, 'memo') || undefined });
  if (input.remember === true) {
    const { resource } = await ownedResource(ctx, owner, params.id, 'wallet');
    await ctx.admin.from('agent_id_resources').update({ settings: { ...resource.settings, withdrawTo: to } }).eq('id', resource.id);
  }
  return result;
};

const EVENT_KINDS = ['mail', 'sms', 'call', 'wallet', 'card', 'vm'];
const agentEvents: Handler = async (ctx, owner, input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  const kinds = input.kind ? String(input.kind).split(',').filter(kind => EVENT_KINDS.includes(kind)) : EVENT_KINDS;
  if (!kinds.length) throw fail(400, 'invalid', `kind is one of ${EVENT_KINDS.join(', ')}.`);
  // Bank payouts take a day or two: look how they're doing.
  if (kinds.includes('wallet')) await refreshPayouts(ctx, agent.id).catch(error => console.error('[agent-id] payouts', (error as Error).message));
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

// --- Phone number early access ----------------------------------------------------
// Until live numbers open, an owner applies for one per agent: what it's for,
// texts and/or calls, and the country.
const USES = ['sms', 'calls'];
const phoneApplicationView = (row: any) => row ? { status: row.status, useCase: row.use_case, country: row.country, uses: row.uses || USES, createdAt: row.created_at } : null;
const phoneApplication: Handler = async (ctx, owner, _input, params) => {
  const agent = await ownedAgent(ctx, owner, params.id);
  return { application: phoneApplicationView(checked(await ctx.admin.from('agent_id_phone_applications').select('*').eq('agent_id', agent.id).maybeSingle())) };
};
const applyForPhone: Handler = async (ctx, owner, input, params) => {
  const agent = activeAgent(await ownedAgent(ctx, owner, params.id));
  const country = input.country ? str(input.country, 2, 'country').toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw fail(400, 'invalid', 'country is a two-letter country code.');
  const uses: string[] | null = input.uses === undefined ? USES : Array.isArray(input.uses) ? [...new Set((input.uses as unknown[]).map(String))] : null;
  if (!uses || !uses.length || uses.some(use => !USES.includes(use))) throw fail(400, 'invalid', 'uses lists sms, calls or both.');
  const row = checked(await ctx.admin.from('agent_id_phone_applications').upsert({
    agent_id: agent.id, owner_user_id: owner.userId, status: 'submitted',
    use_case: str(input.useCase, 1000, 'useCase', { required: true, multiline: true }),
    country, uses, updated_at: iso(ctx),
  }, { onConflict: 'agent_id' }).select('*').single());
  await audit(ctx, owner.userId, agent.id, 'owner', 'phone.apply', { country, uses });
  return { application: phoneApplicationView(row) };
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
  ['POST', '/v1/account/terms', acceptTerms],
  ...vaultOwnerRoutes,
  ['POST', '/v1/account/credits', buyCredits],
  ['GET', '/v1/agents', listAgents], ['POST', '/v1/agents', createAgent],
  ['GET', '/v1/recipients', lookupRecipient],
  ['GET', '/v1/agents/:id', getAgent], ['PATCH', '/v1/agents/:id', updateAgent], ['DELETE', '/v1/agents/:id', revokeAgent],
  ['POST', '/v1/agents/:id/keys', createAgentKey], ['DELETE', '/v1/agents/:id/keys/:keyId', revokeAgentKey],
  ['POST', '/v1/agents/:id/resources', provision], ['PATCH', '/v1/agents/:id/resources/:kind', updateResource], ['DELETE', '/v1/agents/:id/resources/:kind', removeResource],
  ['POST', '/v1/agents/:id/wallet/test-funds', testFunds],
  ['GET', '/v1/agents/:id/wallet/add-money', addMoneyInfo], ['POST', '/v1/agents/:id/wallet/add-money', addMoneyByCard],
  ['POST', '/v1/agents/:id/wallet/withdraw', withdrawMoney],
  ['POST', '/v1/agents/:id/wallet/bank-deposit', async (ctx, owner, input, params) => bankDeposit(ctx, owner, activeAgent(await ownedAgent(ctx, owner, params.id)), input)],
  ['GET', '/v1/agents/:id/wallet/bank-payins', async (ctx, owner, _input, params) => bankPayins(ctx, owner, await ownedAgent(ctx, owner, params.id))],
  ['POST', '/v1/agents/:id/wallet/bank-payins', async (ctx, owner, input, params) => startBankPayin(ctx, owner, activeAgent(await ownedAgent(ctx, owner, params.id)), input)],
  ['DELETE', '/v1/agents/:id/wallet/bank-payins/:payinId', async (ctx, owner, _input, params) => cancelBankPayin(ctx, owner, await ownedAgent(ctx, owner, params.id), params.payinId)],
  ['GET', '/v1/account/bank', (ctx, owner) => bankStatus(ctx, owner)],
  ['POST', '/v1/account/bank/verify', (ctx, owner) => startBankVerification(ctx, owner)],
  ['POST', '/v1/account/bank/accounts', (ctx, owner, input) => addBankAccount(ctx, owner, input)],
  ['DELETE', '/v1/account/bank/accounts/:accountId', (ctx, owner, _input, params) => removeBankAccount(ctx, owner, params.accountId)],
  ['POST', '/v1/account/verification/document', (ctx, owner, input, _params, req) => uploadBusinessDocument(ctx, owner, req, String(input.organization || new URL(req.url).searchParams.get('organization') || ''))],
  ['GET', '/v1/agents/:id/events', agentEvents], ['GET', '/v1/agents/:id/contacts', agentContacts],
  ['GET', '/v1/agents/:id/card-application', cardApplication], ['POST', '/v1/agents/:id/card-application', applyForCard],
  ['GET', '/v1/agents/:id/phone-application', phoneApplication], ['POST', '/v1/agents/:id/phone-application', applyForPhone],
  ['GET', '/v1/approvals', listApprovals], ['POST', '/v1/approvals/:id', decideApproval],
  ['GET', '/v1/audit', auditLog],
  ['GET', '/v1/keys', listOwnerKeys], ['POST', '/v1/keys', createOwnerKey], ['DELETE', '/v1/keys/:keyId', revokeOwnerKey],
  ['GET', '/v1/relying-parties', listRelyingParties], ['POST', '/v1/relying-parties', createRelyingParty],
  ['PATCH', '/v1/relying-parties/:rpId', updateRelyingParty], ['DELETE', '/v1/relying-parties/:rpId', revokeRelyingParty],
  ['POST', '/v1/relying-parties/:rpId/secret', rotateRelyingPartySecret],
  ['GET', '/v1/reviews', (ctx, owner) => listReviews(ctx, owner)],
  ['GET', '/v1/reviews/business/:id/document', (ctx, owner, _input, params) => reviewDocument(ctx, owner, params.id)],
  ['POST', '/v1/reviews/:kind/:id', (ctx, owner, input, params) => decideReview(ctx, owner, params.kind, params.id, input)],
];
