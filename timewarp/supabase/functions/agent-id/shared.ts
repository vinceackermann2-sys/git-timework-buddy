// What owner and agent routes both need: how things are shown, the audit
// log, plans and rate limits, and how verified an agent's owner is.
import { checked, fail, money } from './util.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import type { Kind } from './config.ts';
import { appsView, originView } from './origin.ts';

// The service's own stored values (agent_id_settings), such as the signing
// secrets of webhooks it registered itself.
export async function setting(ctx: Ctx, key: string) {
  const { data, error } = await ctx.admin.from('agent_id_settings').select('value').eq('key', key).maybeSingle();
  return error ? null : (data?.value ?? null);
}
export async function putSetting(ctx: Ctx, key: string, value: unknown) {
  checked(await ctx.admin.from('agent_id_settings').upsert({ key, value, updated_at: new Date(ctx.now()).toISOString() }, { onConflict: 'key' }).select('key'));
}

export async function audit(ctx: Ctx, ownerId: string, agentId: string | null, actor: 'owner' | 'agent' | 'system' | 'provider' | 'relying_party', action: string, detail: Record<string, unknown> = {}, { required = false } = {}) {
  const { error } = await ctx.admin.from('agent_id_audit').insert({ owner_user_id: ownerId, agent_id: agentId, actor, action, detail });
  if (error) {
    console.error('[agent-id] audit failed', action, error.message);
    if (required) throw fail(503, 'unavailable', 'Agent ID could not record this action, so it was not done.');
  }
}

// Per-account counters in the shared rate-limit table. Cost protection, so a
// missing counter lets the request through.
export async function rateLimit(ctx: Ctx, userId: string, kind: string, perMinute: number, perDay: number, label: string) {
  try {
    const { data, error } = await ctx.admin.rpc('timewarp_consume_rate_limit', { p_user_id: userId, p_kind: `agent-id:${kind}`, p_max_per_minute: perMinute, p_max_per_day: perDay });
    if (!error && data && data.allowed === false) throw fail(429, 'rate_limited', `Too many ${label} right now. Try again ${data.limit === 'day' ? 'tomorrow' : 'in a minute'}.`, { retryAfterSeconds: Number(data.retry_after_seconds) || 60 });
  } catch (error) {
    if ((error as any)?.status === 429) throw error;
  }
}

export async function planOf(ctx: Ctx, userId: string) {
  const { data, error } = await ctx.admin.rpc('timewarp_ai_usage', { p_user_id: userId, p_workspace_id: null });
  if (error) return 'free';
  return String(data?.plan || 'free').toLowerCase();
}

export async function personOf(ctx: Ctx, userId: string) {
  return checked(await ctx.admin.from('agent_id_people').select('*').eq('user_id', userId).maybeSingle()) as any;
}
export async function businessOf(ctx: Ctx, workspaceId: string | null) {
  if (!workspaceId) return null;
  return checked(await ctx.admin.from('agent_id_businesses').select('*').eq('workspace_id', workspaceId).maybeSingle()) as any;
}

// How an agent's owner is verified right now: a verified business (KYB) for
// an organization's agent, else a verified person (KYC), else none. An
// agent counts as its organization's only while its owner is still an active
// member: someone who leaves takes no company standing (or Git rights) along.
export async function verificationOf(ctx: Ctx, agent: Pick<AgentRow, 'owner_user_id' | 'workspace_id'>) {
  const member = agent.workspace_id ? !!(await membership(ctx, agent.owner_user_id, agent.workspace_id)) : false;
  const organizationId = member ? agent.workspace_id : null;
  const [person, business] = await Promise.all([personOf(ctx, agent.owner_user_id), businessOf(ctx, organizationId)]);
  const kyb = business?.status === 'verified', kyc = person?.status === 'verified';
  return {
    organizationId,
    level: kyb ? 'kyb' : kyc ? 'kyc' : 'none' as 'kyb' | 'kyc' | 'none',
    verified: kyb || kyc,
    person: kyc ? { country: person.country } : null,
    business: kyb ? { legalName: business.legal_name, country: business.country, registrationNumber: business.registration_number } : null,
  };
}

export async function organizationName(ctx: Ctx, workspaceId: string | null) {
  if (!workspaceId) return null;
  const row = checked(await ctx.admin.from('timewarp_workspaces').select('name').eq('id', workspaceId).maybeSingle()) as any;
  return row?.name || null;
}

