// An agent's connected apps (Gmail, Slack, Notion…): the accounts its owner
// connected in Timewarp, through Composio, that the owner lets this agent
// use. The agent uses them wherever it runs (Claude Code, Codex, Cursor) with
// these routes and the MCP tools, as it does inside Timewarp.
//
// Which accounts an agent may use is the setting Timewarp keeps for its agent:
// the account's 'connector-access' item (timewarp_energy_account_data, synced
// from the app), keyed by the Timewarp agent's id; no item there means all of
// the owner's accounts, as in Timewarp. An Agent ID made outside Timewarp keeps
// its own item under its agt_ id, and starts with none.
import { checked, fail, str } from './util.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx } from './context.ts';
import { audit, rateLimit } from './shared.ts';

type Op = (ctx: Ctx, who: AgentCaller, input: any) => Promise<unknown>;

// --- Composio ------------------------------------------------------------------------
const composioOf = (ctx: Ctx) => {
  const key = ctx.config.env('COMPOSIO_API_KEY');
  if (!key) throw fail(503, 'connectors_unavailable', 'Connected apps are not available on this Agent ID yet.');
  return { key, base: (ctx.config.env('COMPOSIO_API_BASE') || 'https://backend.composio.dev/api/v3.1').replace(/\/+$/, ''), version: ctx.config.env('COMPOSIO_TOOL_VERSION') || 'latest' };
};
async function composio(ctx: Ctx, path: string, init: { method?: string; body?: unknown } = {}) {
  const { key, base } = composioOf(ctx);
  const response = await ctx.fetch(`${base}${path}`, {
    method: init.method || 'GET',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body };
}
const items = (body: any): any[] => Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.data) ? body.data : [];
const toolkitOf = (record: any) => String(record?.toolkit?.slug || record?.toolkit_slug || record?.app_name || record?.appName || '').toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Who an account signs in as, when Composio's record says.
const labelOf = (record: any) => [record?.data?.email, record?.params?.email, record?.state?.val?.email, record?.member?.email, record?.alias]
  .map(value => typeof value === 'string' ? value.trim() : '').find(value => value && (EMAIL.test(value) || value.length <= 80)) || null;

// The names apps go by; others are their slug in title case.
const APPS: Record<string, string> = { gmail: 'Gmail', googlecalendar: 'Google Calendar', googledrive: 'Google Drive', googledocs: 'Google Docs', googlesheets: 'Google Sheets', outlook: 'Outlook', slack: 'Slack', notion: 'Notion', github: 'GitHub', linear: 'Linear', hubspot: 'HubSpot', jira: 'Jira', asana: 'Asana', trello: 'Trello', airtable: 'Airtable', dropbox: 'Dropbox', discord: 'Discord', linkedin: 'LinkedIn', twitter: 'X', salesforce: 'Salesforce', zoom: 'Zoom', shopify: 'Shopify', stripe: 'Stripe', figma: 'Figma', calendly: 'Calendly', microsoftteams: 'Microsoft Teams', onedrive: 'OneDrive' };
const appName = (toolkit: string) => APPS[toolkit] || toolkit.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// Timewarp's name for an app in an agent's access list (desktop/composio.cjs).
const integrationId = (toolkit: string) => 'composio-' + toolkit.toLowerCase().replace(/[^a-z0-9]+/g, '-');

type Connection = { id: string; toolkit: string; app: string; label: string | null; authConfigId: string | null };
// The owner's working connected accounts. Personal ones: Composio's user is
// the Timewarp user id (as the app's connectors use).
async function ownerConnections(ctx: Ctx, userId: string): Promise<Connection[]> {
  const params = new URLSearchParams({ user_ids: userId, statuses: 'ACTIVE', limit: '100' });
  const { ok, status, body } = await composio(ctx, `/connected_accounts?${params}`);
  if (!ok) throw fail(502, 'connectors_unreachable', `Connected apps can't be reached right now (HTTP ${status}).`);
  return items(body)
    .filter(record => String(record?.status || '').toUpperCase() === 'ACTIVE' && (!record?.user_id || record.user_id === userId))
    .map(record => ({ id: String(record.id || record.nanoid || ''), toolkit: toolkitOf(record), authConfigId: record?.auth_config?.id ? String(record.auth_config.id) : record?.auth_config_id ? String(record.auth_config_id) : null, label: labelOf(record) }))
    .filter(connection => connection.id && connection.toolkit)
    .map(connection => ({ ...connection, app: appName(connection.toolkit) }));
}

