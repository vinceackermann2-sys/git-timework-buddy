// Where an agent comes from: the app it runs in. The owner or the CLI's
// `attach` names it; the MCP client the agent connects with names itself too,
// which fills it in for agents nobody labelled.
import { fail, str } from './util.ts';
import type { Ctx } from './context.ts';

export const APPS: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', claude: 'Claude', codex: 'Codex', chatgpt: 'ChatGPT',
  cursor: 'Cursor', windsurf: 'Windsurf', cline: 'Cline', roo: 'Roo Code', continue: 'Continue', gemini: 'Gemini',
  kiro: 'Kiro', qwen: 'Qwen Code', copilot: 'GitHub Copilot', factory: 'Factory', kilocode: 'Kilo Code', augment: 'Augment',
  opencode: 'OpenCode', zed: 'Zed', junie: 'Junie', 'amazon-q': 'Amazon Q', openclaw: 'OpenClaw', grok: 'Grok', hermes: 'Hermes',
  moltbot: 'Moltbot', timewarp: 'Timewarp', energy: 'Energy', strawberry: 'Strawberry', custom: 'Custom agent',
  // Older values.
  any: 'Any app', other: 'Other app',
};

// MCP clients' own names (clientInfo.name), as they send them, to apps.
const CLIENTS: [RegExp, string][] = [
  [/^claude-code/i, 'claude-code'], [/^claude-ai|claude desktop/i, 'claude-desktop'], [/codex/i, 'codex'], [/chatgpt|openai/i, 'chatgpt'],
  [/cursor/i, 'cursor'], [/windsurf|codeium/i, 'windsurf'], [/^cline/i, 'cline'], [/roo/i, 'roo'], [/continue/i, 'continue'],
  [/gemini/i, 'gemini'], [/kiro/i, 'kiro'], [/qwen/i, 'qwen'], [/copilot|visual studio code|vscode/i, 'copilot'], [/factory|droid/i, 'factory'],
  [/kilo/i, 'kilocode'], [/augment/i, 'augment'], [/opencode/i, 'opencode'], [/^zed/i, 'zed'], [/junie/i, 'junie'], [/amazon ?q|q-developer/i, 'amazon-q'],
  [/openclaw/i, 'openclaw'], [/grok/i, 'grok'], [/hermes/i, 'hermes'], [/moltbot/i, 'moltbot'], [/timewarp/i, 'timewarp'], [/strawberry/i, 'strawberry'],
];
export const appOfClient = (name: string) => CLIENTS.find(([pattern]) => pattern.test(name))?.[1] || null;

export function appOf(value: unknown, field = 'origin.app') {
  const app = str(value, 40, field, { required: true }).toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(app)) throw fail(400, 'invalid', `${field} is a short name like claude-code, codex, cursor or custom.`);
  return app;
}

// The fields an owner's input sets: `origin: { app, detail }`, or the older `runtime`.
export function originInput(input: any) {
  const patch: Record<string, unknown> = {};
  if (input?.origin !== undefined && input.origin !== null) {
    if (typeof input.origin !== 'object' || Array.isArray(input.origin)) throw fail(400, 'invalid', 'origin is { app, detail }.');
    if (input.origin.app !== undefined) patch.runtime = appOf(input.origin.app);
    if (input.origin.detail !== undefined) patch.origin_detail = input.origin.detail ? str(input.origin.detail, 200, 'origin.detail') : null;
  } else if (input?.runtime !== undefined) patch.runtime = appOf(input.runtime, 'runtime');
  return patch;
}

export function originView(agent: { runtime: string; origin_detail?: string | null; client_name?: string | null; client_version?: string | null; client_seen_at?: string | null }) {
  const app = agent.runtime || 'custom';
  return {
    app, label: APPS[app] || app.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    detail: agent.origin_detail || null,
    client: agent.client_name ? { name: agent.client_name, version: agent.client_version || null, seenAt: agent.client_seen_at || null } : null,
  };
}

// The apps one Agent ID is used in (agent_id_agent_clients): each one that
// connected or was set up, most recent first. The app the agent was made for
// counts too.
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const appForClient = (name: string) => appOfClient(name) || slug(name) || 'custom';

export async function recordApp(ctx: Ctx, agentId: string, app: string, client: { name?: string | null; version?: string | null } = {}) {
  if (!/^[a-z0-9-]{1,40}$/.test(app)) return;
  await ctx.admin.from('agent_id_agent_clients').upsert({
    agent_id: agentId, app, last_seen_at: new Date(ctx.now()).toISOString(),
    ...(client.name ? { client_name: client.name.slice(0, 100) } : {}), ...(client.version ? { client_version: client.version.slice(0, 40) } : {}),
  }, { onConflict: 'agent_id,app' });
}

// The model an agent says it is ("claude-opus-5-5", "gpt-6"…), as given.
export function modelOf(value: unknown) {
  const model = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.:/_-]/g, '').slice(0, 80);
  return model.length >= 2 ? model : null;
}

// Remembered for the app it runs in: the latest, and the list of all (up to 20).
export async function recordModel(ctx: Ctx, agentId: string, app: string | null, model: string) {
  if (!app) return;
  const row = (await ctx.admin.from('agent_id_agent_clients').select('models').eq('agent_id', agentId).eq('app', app).maybeSingle()).data as any;
  const models = [model, ...((row?.models as string[]) || []).filter(m => m !== model)].slice(0, 20);
  await ctx.admin.from('agent_id_agent_clients').upsert({ agent_id: agentId, app, model, models, last_seen_at: new Date(ctx.now()).toISOString() }, { onConflict: 'agent_id,app' });
}

export async function appsOf(ctx: Ctx, agentIds: string[]) {
  const map = new Map<string, any[]>();
  if (!agentIds.length) return map;
  const { data, error } = await ctx.admin.from('agent_id_agent_clients').select('*').in('agent_id', agentIds).order('last_seen_at', { ascending: false });
  if (error) return map;
  for (const row of data || []) map.set(row.agent_id, [...(map.get(row.agent_id) || []), row]);
  return map;
}

export function appsView(agent: { runtime: string; created_at?: string }, rows: any[] = []) {
  const label = (app: string) => APPS[app] || app.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const list = rows.map(row => ({
    app: row.app, label: label(row.app), clientName: row.client_name || null, lastSeenAt: row.last_seen_at, firstSeenAt: row.first_seen_at,
    // The model it last ran with in this app, and every one it has.
    model: row.model || null, models: Array.isArray(row.models) ? row.models : [],
  }));
  if (agent.runtime && !['custom', 'any', 'other'].includes(agent.runtime) && !list.some(item => item.app === agent.runtime)) {
    list.push({ app: agent.runtime, label: label(agent.runtime), clientName: null, lastSeenAt: null, firstSeenAt: agent.created_at || null, model: null, models: [] });
  }
  return list;
}