export async function membership(ctx: Ctx, userId: string, workspaceId: string) {
  const row = checked(await ctx.admin.from('timewarp_workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle()) as any;
  return row?.role as string | undefined;
}

export const principalOf = (ctx: Ctx, agent: AgentRow) => `${agent.id}@${ctx.config.principalDomain}`;

export function resourceView(row: ResourceRow) {
  // The card's code, and a test computer's vault key, are never shown.
  const { cvc: _cvc, testVault: _testVault, ...state } = row.state || {};
  return {
    id: row.id, kind: row.kind, mode: row.mode, provider: row.provider, status: row.status,
    address: row.address, label: row.label, settings: row.settings || {}, details: state,
    ...(row.kind === 'wallet' && row.mode === 'test' ? { balance: money(Number(row.balance_minor), row.currency) } : {}),
    currency: row.currency, createdAt: row.created_at,
  };
}

export async function resourcesOf(ctx: Ctx, agentIds: string[]) {
  if (!agentIds.length) return [] as ResourceRow[];
  return (checked(await ctx.admin.from('agent_id_resources').select('*').in('agent_id', agentIds).neq('status', 'released')) || []) as ResourceRow[];
}

// apps: from appsOf(), the apps this Agent ID is used in.
// Every agent's face is one of Timewarp's mascots: the one its owner picked,
// else one that follows from its id (or its claim's code), so it never changes.
export const MASCOTS = ['orbit', 'nova', 'cosmo'] as const;
export function mascotOf(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MASCOTS[hash % MASCOTS.length];
}

export function agentView(ctx: Ctx, agent: AgentRow, resources: ResourceRow[] = [], apps?: Map<string, any[]>) {
  return {
    id: agent.id, name: agent.name, handle: agent.handle, mascot: agent.mascot || mascotOf(agent.id), runtime: agent.runtime, origin: originView(agent), apps: appsView(agent, apps?.get(agent.id)), status: agent.status,
    organizationId: agent.workspace_id, desktopAgentId: agent.desktop_agent_id,
    gitPrincipal: principalOf(ctx, agent),
    createdAt: agent.created_at, lastSeenAt: agent.last_seen_at,
    resources: Object.fromEntries(resources.filter(r => r.agent_id === agent.id).map(r => [r.kind, resourceView(r)])),
  };
}

export function eventView(row: any) {
  return {
    id: row.id, kind: row.kind, direction: row.direction, status: row.status,
    counterparty: row.counterparty, subject: row.subject, text: row.body,
    amount: money(row.amount_minor === null ? null : Number(row.amount_minor), row.currency),
    thread: row.thread, data: row.data || {}, read: !!row.read_at, at: row.occurred_at, ...(row.kind === 'mail' ? { folder: row.folder } : {}),
  };
}

export async function resourceFor(ctx: Ctx, agentId: string, kind: Kind, { required = true } = {}) {
  const row = checked(await ctx.admin.from('agent_id_resources').select('*').eq('agent_id', agentId).eq('kind', kind).neq('status', 'released').maybeSingle()) as ResourceRow | null;
  const names: Record<Kind, string> = { mail: 'a mail inbox', phone: 'a phone number', wallet: 'a wallet', card: 'a card', vm: 'a virtual machine' };
  if (!row && required) throw fail(404, `no_${kind}`, `This agent doesn't have ${names[kind]} yet. Its owner can add one in Agent ID.`);
  if (row && required && row.status === 'suspended') throw fail(403, `${kind}_suspended`, `This agent's ${kind === 'vm' ? 'machine' : kind} is paused by its owner.`);
  return row as ResourceRow;
}

// A page of events, newest first.
export async function listEvents(ctx: Ctx, agentId: string, kinds: string[], input: { before?: string; limit?: string | number; direction?: string; unread?: string | boolean }) {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 25));
  let query = ctx.admin.from('agent_id_events').select('*').eq('agent_id', agentId).in('kind', kinds);
  if (input.direction === 'in' || input.direction === 'out') query = query.eq('direction', input.direction);
  if (input.unread === true || input.unread === 'true' || input.unread === '1') query = query.is('read_at', null);
  if (input.before && !Number.isNaN(Date.parse(String(input.before)))) query = query.lt('occurred_at', new Date(String(input.before)).toISOString());
  const rows = (checked(await query.order('occurred_at', { ascending: false }).limit(limit + 1)) || []) as any[];
  return { events: rows.slice(0, limit).map(eventView), more: rows.length > limit };
}