// --- Which accounts an agent may use --------------------------------------------------
const accessKey = (agent: AgentRow) => agent.desktop_agent_id || agent.id;
async function accessRow(ctx: Ctx, agent: AgentRow) {
  return checked(await ctx.admin.from('timewarp_energy_account_data').select('value,revision').eq('user_id', agent.owner_user_id).eq('kind', 'connector-access').eq('key', accessKey(agent)).maybeSingle()) as { value: any; revision: number } | null;
}
// all: every account the owner connected (a Timewarp agent's default).
async function accessOf(ctx: Ctx, agent: AgentRow) {
  const row = await accessRow(ctx, agent);
  const list = row?.value?.items;
  if (Array.isArray(list)) return { all: false, accounts: new Set(list.filter((item: any) => item?.kind === 'integration').map((item: any) => String(item.accountId))) };
  if (row?.value && list === null) return { all: true, accounts: new Set<string>() };
  return agent.desktop_agent_id ? { all: true, accounts: new Set<string>() } : { all: false, accounts: new Set<string>() };
}
async function allowedConnections(ctx: Ctx, agent: AgentRow) {
  const [connections, access] = await Promise.all([ownerConnections(ctx, agent.owner_user_id), accessOf(ctx, agent)]);
  return connections.filter(connection => access.all || access.accounts.has(connection.id));
}
const connectionView = ({ authConfigId: _config, ...connection }: Connection) => connection;

// --- Owner ------------------------------------------------------------------------------
async function ownerAgent(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', agentId).eq('owner_user_id', owner.userId).maybeSingle()) as AgentRow | null;
  if (!agent) throw fail(404, 'not_found', 'No agent with that id.');
  return agent;
}

export async function agentConnectors(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = await ownerAgent(ctx, owner, agentId);
  const [connections, access] = await Promise.all([ownerConnections(ctx, owner.userId), accessOf(ctx, agent)]);
  return {
    all: access.all,
    // Set in Timewarp for its agent: changes here change it there too.
    timewarp: !!agent.desktop_agent_id,
    connectors: connections.map(connection => ({ ...connectionView(connection), allowed: access.all || access.accounts.has(connection.id) })),
  };
}

// { all: true } or { connections: [ids] }: written as Timewarp writes it, so the
// app takes it at its next sync (and a change made there meanwhile wins over
// nothing: the write is refused and tried once more on top of it).
async function setConnectors(ctx: Ctx, owner: Owner, agentId: string, input: any) {
  const agent = await ownerAgent(ctx, owner, agentId);
  if (agent.status === 'revoked') throw fail(409, 'agent_revoked', 'This agent has been revoked.');
  let value: { items: unknown[] | null };
  if (input.all === true) value = { items: null };
  else {
    if (!Array.isArray(input.connections) || input.connections.length > 100) throw fail(400, 'invalid', 'connections is a list of connected account ids, or all is true.');
    const owned = new Map((await ownerConnections(ctx, owner.userId)).map(connection => [connection.id, connection]));
    const ids = [...new Set(input.connections.map((id: unknown) => str(id, 100, 'connections')))] as string[];
    for (const id of ids) if (!owned.has(id)) throw fail(403, 'not_owned', 'Choose working connected accounts that you own.');
    value = { items: ids.map(id => ({ kind: 'integration', integrationId: integrationId(owned.get(id)!.toolkit), accountId: id, owner: 'user' })) };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = (await accessRow(ctx, agent))?.revision ?? 0;
    const results = checked(await ctx.admin.rpc('timewarp_energy_put_account_data', { p_user: owner.userId, p_items: [{ kind: 'connector-access', key: accessKey(agent), value, base }] })) as any[];
    if (results?.[0]?.revision && !results[0].conflict) {
      await audit(ctx, owner.userId, agent.id, 'owner', 'connectors.update', { all: value.items === null, count: value.items?.length ?? null });
      return agentConnectors(ctx, owner, agentId);
    }
    if (results?.[0]?.error) throw fail(409, 'full', 'This account has too much synced data to save this.');
  }
  throw fail(409, 'changed', 'These apps were just changed elsewhere. Look again and retry.');
}

export const connectorOwnerRoutes: Route<Owner>[] = [
  ['GET', '/v1/agents/:id/connectors', (ctx, owner, _input, params) => agentConnectors(ctx, owner, params.id)],
  ['PUT', '/v1/agents/:id/connectors', (ctx, owner, input, params) => setConnectors(ctx, owner, params.id, input)],
];

// --- The agent ----------------------------------------------------------------------------
const actor = (who: AgentCaller) => who.via === 'owner' ? 'owner' as const : 'agent' as const;

