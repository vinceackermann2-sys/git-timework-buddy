// An agent's automations, as Timewarp runs them: Timewarp keeps them on the
// computer they were made on and runs them there, and sends what they are
// here after each change (agent_id_automations), so the agent's Agent ID shows
// them on the website. Pausing, resuming or running one from the website
// waits as a request (agent_id_automation_requests) until Timewarp picks it up
// and says how it went. The agent sees its own with automations_list.
import { checked, fail, str } from './util.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx } from './context.ts';
import { audit } from './shared.ts';

const ACTIONS = ['pause', 'resume', 'run'];
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();
const when = (value: unknown) => value && !Number.isNaN(Date.parse(String(value))) ? new Date(String(value)).toISOString() : null;

const view = (row: any) => ({
  id: row.id, name: row.name, schedule: row.schedule || {}, summary: row.summary || null, enabled: !!row.enabled,
  nextRunAt: row.next_run_at || null, lastRun: row.last_run || null, device: row.device || null, updatedAt: row.updated_at,
});
const requestView = (row: any) => ({ id: row.id, agentId: row.agent_id, automationId: row.automation_id, action: row.action, status: row.status, error: row.error || null, createdAt: row.created_at, doneAt: row.done_at || null });

async function ownerAgent(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', agentId).eq('owner_user_id', owner.userId).maybeSingle()) as AgentRow | null;
  if (!agent) throw fail(404, 'not_found', 'No agent with that id.');
  return agent;
}

async function listAutomations(ctx: Ctx, agent: AgentRow) {
  const [rows, pending] = await Promise.all([
    ctx.admin.from('agent_id_automations').select('*').eq('agent_id', agent.id).order('name'),
    ctx.admin.from('agent_id_automation_requests').select('*').eq('agent_id', agent.id).eq('status', 'pending').order('created_at'),
  ]);
  return { automations: ((checked(rows) || []) as any[]).map(view), pending: ((checked(pending) || []) as any[]).map(requestView) };
}

// What Timewarp has for the agent now, replacing what it sent before.
async function putAutomations(ctx: Ctx, owner: Owner, agentId: string, input: any) {
  const agent = await ownerAgent(ctx, owner, agentId);
  if (!Array.isArray(input.automations) || input.automations.length > 200) throw fail(400, 'invalid', 'automations is a list of at most 200.');
  const device = str(input.device, 100, 'device') || null;
  const rows = input.automations.map((item: any) => {
    if (!item || typeof item !== 'object') throw fail(400, 'invalid', 'Each automation is an object.');
    const schedule = item.schedule && typeof item.schedule === 'object' && !Array.isArray(item.schedule) ? item.schedule : {};
    if (JSON.stringify(schedule).length > 2000) throw fail(400, 'invalid', 'An automation\'s schedule is too large.');
    const last = item.lastRun && typeof item.lastRun === 'object' ? { status: str(item.lastRun.status, 40, 'lastRun.status') || null, at: when(item.lastRun.at) } : null;
    return {
      agent_id: agent.id, id: str(item.id, 100, 'id', { required: true }), owner_user_id: owner.userId, name: str(item.name, 200, 'name', { required: true }),
      schedule, summary: str(item.summary, 200, 'summary') || null, enabled: item.enabled !== false, next_run_at: when(item.nextRunAt), last_run: last, device, updated_at: iso(ctx),
    };
  });
  const ids = new Set(rows.map((row: any) => row.id));
  const existing = ((checked(await ctx.admin.from('agent_id_automations').select('id').eq('agent_id', agent.id)) || []) as any[]).map(row => row.id);
  const gone = existing.filter(id => !ids.has(id));
  if (gone.length) checked(await ctx.admin.from('agent_id_automations').delete().eq('agent_id', agent.id).in('id', gone).select('id'));
  if (rows.length) checked(await ctx.admin.from('agent_id_automations').upsert(rows, { onConflict: 'agent_id,id' }).select('id'));
  // Requests for automations that are gone can't be done any more.
  if (gone.length) await ctx.admin.from('agent_id_automation_requests').update({ status: 'failed', error: 'The automation was removed.', done_at: iso(ctx) }).eq('agent_id', agent.id).eq('status', 'pending').in('automation_id', gone);
  return listAutomations(ctx, agent);
}

