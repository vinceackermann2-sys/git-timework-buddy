// Where an agent comes from (the app it lives in), as Agent ID records it:
// `origin: { app, detail }` on the agent, and `runtime` with the same slugs.
// A server that doesn't know them yet gets the older runtime values instead.
import { ApiError } from './errors.js';

// The apps Agent ID knows (it also takes any other short slug).
export const APPS = [
  'claude-code', 'claude-desktop', 'claude', 'codex', 'chatgpt', 'cursor', 'windsurf', 'cline', 'roo', 'continue',
  'gemini', 'kiro', 'qwen', 'copilot', 'factory', 'kilocode', 'augment', 'opencode', 'zed', 'junie', 'amazon-q',
  'openclaw', 'grok', 'hermes', 'moltbot', 'timewarp', 'energy', 'strawberry', 'custom',
];
export const LEGACY_RUNTIMES = ['any', 'timewarp', 'codex', 'claude', 'other'];

// The runtime an older server accepts for an app.
export function legacyRuntime(app) {
  if (LEGACY_RUNTIMES.includes(app)) return app;
  if (/^claude/.test(app)) return 'claude';
  if (app === 'codex' || app === 'chatgpt') return 'codex';
  if (app === 'timewarp' || app === 'energy') return 'timewarp';
  return 'other';
}

// The tool a command runs inside, when it says so.
export function hostTool(env = process.env) {
  if (env.TIMEWARP_ID_TOOL) return String(env.TIMEWARP_ID_TOOL).toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 40) || null;
  if (env.CLAUDECODE === '1') return 'claude-code';
  if (env.GEMINI_CLI === '1') return 'gemini';
  if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return 'codex';
  return null;
}

// An MCP client's clientInfo.name as an app slug, the way Agent ID maps it
// (or a cleaned-up name).
const CLIENTS = [
  [/^claude-code/i, 'claude-code'], [/^claude-ai|claude desktop/i, 'claude-desktop'], [/codex/i, 'codex'], [/chatgpt|openai/i, 'chatgpt'],
  [/cursor/i, 'cursor'], [/windsurf|codeium/i, 'windsurf'], [/^cline/i, 'cline'], [/roo/i, 'roo'], [/continue/i, 'continue'],
  [/gemini|antigravity/i, 'gemini'], [/kiro/i, 'kiro'], [/qwen/i, 'qwen'], [/copilot|visual studio code|vscode/i, 'copilot'], [/factory|droid/i, 'factory'],
  [/kilo/i, 'kilocode'], [/augment/i, 'augment'], [/opencode/i, 'opencode'], [/^zed/i, 'zed'], [/junie/i, 'junie'], [/amazon ?q|q-developer/i, 'amazon-q'],
  [/openclaw/i, 'openclaw'], [/grok/i, 'grok'], [/hermes/i, 'hermes'], [/moltbot/i, 'moltbot'], [/timewarp/i, 'timewarp'], [/strawberry/i, 'strawberry'],
];
export function appFromClient(name) {
  const value = String(name || '');
  for (const [pattern, app] of CLIENTS) if (pattern.test(value)) return app;
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || null;
}

const mentions = (error, field) => error instanceof ApiError && error.status === 400 && new RegExp(field, 'i').test(error.message);

// POST /v1/agents or PATCH /v1/agents/:id with origin and the new runtime,
// falling back to what an older server accepts.
export async function sendWithOrigin(send, body) {
  let attempt = { ...body };
  for (let tries = 0; tries < 3; tries++) {
    try { return await send(attempt); }
    catch (error) {
      if (attempt.runtime !== undefined && mentions(error, 'runtime') && attempt.runtime !== legacyRuntime(attempt.runtime)) { attempt = { ...attempt, runtime: legacyRuntime(attempt.runtime) }; continue; }
      if (attempt.origin !== undefined && mentions(error, 'origin')) { const { origin: _origin, ...rest } = attempt; attempt = rest; continue; }
      throw error;
    }
  }
  return send(attempt);
}
