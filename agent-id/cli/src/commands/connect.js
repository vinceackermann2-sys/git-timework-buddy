// `timewarp-id connect <tool>`: adds Agent ID to Claude Code, Codex, Claude
// Desktop or Cursor as a stdio MCP server that runs `timewarp-id mcp`, so the
// agent's key stays in this CLI's config instead of the tool's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CliError, UsageError } from '../errors.js';
import { findProfile, selectAgent } from '../config.js';
import { tomlValue, upsertTable } from '../toml.js';

export const SERVER_NAME = 'timewarp-id';
export const CODEX_TABLE = ['mcp_servers', 'timewarp_id'];
const PACKAGE = '@timewarp/agent-id';
const BIN = fileURLToPath(new URL('../../bin/timewarp-id.js', import.meta.url));
const TOOLS = { claude: 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor' };
const ALIASES = { 'claude-code': 'claude', desktop: 'claude-desktop', claude_desktop: 'claude-desktop' };

// For printing a command people can paste (PowerShell, cmd and POSIX shells).
export const quote = arg => /^[A-Za-z0-9_\-.,:/=@%+\\]+$/.test(arg) ? arg : `"${String(arg).replace(/(["\\$`])/g, '\\$1')}"`;
const cmdQuote = arg => /^[A-Za-z0-9_\-.,:/=@%+\\]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '""')}"`;

