// Giving an agent its resources: the checks (live provider set up, a verified
// owner, a paid plan), the agent's one slot for each kind, then the provider.
// One at a time from the dashboard ("Add mail"), or all at once for a new
// Agent ID, so it can mail, call, pay and compute the moment it exists.
import { checked, fail, int, str } from './util.ts';
import { KINDS, type Kind } from './config.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { audit, personOf, planOf, resourcesOf, resourceView, verificationOf } from './shared.ts';
import { provisionMail } from './providers/mail.ts';
import { provisionPhone } from './providers/phone.ts';
import { provisionWallet } from './providers/wallet.ts';
import { provisionCard } from './providers/card.ts';
import { provisionVm, SIZES, type Size } from './providers/vm.ts';

const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();
const NAMES: Record<Kind, string> = { mail: 'mail', phone: 'a phone number', wallet: 'a wallet', card: 'a card', vm: 'a machine' };

// --- Settings ----------------------------------------------------------------------
const money = (value: unknown, field: string) => value === null || value === '' ? undefined : int(value, field, { min: 0, max: 100_000_000_00 });
const categories = (value: unknown, field: string) => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw fail(400, 'invalid', `${field} must be a list of up to 50 merchant categories.`);
  return value.map(item => str(item, 80, field, { required: true }).toLowerCase());
};
// The settings an owner controls on each kind; amounts are in cents.
export function settingsFor(kind: Kind, input: any, current: Record<string, unknown> = {}) {
  const next: Record<string, unknown> = { ...current };
  const set = (key: string, value: unknown) => { if (value === undefined) return; if (value === null) delete next[key]; else next[key] = value; };
  const amounts = (keys: string[]) => { for (const key of keys) if (key in (input || {})) set(key, input[key] === null ? null : money(input[key], key)); };
  if (kind === 'wallet') {
    amounts(['perTransfer', 'daily', 'approvalAbove']);
    if ('withdrawTo' in (input || {})) {
      const to = input.withdrawTo === null || input.withdrawTo === '' ? null : str(input.withdrawTo, 100, 'withdrawTo');
      if (to && !/^0x[0-9a-fA-F]{40}$/.test(to)) throw fail(400, 'invalid', 'withdrawTo is an address that starts with 0x.');
      set('withdrawTo', to);
    }
  }
  if (kind === 'card') {
    amounts(['perTransaction', 'daily', 'monthly']);
    if ('blockedCategories' in (input || {})) set('blockedCategories', input.blockedCategories === null ? null : categories(input.blockedCategories, 'blockedCategories'));
    if ('allowedCategories' in (input || {})) set('allowedCategories', input.allowedCategories === null ? null : categories(input.allowedCategories, 'allowedCategories'));
  }
  if (kind === 'phone' && 'greeting' in (input || {})) set('greeting', input.greeting === null ? null : str(input.greeting, 300, 'greeting'));
  return next;
}
// New wallets and cards start with modest limits the owner can raise.
export const DEFAULTS: Partial<Record<Kind, Record<string, unknown>>> = {
  wallet: { perTransfer: 5000, daily: 10000, approvalAbove: 2500 },
  card: { perTransaction: 5000, daily: 10000, monthly: 50000 },
};

// --- Checks --------------------------------------------------------------------------
export async function gate(ctx: Ctx, userId: string, agent: AgentRow, kind: Kind) {
  if (!ctx.config.liveListed(kind)) throw fail(403, 'live_unavailable', `Live ${kind === 'vm' ? 'machines' : kind} isn't available yet.`);
  if (!ctx.config.isLive(kind)) throw fail(503, 'provider_unavailable', `Live ${kind === 'vm' ? 'machines are' : kind + ' is'} not set up on this deployment.`);
  if (ctx.config.verificationRequired(kind) && !(await verificationOf(ctx, agent)).verified) throw fail(403, 'verification_required', 'Verify your identity (or your organization) to give agents this for real.');
  if (ctx.config.paidPlanRequired(kind) && (await planOf(ctx, userId)) === 'free') throw fail(402, 'plan_required', `A live ${kind === 'phone' ? 'phone number' : kind} needs a paid Timewarp plan.`);
}

// In production everything given is real; test resources are for development.
export function modeFor(ctx: Ctx, requested?: unknown): 'live' | 'test' {
  const mode = requested === 'live' || requested === 'test' ? requested : ctx.config.testMode ? 'test' : 'live';
  if (mode === 'test' && !ctx.config.testMode) throw fail(403, 'test_mode_off', 'Test resources are only for development.');
  return mode;
}

// The agent's one slot for this kind, held while the provider works (a phone
// number's webhooks need its id).
async function reserve(ctx: Ctx, agent: AgentRow, kind: Kind, mode: 'live' | 'test', settings: Record<string, unknown>) {
  const { data, error } = await ctx.admin.from('agent_id_resources').insert({ agent_id: agent.id, owner_user_id: agent.owner_user_id, kind, provider: 'pending', mode, status: 'provisioning', settings }).select('*').single();
  if (error?.code === '23505') throw fail(409, 'already_has', `This agent already has ${NAMES[kind]}. Remove it first to get a new one.`);
  return checked({ data, error }) as ResourceRow;
}