const connectorsList: Op = async (ctx, who) => ({ connectors: (await allowedConnections(ctx, who.agent)).map(connectionView) });

// The actions an app offers (with their arguments), optionally matching a query.
const connectorTools: Op = async (ctx, who, input) => {
  const toolkit = str(input.app, 60, 'app', { required: true }).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const accounts = (await allowedConnections(ctx, who.agent)).filter(connection => connection.toolkit === toolkit);
  if (!accounts.length) throw fail(404, 'no_connector', `You can't use ${appName(toolkit)}: your owner hasn't connected it for you.`);
  const params = new URLSearchParams({ toolkit_slug: toolkit, toolkit_versions: composioOf(ctx).version, limit: String(Math.max(1, Math.min(30, Number(input.limit) || 12))) });
  const query = str(input.query, 200, 'query');
  if (query) params.set('query', query);
  const configs = [...new Set(accounts.map(account => account.authConfigId).filter(Boolean))];
  if (configs.length) params.set('auth_config_ids', configs.join(','));
  const { ok, status, body } = await composio(ctx, `/tools?${params}`);
  if (!ok) throw fail(502, 'connectors_unreachable', `${appName(toolkit)}'s actions can't be listed right now (HTTP ${status}).`);
  return {
    connections: accounts.map(connectionView),
    tools: items(body).map(tool => ({ slug: String(tool?.slug || ''), name: String(tool?.name || tool?.slug || ''), description: String(tool?.description || '').slice(0, 1000), parameters: tool?.input_parameters || tool?.inputParameters || { type: 'object' } })).filter(tool => /^[A-Z0-9_]{1,200}$/.test(tool.slug)),
  };
};

// Runs one action with one of the agent's accounts.
const connectorRun: Op = async (ctx, who, input) => {
  const slug = str(input.tool, 200, 'tool', { required: true });
  if (!/^[A-Z0-9_]{1,200}$/.test(slug)) throw fail(400, 'invalid', 'tool is an action slug from connector_tools, like GMAIL_SEND_EMAIL.');
  const accounts = await allowedConnections(ctx, who.agent);
  const id = input.connection ? str(input.connection, 100, 'connection') : null;
  const prefix = slug.split('_')[0].toLowerCase();
  const account = id ? accounts.find(item => item.id === id) : accounts.find(item => item.toolkit.replace(/[^a-z0-9]/g, '').startsWith(prefix) || prefix.startsWith(item.toolkit.replace(/[^a-z0-9]/g, '')));
  if (!account) throw fail(403, 'no_connector', id ? 'That connected account isn\'t one you may use.' : `You have no connected app for ${slug}.`);
  const app = account.toolkit.replace(/[^a-z0-9]/g, '');
  if (!(app.startsWith(prefix) || prefix.startsWith(app))) throw fail(400, 'invalid', `${slug} isn't an action of ${account.app}.`);
  if (input.arguments !== undefined && (typeof input.arguments !== 'object' || input.arguments === null || Array.isArray(input.arguments))) throw fail(400, 'invalid', 'arguments is an object, as connector_tools describes it.');
  await rateLimit(ctx, who.userId, `connectors:${who.agent.id}`, 30, 600, 'connected app actions');
  const { ok, status, body } = await composio(ctx, `/tools/execute/${encodeURIComponent(slug)}`, { method: 'POST', body: { user_id: who.agent.owner_user_id, connected_account_id: account.id, arguments: input.arguments || {}, version: composioOf(ctx).version } });
  const data = body?.data ?? body;
  const error = [body?.error, data?.error, body?.message].map(value => typeof value === 'string' ? value : value?.message).find(Boolean) || null;
  await audit(ctx, who.userId, who.agent.id, actor(who), 'connector.run', { app: account.toolkit, tool: slug, ok: ok && body?.successful !== false && !error });
  if (!ok) throw fail(502, 'connector_failed', error || `${account.app} refused the action (HTTP ${status}).`);
  const failed = body?.successful === false || body?.success === false || !!error;
  return { successful: !failed, app: account.app, data, error: failed ? error || `${account.app} rejected the action. Check its arguments.` : null };
};

export const connectorOps: Record<string, Op> = { connectorsList, connectorTools, connectorRun };
export const connectorAgentRoutes: Route<AgentCaller>[] = [
  ['GET', '/v1/me/connectors', (ctx, who) => connectorsList(ctx, who, {})],
  ['GET', '/v1/me/connectors/tools', (ctx, who, input) => connectorTools(ctx, who, input)],
  ['POST', '/v1/me/connectors/run', (ctx, who, input) => connectorRun(ctx, who, input)],
];