// The program on PATH, as Windows or a POSIX shell would find it.
export function findExecutable(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ...String(env.PATHEXT || '').toLowerCase().split(';').filter(Boolean)] : [''];
  for (const dir of dirs) {
    for (const ext of [...new Set(extensions)]) {
      const file = path.join(dir, name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return null;
}

// What the tool runs.
// `agent` pins the server to one agent; `defaultAgent` is who it acts as
// outside folders whose .timewarp-id.json names another; neither follows the
// folder (else the CLI's default agent).
// The app slug each tool reports as (TIMEWARP_ID_TOOL, for the user-agent).
const APP_OF_TOOL = { claude: 'claude-code', codex: 'codex', 'claude-desktop': 'claude-desktop', cursor: 'cursor' };
// Tools that start programs directly, where npx (a .cmd on Windows) needs cmd /c.
const NEEDS_CMD = new Set(['claude', 'codex', 'opencode']);

export function serverSpec(ctx, tool, { agent, defaultAgent, app } = {}) {
  const mcpArgs = ['mcp', ...(agent ? ['--agent', agent] : defaultAgent ? ['--default-agent', defaultAgent] : [])];
  let command, args;
  if (ctx.flags.local) { command = process.execPath; args = [BIN, ...mcpArgs]; }
  else {
    command = 'npx'; args = ['-y', PACKAGE, ...mcpArgs];
    if (process.platform === 'win32' && NEEDS_CMD.has(tool)) { args = ['/c', command, ...args]; command = 'cmd'; }
  }
  const env = {};
  const reportAs = app || APP_OF_TOOL[tool];
  if (reportAs) env.TIMEWARP_ID_TOOL = reportAs;
  if (ctx.env.TIMEWARP_ID_HOME) env.TIMEWARP_ID_HOME = path.resolve(ctx.env.TIMEWARP_ID_HOME);
  if (ctx.flags.api || ctx.env.AGENT_ID_API) env.AGENT_ID_API = ctx.apiBase;
  return { command, args, ...(Object.keys(env).length ? { env } : {}) };
}

export function claudeDesktopConfig(env) {
  if (process.platform === 'win32') {
    const roaming = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const classic = path.join(roaming, 'Claude', 'claude_desktop_config.json');
    if (fs.existsSync(classic)) return classic;
    // The Microsoft Store (MSIX) app keeps its own copy of AppData.
    const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    try {
      for (const name of fs.readdirSync(path.join(local, 'Packages'))) {
        if (!/^Claude_/i.test(name)) continue;
        const file = path.join(local, 'Packages', name, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
        if (fs.existsSync(file)) return file;
      }
    } catch { /* no packages */ }
    return classic;
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude', 'claude_desktop_config.json');
}

// A copy of the file as it was before Timewarp ID first changed it.
export function backupOnce(file, before) {
  const backup = `${file}.timewarp-id.bak`;
  if (before !== null && !fs.existsSync(backup)) fs.writeFileSync(backup, before);
}

export function writeWithBackup(file, before, after) {
  if (before === after) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backupOnce(file, before);
  fs.writeFileSync(file, after);
}

function mergeJson(file, spec) {
  let before = null, data = {};
  try { before = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (before !== null && before.trim()) {
    try { data = JSON.parse(before); } catch { throw new CliError(`${file} is not valid JSON, so it was left alone.`, { hint: 'Fix it, or add the server by hand: `timewarp-id connect … --print` shows what to add.' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CliError(`${file} doesn't hold a JSON object, so it was left alone.`);
  }
  if (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) data.mcpServers = {};
  data.mcpServers[SERVER_NAME] = spec;
  const after = `${JSON.stringify(data, null, 2)}\n`;
  writeWithBackup(file, before, after);
  return { changed: before !== after };
}

// A [mcp_servers.<name>] table (Codex, Grok).
export function codexBlock(spec, table = CODEX_TABLE) {
  return [
    `[${table.join('.')}]`,
    `command = ${tomlValue(spec.command)}`,
    `args = ${tomlValue(spec.args)}`,
    ...(spec.env ? [`env = ${tomlValue(spec.env)}`] : []),
    'startup_timeout_sec = 60',
    'tool_timeout_sec = 900',
  ].join('\n');
}

export async function connect(ctx) {
  const raw = ctx.args[0];
  const tool = ALIASES[raw] || raw;
  if (!tool) throw new UsageError(`Which tool? ${Object.keys(TOOLS).join(', ')}.`);
  if (!TOOLS[tool]) throw new UsageError(`"${raw}" is not one of ${Object.keys(TOOLS).join(', ')}.`);
  const scope = ctx.flags.scope ?? 'user';
  if (!['user', 'project', 'local'].includes(scope)) throw new UsageError('--scope is user or project.');

  // A named agent must have a key here; without one the server follows the
  // project's (or default) agent each time it starts.
  let handle = null, note = '';
  if (typeof ctx.flags.agent === 'string') {
    const profile = findProfile(ctx.config, ctx.flags.agent);
    if (!profile) throw new CliError(`There is no key for "${ctx.flags.agent}" on this computer.`, { hint: `Get one with \`timewarp-id agents key ${ctx.flags.agent}\` first.` });
    handle = profile.handle;
  } else {
    try { const chosen = selectAgent(ctx.config, { flags: {}, env: { ...ctx.env, TIMEWARP_AGENT_KEY: '' }, cwd: ctx.cwd }); note = `Without --agent it acts as the project's agent (.timewarp-id.json), else the default (now ${chosen.handle}).`; }
    catch { note = 'Without --agent it acts as the project\'s agent (.timewarp-id.json) or the default agent; set one with `timewarp-id use <agent>`.'; }
  }
  const spec = serverSpec(ctx, tool, { agent: handle });
  const who = handle ? `as ${handle}` : 'as the project\'s agent';

  if (tool === 'claude') {
    const args = ['mcp', 'add', SERVER_NAME, '-s', scope, ...Object.entries(spec.env || {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '--', spec.command, ...spec.args];
    const printed = ['claude', ...args].map(quote).join(' ');
    if (ctx.flags.print) return ctx.print({ tool, command: 'claude', args, server: spec }, () => printed);
    const claude = findExecutable('claude', ctx.env);
    if (!claude) {
      return ctx.print({ tool, command: 'claude', args, server: spec, ran: false }, () => `Claude Code's \`claude\` command isn't on PATH. Run this where it is:\n\n  ${printed}\n\n${note}`.trim());
    }
    const shell = /\.(cmd|bat)$/i.test(claude);
    const run = list => spawnSync(shell ? cmdQuote(claude) : claude, shell ? list.map(cmdQuote) : list, { cwd: ctx.cwd, encoding: 'utf8', shell, env: ctx.env });
    run(['mcp', 'remove', SERVER_NAME, '-s', scope]); // Replace an older entry; fine if there is none.
    const added = run(args);
    if (added.status !== 0) throw new CliError(`\`claude mcp add\` failed: ${(added.stderr || added.stdout || added.error?.message || '').trim()}`, { hint: `Run it yourself: ${printed}` });
    return ctx.print({ tool, command: 'claude', args, server: spec, ran: true }, () => [`Added Agent ID to Claude Code (${scope} scope) ${who}.`, note, 'Start a new Claude Code session to use it.'].filter(Boolean).join('\n'));
  }

  if (tool === 'codex') {
    if (scope !== 'user') throw new UsageError('Codex reads MCP servers from ~/.codex/config.toml only. For an agent per project, leave out --agent and run `timewarp-id use <agent> --project` in each project.');
    const file = path.join(ctx.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
    const block = codexBlock(spec);
    if (ctx.flags.print) return ctx.print({ tool, file, toml: block, server: spec }, () => `Add to ${file}:\n\n${block}`);
    let before = null;
    try { before = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const after = upsertTable(before || '', CODEX_TABLE, block);
    writeWithBackup(file, before, after);
    return ctx.print({ tool, file, server: spec, changed: before !== after }, () => [`Added Agent ID to Codex ${who}: [${CODEX_TABLE.join('.')}] in ${file}.`, note, 'Start a new Codex session to use it.'].filter(Boolean).join('\n'));
  }

  // Claude Desktop and Cursor: an mcpServers entry in a JSON file.
  if (tool === 'claude-desktop' && scope === 'project') throw new UsageError('Claude Desktop has no project scope.');
  const file = typeof ctx.flags.config === 'string' ? path.resolve(ctx.cwd, ctx.flags.config)
    : tool === 'claude-desktop' ? claudeDesktopConfig(ctx.env)
    : scope === 'user' ? path.join(os.homedir(), '.cursor', 'mcp.json') : path.join(ctx.cwd, '.cursor', 'mcp.json');
  const snippet = JSON.stringify({ mcpServers: { [SERVER_NAME]: spec } }, null, 2);
  if (ctx.flags.print) return ctx.print({ tool, file, json: { mcpServers: { [SERVER_NAME]: spec } } }, () => `Merge into ${file}:\n\n${snippet}`);
  const { changed } = mergeJson(file, spec);
  return ctx.print({ tool, file, server: spec, changed }, () => [`Added Agent ID to ${TOOLS[tool]} ${who}: "${SERVER_NAME}" in ${file}.`, note, `Restart ${TOOLS[tool]} to use it.`].filter(Boolean).join('\n'));
}