// Asks the provider and fills the slot in; on failure the slot is freed.
async function fill(ctx: Ctx, agent: AgentRow, placeholder: ResourceRow, options: { billing?: any; currency?: string; country?: string; areaCode?: string; size?: string } = {}) {
  const { kind, mode, settings } = placeholder;
  try {
    let fields: Record<string, unknown>;
    if (kind === 'mail') { const r = await provisionMail(ctx, agent, mode); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, status: 'active' }; }
    else if (kind === 'phone') { const r = await provisionPhone(ctx, agent, placeholder.id, mode, options); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, status: 'active' }; }
    else if (kind === 'wallet') { const r = await provisionWallet(ctx, agent, mode, placeholder.id); fields = { provider: r.provider, address: r.address, label: r.label, provider_ref: r.providerRef, state: r.state, currency: r.currency, status: 'active' }; }
    else if (kind === 'card') {
      const person = await personOf(ctx, agent.owner_user_id);
      const { data } = await ctx.admin.auth.admin.getUserById(agent.owner_user_id);
      const r = await provisionCard(ctx, agent, mode, { person, email: data?.user?.email || '', billing: options.billing, currency: options.currency, settings });
      if (r.cardholder && r.cardholder !== person?.cardholder_ref) await ctx.admin.from('agent_id_people').update({ cardholder_ref: r.cardholder }).eq('user_id', agent.owner_user_id);
      fields = { provider: r.provider, label: r.label, provider_ref: r.providerRef, state: r.state, currency: r.currency, status: 'active' };
    }
    else { const r = await provisionVm(ctx, agent, mode, (options.size && options.size in SIZES ? options.size : 'medium') as Size); fields = { provider: r.provider, label: r.label, provider_ref: r.providerRef, state: r.state, status: r.status }; }
    return checked(await ctx.admin.from('agent_id_resources').update({ ...fields, updated_at: iso(ctx) }).eq('id', placeholder.id).select('*').single()) as ResourceRow;
  } catch (caught) {
    await ctx.admin.from('agent_id_resources').delete().eq('id', placeholder.id);
    throw caught;
  }
}

// One resource, now: the dashboard's "Add mail" and the CLI's --give.
export async function giveResource(ctx: Ctx, agent: AgentRow, kind: Kind, input: { mode?: unknown; settings?: unknown; options?: any } = {}) {
  const mode = modeFor(ctx, input.mode);
  if (mode === 'live') await gate(ctx, agent.owner_user_id, agent, kind);
  const placeholder = await reserve(ctx, agent, kind, mode, settingsFor(kind, input.settings || {}, DEFAULTS[kind] || {}));
  const row = await fill(ctx, agent, placeholder, input.options || {});
  await audit(ctx, agent.owner_user_id, agent.id, 'owner', 'resource.provision', { kind, mode, provider: row.provider });
  return row;
}

// What a new Agent ID comes with (AGENT_ID_AUTO_GIVE, and on paid plans
// AGENT_ID_AUTO_GIVE_PAID), or the kinds asked for (`resources: []` for none).
export async function kindsFor(ctx: Ctx, userId: string, requested?: unknown) {
  if (Array.isArray(requested)) {
    const kinds = requested.map(String);
    const wrong = kinds.find(kind => !KINDS.includes(kind as Kind));
    if (wrong) throw fail(400, 'invalid', `resources lists kinds from ${KINDS.join(', ')}, not "${wrong}".`);
    return [...new Set(kinds)] as Kind[];
  }
  if (requested !== undefined && requested !== null) throw fail(400, 'invalid', 'resources is a list of kinds, like ["mail", "wallet"].');
  const paid = ctx.config.autoGivePaid.length ? (await planOf(ctx, userId)) !== 'free' : false;
  return [...new Set([...ctx.config.autoGive, ...(paid ? ctx.config.autoGivePaid : [])])].filter(kind => KINDS.includes(kind as Kind)) as Kind[];
}

// Everything a new Agent ID gets, set up together. Each kind that can't be
// given right now (not set up here, owner not verified, free plan, card
// waitlist) is skipped with its reason, and never stops the agent being made.
// Providers answer in the background: the slots show as "provisioning" until
// they're ready, and one that fails is freed so the owner can add it later.
export async function autoGive(ctx: Ctx, agent: AgentRow, requested?: unknown) {
  const kinds = await kindsFor(ctx, agent.owner_user_id, requested);
  const given: Kind[] = [], skipped: { kind: Kind; code: string; message: string }[] = [], jobs: Promise<unknown>[] = [];
  for (const kind of kinds) {
    try {
      if (kind === 'card' && ctx.config.cardsWaitlist) throw fail(409, 'waitlist', 'Cards are an early-access application for now.');
      const mode = modeFor(ctx);
      if (mode === 'live') await gate(ctx, agent.owner_user_id, agent, kind);
      const placeholder = await reserve(ctx, agent, kind, mode, settingsFor(kind, {}, DEFAULTS[kind] || {}));
      given.push(kind);
      jobs.push(fill(ctx, agent, placeholder).then(
        row => audit(ctx, agent.owner_user_id, agent.id, 'system', 'resource.provision', { kind, mode, provider: row.provider, auto: true }),
        error => audit(ctx, agent.owner_user_id, agent.id, 'system', 'resource.auto_failed', { kind, mode, error: String((error as Error)?.message || error).slice(0, 300) }),
      ));
    } catch (error) {
      skipped.push({ kind, code: String((error as any)?.code || 'failed'), message: String((error as Error)?.message || 'Not available.') });
    }
  }
  if (jobs.length) ctx.background(Promise.allSettled(jobs));
  return { given, skipped, resources: (await resourcesOf(ctx, [agent.id])).map(resourceView) };
}
