// Where an agent comes from: the app it runs in. The owner or the CLI's
// `attach` names it; the MCP client the agent connects with names itself too,
// which fills it in for agents nobody labelled.
import { fail, str } from './util.ts';

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