// Pause, resume or run now, from the website: Timewarp does it when it picks it up.
async function requestAction(ctx: Ctx, owner: Owner, agentId: string, automationId: string, input: any) {
  const agent = await ownerAgent(ctx, owner, agentId);
  if (!ACTIONS.includes(input.action)) throw fail(400, 'invalid', 'action is pause, resume or run.');
  const automation = checked(await ctx.admin.from('agent_id_automations').select('id').eq('agent_id', agent.id).eq('id', automationId).maybeSingle());
  if (!automation) throw fail(404, 'not_found', 'No automation with that id.');
  const waiting = ((checked(await ctx.admin.from('agent_id_automation_requests').select('*').eq('agent_id', agent.id).eq('automation_id', automationId).eq('action', input.action).eq('status', 'pending')) || []) as any[])[0];
  const row = waiting || checked(await ctx.admin.from('agent_id_automation_requests').insert({ agent_id: agent.id, automation_id: automationId, owner_user_id: owner.userId, action: input.action }).select('*').single());
  if (!waiting) await audit(ctx, owner.userId, agent.id, 'owner', `automation.${input.action}`, { automation: automationId });
  return { request: requestView(row) };
}

// Timewarp: what waits for it, for all of the owner's agents, with the
// Timewarp agent each is for.
async function pendingRequests(ctx: Ctx, owner: Owner) {
  const rows = (checked(await ctx.admin.from('agent_id_automation_requests').select('*').eq('owner_user_id', owner.userId).eq('status', 'pending').order('created_at').limit(100)) || []) as any[];
  const ids = [...new Set(rows.map(row => row.agent_id))];
  const agents = ids.length ? (checked(await ctx.admin.from('agent_id_agents').select('id,desktop_agent_id').in('id', ids)) || []) as any[] : [];
  const desktop = new Map(agents.map(agent => [agent.id, agent.desktop_agent_id || null]));
  return { requests: rows.map(row => ({ ...requestView(row), desktopAgentId: desktop.get(row.agent_id) || null })) };
}
async function finishRequest(ctx: Ctx, owner: Owner, requestId: string, input: any) {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) throw fail(404, 'not_found', 'No request with that id.');
  if (!['done', 'failed'].includes(input.status)) throw fail(400, 'invalid', 'status is done or failed.');
  const rows = checked(await ctx.admin.from('agent_id_automation_requests').update({ status: input.status, error: input.status === 'failed' ? str(input.error, 500, 'error') || 'It could not be done.' : null, done_at: iso(ctx) })
    .eq('id', requestId).eq('owner_user_id', owner.userId).eq('status', 'pending').select('*')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No waiting request with that id.');
  return { request: requestView(rows[0]) };
}

export const automationOwnerRoutes: Route<Owner>[] = [
  ['GET', '/v1/agents/:id/automations', async (ctx, owner, _input, params) => listAutomations(ctx, await ownerAgent(ctx, owner, params.id))],
  ['PUT', '/v1/agents/:id/automations', (ctx, owner, input, params) => putAutomations(ctx, owner, params.id, input)],
  ['POST', '/v1/agents/:id/automations/:automationId/requests', (ctx, owner, input, params) => requestAction(ctx, owner, params.id, params.automationId, input)],
  ['GET', '/v1/automation-requests', (ctx, owner) => pendingRequests(ctx, owner)],
  ['POST', '/v1/automation-requests/:requestId', (ctx, owner, input, params) => finishRequest(ctx, owner, params.requestId, input)],
];

// The agent's own automations: what runs it, when.
const automationsList = async (ctx: Ctx, who: AgentCaller) => {
  const rows = (checked(await ctx.admin.from('agent_id_automations').select('*').eq('agent_id', who.agent.id).order('name')) || []) as any[];
  return { automations: rows.map(view) };
};
export const automationOps = { automationsList };
export const automationAgentRoutes: Route<AgentCaller>[] = [
  ['GET', '/v1/me/automations', (ctx, who) => automationsList(ctx, who)],
];
