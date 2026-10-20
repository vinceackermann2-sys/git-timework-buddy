// `timewarp-id attach` gives the agents people already have an Agent ID in one
// step, and writes the wiring into them. It finds:
//   - Claude Code (every project, the project here, its subagents), Codex
//     (every project, the project here), Cursor, Claude Desktop;
//   - Gemini CLI, Antigravity, Windsurf, opencode, Grok, Kiro, Qwen Code,
//     Factory Droid, Copilot CLI, Amazon Q, Continue, and Cline, Roo Code and
//     Kilo Code in VS Code-style editors;
//   - Timewarp desktop agents and OpenClaw workspaces (they use the
//     `timewarp-id` command), and any folder, for a custom agent;
//   - other agent apps it can see but can't wire up (listed as manual setup).
// It writes a short identity block into the agent's instructions, a
// .timewarp-id.json into the agent's folder, and the MCP server into the
// tool's config, and tells Agent ID where the agent comes from (origin).
// What it wrote is recorded in ~/.timewarp-id/attachments.json so `detach`
// undoes exactly that, and running attach again updates in place.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ApiError, CliError, UsageError } from '../errors.js';
import { findProfile, homeDir, PROJECT_FILE } from '../config.js';
import { backupOnce, claudeDesktopConfig, CODEX_TABLE, codexBlock, serverSpec } from './connect.js';
import { saveProfile } from './account.js';
import { extractTable, removeTable, upsertTable } from '../toml.js';
import { parseJsonc, removeMember, setMember } from '../jsonc.js';
import { APPS, sendWithOrigin } from '../origin.js';
import { withTerms } from '../terms.js';
import { table } from '../output.js';

export const START = '<!-- timewarp-agent-id:start -->';
export const END = '<!-- timewarp-agent-id:end -->';
const KINDS = ['mail', 'phone', 'wallet', 'card', 'vm'];
const AGENT_ID = /agt_[a-z0-9]{24}/;
const TIMEWARP_PROFILE = 'Timewarp Energy';
const RULE_FILE = 'timewarp-agent-id';

// --- Files --------------------------------------------------------------------------------
const exists = file => { try { fs.statSync(file); return true; } catch { return false; } };
const isDir = file => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return null; throw error; } };
const listDir = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
// A tool's folder counts as installed when it holds more than skills (which
// skill installers create for every tool they know).
const installed = dir => listDir(dir).some(entry => entry.name !== 'skills');
function writeText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const eolOf = text => (text && text.includes('\r\n') ? '\r\n' : '\n');
export const short = file => {
  if (!file) return '';
  const home = os.homedir();
  return file === home || file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
};
const shown = file => short(file).replace(/\\/g, '/');

// --- The identity block -----------------------------------------------------------------
function blockSpan(text) {
  const start = text.indexOf(START);
  if (start === -1) return null;
  const end = text.indexOf(END, start);
  if (end === -1) return null;
  let stop = end + END.length;
  if (text.startsWith('\r\n', stop)) stop += 2; else if (text[stop] === '\n') stop += 1;
  return { start, end: stop };
}

// In place if there is one; otherwise after the text, following a blank line.
export function upsertBlock(text, block) {
  const eol = eolOf(text);
  const body = block.split('\n').join(eol) + eol;
  const span = text ? blockSpan(text) : null;
  if (span) return text.slice(0, span.start) + body + text.slice(span.end);
  if (!text) return body;
  return text + (text.endsWith('\n') ? '' : eol) + eol + body;
}

// Exactly what upsertBlock added.
export function removeBlock(text) {
  const span = blockSpan(text);
  if (!span) return text;
  let before = text.slice(0, span.start);
  const after = text.slice(span.end);
  if (!after) {
    if (before.endsWith('\r\n\r\n')) before = before.slice(0, -2);
    else if (before.endsWith('\n\n')) before = before.slice(0, -1);
  }
  return before + after;
}

const joinList = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// Short on purpose: it is read with every request the agent makes.
export function identityBlock(me, { server, global } = {}) {
  const agent = me.agent, r = agent.resources || {};
  const has = [r.mail && `mail ${r.mail.address}`, r.phone && `phone ${r.phone.address}`, r.wallet && `wallet ${r.wallet.address}`, r.card && 'a card', r.vm && 'a machine'].filter(Boolean);
  const tools = server
    ? `Use them with your \`${server}\` MCP tools or the \`timewarp-id\` command.`
    : 'Use them with the `timewarp-id` command run in this folder, which acts as you (e.g. `timewarp-id mail list`).';
  return [
    START,
    '## Your Agent ID',
    `You are ${agent.name} (${agent.id}, handle ${agent.handle}), a Timewarp Agent ID agent${me.owner?.verified ? ' with a verified owner' : ''}.${has.length ? ` You have ${joinList(has)}.` : ''}`,
    `${tools} Payments over your limits wait for your owner's approval. Never share keys or card details.${global ? ' A project or subagent that names its own Agent ID takes precedence.' : ''}`,
    END,
  ].join('\n');
}

// --- Subagent frontmatter ---------------------------------------------------------------
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function frontmatter(text) {
  const fields = {};
  const match = FRONTMATTER.exec(text || '');
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

// Puts this server's tools in a subagent's `tools:` list (replacing the ones
// it put there before); with no names, takes them out. A subagent without a
// `tools:` line inherits every tool, MCP ones included, so it is left alone.
export function setSubagentTools(text, server, names) {
  const match = FRONTMATTER.exec(text || '');
  if (!match) return { text, listed: false };
  const eol = match[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/);
  const at = lines.findIndex(line => /^tools\s*:/.test(line));
  if (at === -1) return { text, listed: false };
  const prefix = `mcp__${server}__`;
  const ours = item => item.trim().replace(/^['"]|['"]$/g, '').startsWith(prefix);
  const value = lines[at].replace(/^tools\s*:\s*/, '');
  if (!value.trim()) {
    let end = at + 1;
    while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++;
    const items = lines.slice(at + 1, end);
    const indent = items.length ? /^(\s*)-/.exec(items[0])[1] : '  ';
    const kept = items.filter(line => !ours(line.replace(/^\s*-\s+/, '')));
    if (kept.length === items.length && !names.length) return { text, listed: true };
    lines.splice(at + 1, end - at - 1, ...kept, ...names.map(name => `${indent}- ${prefix}${name}`));
  } else {
    const flow = value.trim().startsWith('[');
    const items = (flow ? value.trim().replace(/^\[|\]$/g, '') : value).split(',').map(s => s.trim()).filter(Boolean);
    const kept = items.filter(item => !ours(item));
    if (kept.length === items.length && !names.length) return { text, listed: true };
    const all = [...kept, ...names.map(name => prefix + name)].join(', ');
    lines[at] = flow ? `tools: [${all}]` : `tools: ${all}`;
  }
  const bodyStart = text.startsWith('---\r\n') ? 5 : 4;
  return { text: text.slice(0, bodyStart) + lines.join(eol) + text.slice(bodyStart + match[1].length), listed: true };
}

// --- MCP entries --------------------------------------------------------------------------
// Every tool's entry is `timewarp-id mcp …`; these tell ours from others.
const wordsOf = entry => [...[].concat(entry?.command ?? []), ...(Array.isArray(entry?.args) ? entry.args : [])].map(String);
const isOurs = entry => { const words = wordsOf(entry); return words.includes('mcp') && words.some(word => word.includes('@timewarp/agent-id') || /timewarp-id\.js$/.test(word)); };
const isOursText = text => !!text && /mcp/.test(text) && (text.includes('@timewarp/agent-id') || /timewarp-id\.js/.test(text));
const agentInWords = words => {
  const at = words.findIndex(word => word === '--agent' || word === '--default-agent');
  return at === -1 ? null : words[at + 1] || null;
};
const agentInText = text => /"--(?:default-)?agent"\s*[,\n]\s*(?:-\s*)?"([^"]+)"/.exec(text || '')?.[1] || null;

// A JSON (or JSONC) config as data, or a clear error; the file itself is
// only ever edited in place (jsonc.js), so its formatting stays.
function parseConfig(text, file, format) {
  if (text === null || !text.trim()) return {};
  let data;
  try { data = format === 'jsonc' ? parseJsonc(text) : JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CliError(`${short(file)} is not valid ${format === 'jsonc' ? 'JSON (with comments)' : 'JSON'}, so it was left alone.`, { hint: 'Fix it, then run this again.' }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CliError(`${short(file)} doesn't hold a JSON object, so it was left alone.`);
  return data;
}
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
// The keys an entry goes under: the container, and mirrors the file already has.
const jsonKeys = (mcp, data) => [mcp.container || 'mcpServers', ...(mcp.mirror || []).filter(key => isObject(data[key]))];

const mcpName = (mcp, handle) => mcp.name || `timewarp-id-${handle}`;
const tableOf = (mcp, name) => mcp.table || ['mcp_servers', name];

function entryFor(ctx, mcp, app, handle, mode = mcp.mode) {
  const spec = serverSpec(ctx, mcp.tool, { ...(mode === 'agent' ? { agent: handle } : mode === 'default' ? { defaultAgent: handle } : {}), app });
  if (mcp.style === 'claude') return { type: 'stdio', ...spec };
  if (mcp.style === 'copilot') return { type: 'local', ...spec, tools: ['*'] };
  if (mcp.style === 'opencode') return { type: 'local', command: [spec.command, ...spec.args], enabled: true, ...(spec.env ? { environment: spec.env } : {}) };
  return spec;
}

// Continue reads MCP servers from YAML blocks in ~/.continue/mcpServers.
function continueBlock(spec, name) {
  const q = JSON.stringify;
  return [
    'name: Timewarp Agent ID', 'version: 1.0.0', 'schema: v1', 'mcpServers:', `  - name: ${q(name)}`, `    command: ${q(spec.command)}`, '    args:',
    ...spec.args.map(arg => `      - ${q(arg)}`),
    ...(spec.env ? ['    env:', ...Object.entries(spec.env).map(([key, value]) => `      ${key}: ${q(value)}`)] : []),
  ].join('\n') + '\n';
}

// The tool's MCP entry; returns what to record and what to tell.
function writeMcp(ctx, target, mcp, handle, earlier) {
  const { file, format } = mcp;
  const name = mcpName(mcp, handle);
  const entry = entryFor(ctx, mcp, target.app, handle);
  const record = extra => ({ type: 'mcp', file, format, name, app: target.app, mcp, ...extra });
  const before = readText(file);
  const createdFile = earlier ? earlier.createdFile : before === null;
  if (format === 'toml') {
    const tablePath = tableOf(mcp, name);
    const existing = extractTable(before || '', tablePath);
    if (mcp.mode === 'follow' && existing) {
      const pinned = /"--agent"\s*,\s*"([^"]+)"/.exec(existing)?.[1];
      return {
        change: record({ kept: true }),
        note: pinned && pinned !== handle
          ? `${target.tool}'s ${name} server is pinned to ${pinned}, so it acts as ${pinned} here too; \`timewarp-id attach ${target.globalRef || 'codex'}\` makes it follow each project.`
          : `kept ${target.tool}'s ${name} server, which follows this folder's ${PROJECT_FILE}`,
        pinned: !!(pinned && pinned !== handle), file,
      };
    }
    const after = upsertTable(before || '', tablePath, codexBlock(entry, tablePath));
    if (after !== before) { backupOnce(file, before); writeText(file, after); }
    return { change: record({ previous: earlier ? earlier.previous : (isOursText(existing) ? null : existing), createdFile }), note: `MCP server ${name}`, file };
  }
  if (format === 'yaml-file') {
    const after = continueBlock(entry, name);
    if (after !== before) { backupOnce(file, before); writeText(file, after); }
    return { change: record({ previous: earlier ? earlier.previous : (before && !isOursText(before) ? before : null), createdFile }), note: `MCP server "${name}"`, file };
  }
  // JSON and JSONC: the entry, under the container and any mirror the file keeps.
  const data = parseConfig(before, file, format);
  const keys = jsonKeys(mcp, data);
  const previous = data[keys[0]]?.[name] ?? null;
  let after = before || '', createdContainer = false;
  for (const key of keys) {
    const result = setMember(after, key, name, entry);
    after = result.text;
    if (key === keys[0]) createdContainer = result.createdContainer;
  }
  if (after !== before) { backupOnce(file, before); writeText(file, after); }
  return {
    change: record({ previous: earlier ? earlier.previous : (previous && !isOurs(previous) ? previous : null), createdFile, createdContainer: earlier ? earlier.createdContainer : createdContainer }),
    note: `MCP server "${name}"`, file,
  };
}

// Undoes writeMcp. An entry other attachments still use stays; if it acted
// as this agent by default, it now just follows each project's
// .timewarp-id.json.
function removeMcp(ctx, change, handle, stillUsed) {
  if (change.kept) return null;
  const mcp = change.mcp || { file: change.file, format: change.format, name: change.name, ...(change.format === 'toml' ? { table: CODEX_TABLE, tool: 'codex' } : {}) };
  const { file, name } = change;
  const format = mcp.format;
  const before = readText(file);
  if (before === null) return null;
  const follow = () => entryFor(ctx, mcp, change.app, null, 'follow');
  const finish = (after, what) => {
    if (after === before) return null;
    if (change.createdFile && !after.trim()) fs.rmSync(file, { force: true });
    else writeText(file, after);
    return `${short(file)}: ${what}`;
  };
  if (format === 'toml') {
    const tablePath = tableOf(mcp, name);
    const existing = extractTable(before, tablePath);
    if (!existing || !isOursText(existing)) return null;
    if (stillUsed) {
      if (!handle || !existing.includes(`"--default-agent", "${handle}"`)) return null;
      return finish(upsertTable(before, tablePath, codexBlock(follow(), tablePath)), `${name} now follows each project`);
    }
    return finish(change.previous ? upsertTable(before, tablePath, change.previous) : removeTable(before, tablePath), change.previous ? `restored the earlier ${name}` : `removed ${name}`);
  }
  if (format === 'yaml-file') {
    if (!isOursText(before) || (handle && agentInText(before) && agentInText(before) !== handle)) return null;
    if (change.previous) return finish(change.previous, `restored the earlier "${name}"`);
    if (change.createdFile) { fs.rmSync(file, { force: true }); return `${short(file)}: removed`; }
    return finish('', `removed "${name}"`);
  }
  // JSON and JSONC, edited in place: what attach added goes, the rest stays as it was.
  const data = parseConfig(before, file, format);
  const keys = jsonKeys(mcp, data);
  const entry = data[keys[0]]?.[name];
  if (!entry || !isOurs(entry)) return null;
  const mine = agentInWords(wordsOf(entry));
  if (mine && handle && mine !== handle) return null; // Someone attached another agent since.
  if (stillUsed && !mine) return null;
  let after = before;
  for (const key of keys) {
    if (!isObject(data[key]) || !(name in data[key])) continue;
    if (stillUsed) after = setMember(after, key, name, follow()).text;
    else if (change.previous) after = setMember(after, key, name, change.previous).text;
    else after = removeMember(after, key, name, { dropEmptyContainer: key === keys[0] && !!change.createdContainer });
  }
  const left = parseConfig(after, file, format);
  if (change.createdFile && Object.values(left).every(value => isObject(value) && !Object.keys(value).length)) { fs.rmSync(file, { force: true }); return `${short(file)}: removed`; }
  return finish(after, stillUsed ? `"${name}" now follows each project` : change.previous ? `restored the earlier "${name}"` : `removed MCP server "${name}"`);
}

// The agent a tool's entry acts as, if it is ours.
function mcpAgent(mcp) {
  try {
    const text = readText(mcp.file);
    if (!text || !mcp.name) return null;
    if (mcp.format === 'toml') { const existing = extractTable(text, tableOf(mcp, mcp.name)); return isOursText(existing) ? agentInText(existing) : null; }
    if (mcp.format === 'yaml-file') return isOursText(text) ? agentInText(text) : null;
    const entry = parseConfig(text, mcp.file, mcp.format)?.[mcp.container || 'mcpServers']?.[mcp.name];
    return isOurs(entry) ? agentInWords(wordsOf(entry)) : null;
  } catch { return null; }
}

// --- Where agents are ---------------------------------------------------------------------
export const slugOf = name => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');

// Timewarp keeps an agent in "<slug>-<id>". The id is a UUID at the end
// (the slug may be from an older name); otherwise ids may contain dashes, so
// the slug of the agent's name says where the id starts.
const TRAILING_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function desktopIdOf(folder, name) {
  const uuid = TRAILING_UUID.exec(folder)?.[1];
  if (uuid) return uuid;
  const slug = slugOf(name);
  if (slug && folder.startsWith(`${slug}-`) && folder.length > slug.length + 1) return folder.slice(slug.length + 1);
  const dash = folder.lastIndexOf('-');
  return dash > 0 ? folder.slice(dash + 1) : folder;
}

const headingOf = text => /^#[ \t]+(.+?)[ \t#]*$/m.exec(text || '')?.[1]?.trim() || null;

// Per-user app data: %APPDATA%, ~/Library/Application Support, ~/.config.
function appData(env) {
  const home = os.homedir();
  if (process.platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

// Timewarp's own list of its agents (timewarp.sqlite), read-only. Null when
// it can't be read (Node without node:sqlite, or the file is busy).
let DatabaseSync = null;
{
  // Node 22–24 warn that node:sqlite is experimental; that isn't the user's concern.
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => /SQLite/i.test(String(warning?.message ?? warning)) ? undefined : emitWarning.call(process, warning, ...rest);
  try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* Node < 22 */ }
  finally { process.emitWarning = emitWarning; }
}
function liveTimewarpAgents(profile) {
  const file = path.join(profile, 'timewarp.sqlite');
  if (!DatabaseSync || !exists(file)) return null;
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare('select id, name, workspace from agents where archived_at is null order by name').all(); }
    finally { db.close(); }
  } catch { return null; }
}

export function timewarpProfiles(env) {
  if (env.TIMEWARP_PROFILE_DIR) return [path.resolve(env.TIMEWARP_PROFILE_DIR)];
  const home = os.homedir();
  const dirs = [path.join(appData(env), TIMEWARP_PROFILE)];
  if (process.platform === 'win32') {
    // Timewarp's own Microsoft Store package. Other apps' packages (Claude,
    // Codex) can hold stale copies of the profile, made when Timewarp was
    // started from inside them; those aren't other agents.
    const packages = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    for (const entry of listDir(packages)) if (entry.isDirectory() && /timewarp|energy/i.test(entry.name)) dirs.push(path.join(packages, entry.name, 'LocalCache', 'Roaming', TIMEWARP_PROFILE));
  }
  return dirs.filter(isDir);
}

const json = (file, extra = {}) => ({ file, format: 'json', style: 'standard', mode: 'default', ...extra });

// Agent tools configured in the home folder, each with its MCP config file
// (format from its files or its documentation) and its instructions file.
function homeTools(env) {
  const home = os.homedir(), at = (...parts) => path.join(home, ...parts);
  const opencodeDir = path.join(env.XDG_CONFIG_HOME || at('.config'), 'opencode');
  const opencodeFile = ['opencode.jsonc', 'opencode.json'].map(name => path.join(opencodeDir, name)).find(exists) || path.join(opencodeDir, 'opencode.json');
  const antigravity = [at('.gemini', 'config', 'mcp_config.json'), at('.gemini', 'antigravity', 'mcp_config.json')];
  return [
    { id: 'gemini', tool: 'Gemini CLI', app: 'gemini', found: exists(at('.gemini', 'settings.json')),
      mcps: [json(at('.gemini', 'settings.json'))], instructions: at('.gemini', 'GEMINI.md') },
    { id: 'antigravity', tool: 'Antigravity', app: 'gemini', detail: 'Antigravity', found: antigravity.some(exists) || isDir(at('.gemini', 'antigravity')),
      mcps: (antigravity.filter(exists).length ? antigravity.filter(exists) : [antigravity[1]]).map(file => json(file, { mirror: ['servers'] })), instructions: at('.gemini', 'GEMINI.md') },
    { id: 'windsurf', tool: 'Windsurf', app: 'windsurf', found: exists(at('.codeium', 'windsurf', 'mcp_config.json')) || installed(at('.codeium', 'windsurf')) || isDir(path.join(appData(env), 'Windsurf')),
      mcps: [json(at('.codeium', 'windsurf', 'mcp_config.json'))], instructions: at('.codeium', 'windsurf', 'memories', 'global_rules.md') },
    { id: 'opencode', tool: 'opencode', app: 'opencode', found: exists(opencodeFile),
      mcps: [{ file: opencodeFile, format: 'jsonc', container: 'mcp', style: 'opencode', tool: 'opencode', mode: 'default' }], instructions: path.join(opencodeDir, 'AGENTS.md') },
    { id: 'grok', tool: 'Grok', app: 'grok', found: exists(at('.grok', 'config.toml')),
      mcps: [{ file: at('.grok', 'config.toml'), format: 'toml', name: 'timewarp-id', table: ['mcp_servers', 'timewarp-id'], mode: 'default', tool: 'grok' }], instructions: at('.grok', 'AGENTS.md') },
    { id: 'kiro', tool: 'Kiro', app: 'kiro', found: isDir(at('.kiro', 'settings')),
      mcps: [json(at('.kiro', 'settings', 'mcp.json'))], rule: at('.kiro', 'steering', `${RULE_FILE}.md`), ruleHeader: '---\ninclusion: always\n---\n' },
    { id: 'qwen', tool: 'Qwen Code', app: 'qwen', found: exists(at('.qwen', 'settings.json')),
      mcps: [json(at('.qwen', 'settings.json'))], instructions: at('.qwen', 'QWEN.md') },
    { id: 'factory', tool: 'Factory Droid', app: 'factory', found: exists(at('.factory', 'mcp.json')) || exists(at('.factory', 'settings.json')) || exists(at('.factory', 'config.json')),
      mcps: [json(at('.factory', 'mcp.json'), { style: 'claude' })] },
    { id: 'copilot', tool: 'Copilot CLI', app: 'copilot', found: exists(at('.copilot', 'mcp-config.json')) || exists(at('.copilot', 'config.json')),
      mcps: [json(at('.copilot', 'mcp-config.json'), { style: 'copilot' })] },
    { id: 'amazonq', tool: 'Amazon Q', app: 'amazon-q', found: isDir(at('.aws', 'amazonq')),
      mcps: [json(at('.aws', 'amazonq', 'mcp.json'))] },
    { id: 'continue', tool: 'Continue', app: 'continue', found: exists(at('.continue', 'config.yaml')) || exists(at('.continue', 'config.json')),
      mcps: [{ file: at('.continue', 'mcpServers', 'timewarp-id.yaml'), format: 'yaml-file', name: 'timewarp-id', mode: 'default', tool: 'continue' }], rule: at('.continue', 'rules', `${RULE_FILE}.md`) },
  ];
}

// Cline, Roo Code and Kilo Code keep their MCP settings in the editor's storage.
function extensionTools(env) {
  const home = os.homedir();
  const editors = [['Code', 'VS Code'], ['Code - Insiders', 'VS Code Insiders'], ['Cursor', 'Cursor'], ['Windsurf', 'Windsurf'], ['VSCodium', 'VSCodium']];
  const extensions = [
    { id: 'cline', tool: 'Cline', app: 'cline', ext: 'saoudrizwan.claude-dev', file: 'cline_mcp_settings.json' },
    { id: 'roo', tool: 'Roo Code', app: 'roo', ext: 'rooveterinaryinc.roo-cline', file: 'mcp_settings.json', rule: path.join(home, '.roo', 'rules', `${RULE_FILE}.md`) },
    { id: 'kilo', tool: 'Kilo Code', app: 'kilocode', ext: 'kilocode.kilo-code', file: 'mcp_settings.json', rule: path.join(home, '.kilocode', 'rules', `${RULE_FILE}.md`) },
  ];
  const found = [];
  for (const extension of extensions) {
    const here = editors.map(([folder, editor]) => ({ editor, dir: path.join(appData(env), folder, 'User', 'globalStorage', extension.ext) })).filter(({ dir }) => isDir(dir));
    for (const { editor, dir } of here) {
      found.push({ id: here.length > 1 ? `${extension.id}:${slugOf(editor)}` : extension.id, tool: extension.tool, app: extension.app, detail: editor, found: true,
        mcps: [json(path.join(dir, 'settings', extension.file))], ...(extension.rule ? { rule: extension.rule } : {}), label: `in ${editor}` });
    }
  }
  return found;
}

// Agent apps seen here whose MCP setup attach can't write (yet).
function manualTools(env) {
  const home = os.homedir(), at = (...parts) => path.join(home, ...parts);
  return [
    { id: 'grokbot', tool: 'Grok Bot', app: 'grok', found: installed(at('.grokbot')) || isDir(path.join(appData(env), 'Grok Bot')), where: at('.grokbot', 'settings.json') },
    { id: 'zed', tool: 'Zed', app: 'zed', found: isDir(path.join(appData(env), 'Zed')) || isDir(at('.config', 'zed')) || installed(at('.zed')), where: process.platform === 'win32' ? path.join(appData(env), 'Zed', 'settings.json') : at('.config', 'zed', 'settings.json') },
    { id: 'augment', tool: 'Augment', app: 'augment', found: installed(at('.augment')), where: at('.augment') },
    { id: 'junie', tool: 'Junie', app: 'junie', found: installed(at('.junie')), where: at('.junie') },
    { id: 'hermes', tool: 'Hermes', app: 'hermes', found: installed(at('.hermes')), where: at('.hermes') },
    { id: 'moltbot', tool: 'Moltbot', app: 'moltbot', found: installed(at('.moltbot')) || installed(at('.clawdbot')), where: at('.moltbot') },
  ].filter(tool => tool.found);
}

// What to paste where attach can't write it.
export const snippet = handle => JSON.stringify({ mcpServers: { 'timewarp-id': { command: 'npx', args: ['-y', '@timewarp/agent-id', 'mcp', ...(handle ? ['--agent', handle] : [])] } } }, null, 2);

function subagent(file, scope, mcpFile) {
  const fields = frontmatter(readText(file));
  const name = fields.name || path.basename(file, '.md');
  return {
    key: `claude-agent:${file}`, ref: `claude-agent:${name}`, kind: 'claude-agent', tool: 'Claude Code', app: 'claude-code', detail: `subagent ${name}`,
    label: `subagent ${name}${scope === 'project' ? ' (this project)' : ''}`, name, description: fields.description || '', where: file, instructions: file, subagent: true,
    mcps: [json(mcpFile, { name: null, mode: 'agent', tool: 'claude', style: 'claude' })],
  };
}

export function discover(ctx) {
  const home = os.homedir(), cwd = path.resolve(ctx.cwd), env = ctx.env;
  const folder = path.basename(cwd), project = `project ${shown(cwd)}`;
  const targets = [];
  const add = target => { if (!targets.some(t => t.key === target.key)) targets.push(target); };

  // Claude Code
  const claudeJson = path.join(home, '.claude.json'), claudeDir = path.join(home, '.claude');
  if (exists(claudeJson) || isDir(claudeDir)) {
    add({ key: 'claude', ref: 'claude', kind: 'claude', tool: 'Claude Code', app: 'claude-code', detail: 'every project', label: 'main agent, every project', name: 'Claude Code', where: claudeJson,
      instructions: path.join(claudeDir, 'CLAUDE.md'), global: true, mcps: [json(claudeJson, { name: 'timewarp-id', tool: 'claude', style: 'claude' })] });
  }
  if (exists(path.join(cwd, '.mcp.json')) || exists(path.join(cwd, 'CLAUDE.md')) || isDir(path.join(cwd, '.claude'))) {
    add({ key: `claude-project:${cwd}`, ref: 'claude:project', kind: 'claude-project', tool: 'Claude Code', app: 'claude-code', detail: project, label: `main agent, project ${folder}`, name: `${folder} (Claude Code)`, where: cwd,
      instructions: path.join(cwd, 'CLAUDE.md'), projectDir: cwd, mcps: [json(path.join(cwd, '.mcp.json'), { name: 'timewarp-id', mode: 'agent', tool: 'claude', style: 'claude' })] });
  }
  for (const [dir, scope, mcpFile] of [[path.join(cwd, '.claude', 'agents'), 'project', path.join(cwd, '.mcp.json')], [path.join(claudeDir, 'agents'), 'user', claudeJson]]) {
    for (const entry of listDir(dir)) if (entry.isFile() && entry.name.endsWith('.md')) add(subagent(path.join(dir, entry.name), scope, mcpFile));
  }

  // Codex
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const codexConfig = path.join(codexHome, 'config.toml');
  const codexMcp = mode => ({ file: codexConfig, format: 'toml', name: 'timewarp_id', table: CODEX_TABLE, mode, tool: 'codex' });
  if (isDir(codexHome)) {
    add({ key: 'codex', ref: 'codex', kind: 'codex', tool: 'Codex', app: 'codex', detail: 'every project', label: 'main agent, every project', name: 'Codex', where: codexConfig,
      instructions: path.join(codexHome, 'AGENTS.md'), global: true, mcps: [codexMcp('default')] });
  }
  if (exists(path.join(cwd, 'AGENTS.md'))) {
    add({ key: `codex-project:${cwd}`, ref: 'codex:project', kind: 'codex-project', tool: 'Codex', app: 'codex', detail: project, label: `project ${folder}`, name: `${folder} (Codex)`, where: cwd,
      instructions: path.join(cwd, 'AGENTS.md'), projectDir: cwd, globalRef: 'codex', mcps: [codexMcp('follow')] });
  }

  // Cursor
  if (isDir(path.join(home, '.cursor'))) {
    add({ key: 'cursor', ref: 'cursor', kind: 'cursor', tool: 'Cursor', app: 'cursor', detail: 'every project', label: 'every project', name: 'Cursor', where: path.join(home, '.cursor', 'mcp.json'),
      mcps: [json(path.join(home, '.cursor', 'mcp.json'), { name: 'timewarp-id', tool: 'cursor' })] });
  }
  if (isDir(path.join(cwd, '.cursor'))) {
    add({ key: `cursor-project:${cwd}`, ref: 'cursor:project', kind: 'cursor-project', tool: 'Cursor', app: 'cursor', detail: project, label: `project ${folder}`, name: `${folder} (Cursor)`, where: cwd,
      rule: path.join(cwd, '.cursor', 'rules', `${RULE_FILE}.mdc`), ruleHeader: '---\ndescription: Timewarp Agent ID identity\nalwaysApply: true\n---\n', projectDir: cwd,
      mcps: [json(path.join(cwd, '.cursor', 'mcp.json'), { name: 'timewarp-id', mode: 'agent', tool: 'cursor' })] });
  }

  // Claude Desktop
  const desktop = claudeDesktopConfig(env);
  if (exists(desktop) || isDir(path.dirname(desktop))) {
    add({ key: 'claude-desktop', ref: 'claude-desktop', kind: 'claude-desktop', tool: 'Claude Desktop', app: 'claude-desktop', detail: null, label: 'Claude Desktop', name: 'Claude Desktop', where: desktop,
      mcps: [json(desktop, { name: 'timewarp-id', tool: 'claude-desktop' })] });
  }

  // Other agent tools with an MCP config in the home folder or the editor.
  for (const tool of [...homeTools(env), ...extensionTools(env)]) {
    if (!tool.found) continue;
    add({ key: tool.id, ref: tool.id, kind: 'tool', tool: tool.tool, app: tool.app, detail: tool.detail || 'every project', label: tool.label || 'every project', name: tool.tool,
      where: tool.mcps[0].file, instructions: tool.instructions, rule: tool.rule, ruleHeader: tool.ruleHeader, global: true,
      mcps: tool.mcps.map(mcp => ({ name: 'timewarp-id', ...mcp })) });
  }

  // Timewarp desktop agents: Timewarp's own list when it can be read (only
  // agents that still exist, under their current names), else the folders.
  for (const profile of timewarpProfiles(env)) {
    const live = liveTimewarpAgents(profile);
    if (live) {
      for (const row of live) {
        const workspace = String(row.workspace || ''), instructions = path.join(workspace, 'AGENTS.md');
        if (!workspace || !isDir(workspace)) continue;
        const desktopId = String(row.id), name = String(row.name || '') || headingOf(readText(instructions)) || path.basename(workspace);
        if (targets.some(t => t.kind === 'timewarp' && t.desktopId === desktopId)) continue;
        add({ key: `timewarp:${workspace}`, ref: `timewarp:${desktopId}`, kind: 'timewarp', tool: 'Timewarp', app: 'timewarp', detail: `desktop agent ${name}`, label: name, name, where: workspace,
          instructions, projectDir: workspace, desktopId, commandOnly: true, mcps: [] });
      }
      continue;
    }
    const agentsDir = path.join(profile, 'runtime', 'agents');
    for (const entry of listDir(agentsDir)) {
      if (!entry.isDirectory()) continue;
      const workspace = path.join(agentsDir, entry.name), instructions = path.join(workspace, 'AGENTS.md');
      const text = readText(instructions);
      if (text === null) continue;
      const name = headingOf(text) || entry.name;
      const desktopId = desktopIdOf(entry.name, name);
      if (targets.some(t => t.kind === 'timewarp' && t.desktopId === desktopId)) continue; // The same agent in a second profile copy.
      add({ key: `timewarp:${workspace}`, ref: `timewarp:${desktopId}`, kind: 'timewarp', tool: 'Timewarp', app: 'timewarp', detail: `desktop agent ${name}`, label: name, name, where: workspace,
        instructions, projectDir: workspace, desktopId, commandOnly: true, mcps: [] });
    }
  }

  // OpenClaw workspaces (its agents run commands; it has no MCP config to write).
  const openclaw = path.join(home, '.openclaw');
  for (const entry of listDir(openclaw)) {
    if (!entry.isDirectory() || !/^workspace/.test(entry.name)) continue;
    const workspace = path.join(openclaw, entry.name), instructions = path.join(workspace, 'AGENTS.md');
    if (!exists(instructions)) continue;
    const suffix = entry.name.replace(/^workspace-?/, '');
    const name = suffix ? `OpenClaw (${suffix})` : 'OpenClaw';
    add({ key: `openclaw:${workspace}`, ref: suffix ? `openclaw:${suffix}` : 'openclaw', kind: 'openclaw', tool: 'OpenClaw', app: 'openclaw', detail: `workspace ${entry.name}`, label: `workspace ${entry.name}`, name, where: workspace,
      instructions, projectDir: workspace, commandOnly: true, mcps: [] });
  }

  // Seen, but set up by hand.
  for (const tool of manualTools(env)) {
    add({ key: `manual:${tool.id}`, ref: tool.id, kind: 'manual', tool: tool.tool, app: tool.app, label: 'manual setup', name: tool.tool, where: tool.where, manual: true, mcps: [] });
  }
  return targets;
}

// Any folder, for a custom agent (or a known workspace found by path).
function folderTarget(ctx, dir, targets) {
  const resolved = path.resolve(ctx.cwd, dir);
  if (!isDir(resolved)) throw new UsageError(`${dir} is not a folder.`);
  const known = targets.find(t => (t.kind === 'timewarp' || t.kind === 'openclaw') && t.projectDir === resolved);
  if (known) return known;
  const instructions = ['AGENTS.md', 'CLAUDE.md'].map(name => path.join(resolved, name)).find(exists) || path.join(resolved, 'AGENTS.md');
  const name = (typeof ctx.flags.name === 'string' && ctx.flags.name) || headingOf(readText(instructions)) || path.basename(resolved);
  return { key: `folder:${resolved}`, ref: `folder:${resolved}`, kind: 'folder', tool: 'Folder', app: 'custom', detail: `folder ${shown(resolved)}`, label: name, name, where: resolved, instructions, projectDir: resolved, commandOnly: true, mcps: [] };
}

// A target named by number, ref, name, Timewarp id, handle (detach) or path.
function resolveOne(ctx, arg, targets) {
  if (/^\d+$/.test(arg)) {
    const target = targets[Number(arg) - 1];
    if (!target) throw new UsageError(`There is no number ${arg} in the list (\`timewarp-id agents scan\`).`);
    return target;
  }
  const lower = arg.toLowerCase();
  const want = { 'claude-code': 'claude', desktop: 'claude-desktop', claude_desktop: 'claude-desktop', 'gemini-cli': 'gemini', droid: 'factory', 'copilot-cli': 'copilot', 'grok-bot': 'grokbot', 'kilo-code': 'kilo', 'roo-code': 'roo' }[lower] || lower;
  const bare = want.replace(/^(timewarp|claude-agent|subagent):/, '');
  const matches = [
    t => t.ref.toLowerCase() === want || t.key.toLowerCase() === want,
    t => (t.kind === 'timewarp' || t.kind === 'claude-agent') && ((t.name || '').toLowerCase() === bare || (t.desktopId || '').toLowerCase() === bare),
    t => t.handle && t.handle === bare,
  ];
  for (const match of matches) {
    const found = targets.filter(match);
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new UsageError(`"${arg}" matches ${found.length}: ${found.map(t => short(t.where)).join(', ')}. Name it by its path.`);
  }
  const resolved = path.resolve(ctx.cwd, arg);
  if (exists(resolved)) {
    const known = targets.find(t => t.instructions === resolved || t.where === resolved || t.projectDir === resolved);
    if (known) return known;
    if (isDir(resolved)) return folderTarget(ctx, resolved, targets);
    if (resolved.endsWith('.md') && path.basename(path.dirname(resolved)) === 'agents') return subagent(resolved, 'project', path.join(path.dirname(path.dirname(path.dirname(resolved))), '.mcp.json'));
  }
  throw new UsageError(`Nothing called "${arg}" here. See \`timewarp-id agents scan\`, or name a folder.`);
}

// --- What is attached ---------------------------------------------------------------------
const statePath = env => path.join(homeDir(env), 'attachments.json');
function loadState(env) {
  try { const state = JSON.parse(fs.readFileSync(statePath(env), 'utf8')); return state && typeof state === 'object' && !Array.isArray(state) ? state : {}; }
  catch { return {}; }
}
function saveState(env, state) {
  fs.mkdirSync(homeDir(env), { recursive: true });
  fs.writeFileSync(statePath(env), `${JSON.stringify(state, null, 2)}\n`);
}
const profileById = (config, agentId) => {
  const entry = Object.entries(config.profiles || {}).find(([, p]) => p.agentId === agentId);
  return entry ? { handle: entry[0], ...entry[1] } : null;
};
const instructionsOf = target => target.rule || target.instructions;

// The agent a target is attached to: from the record, else from what it
// carries (the block, the project file, its MCP entry).
function attachedTo(ctx, target, state) {
  const record = state[target.key];
  if (record) return { handle: record.handle, agentId: record.agentId, record };
  const file = instructionsOf(target);
  if (file) {
    const text = readText(file);
    const span = text && blockSpan(text);
    const id = span && AGENT_ID.exec(text.slice(span.start, span.end))?.[0];
    if (id) return { agentId: id, handle: profileById(ctx.config, id)?.handle || /handle ([a-z0-9-]+)\)/.exec(text.slice(span.start, span.end))?.[1] || null };
  }
  if (target.projectDir) {
    try { const agent = JSON.parse(readText(path.join(target.projectDir, PROJECT_FILE)) || 'null')?.agent; if (agent) return { handle: agent }; } catch { /* not ours */ }
  }
  for (const mcp of target.mcps || []) { const handle = mcpAgent(mcp); if (handle) return { handle }; }
  return null;
}

// --- Attach -------------------------------------------------------------------------------
const originOf = (ctx, target) => ({ app: typeof ctx.flags.origin === 'string' ? ctx.flags.origin : target.app, detail: target.detail ?? null });
const APP_SLUG = /^[a-z0-9-]{1,40}$/;

// Without an account on this computer, the agent asks for its Agent ID: a
// link the person opens (no sign-in needed), where confirming their email and
// verifying who they are makes their Timewarp account. The key then comes
// back here. `--claim twc_…` collects one the Agent ID website started.
async function claimAgent(ctx, target, options) {
  if (options.claimed) return { profile: options.claimed, created: false };
  let secret = typeof ctx.flags.claim === 'string' ? ctx.flags.claim.trim() : null;
  if (secret && !secret.startsWith('twc_')) throw new UsageError('--claim takes the twc_… code from the Agent ID website.');
  if (!secret) {
    const name = String((typeof ctx.flags.name === 'string' && ctx.flags.name) || target.name || 'My agent').slice(0, 60);
    const app = originOf(ctx, target).app;
    const started = await ctx.api.post('/v1/claims', { name, ...(APP_SLUG.test(String(app || '')) ? { app } : {}), device: ctx.hostname(), clientName: 'timewarp-id' });
    secret = started.secret;
    ctx.err([
      '',
      `To give ${name} its Agent ID, open this link and follow the steps (no account needed):`,
      `  ${started.url}`,
      `The page should show ${started.claim.matchCode}. Waiting for you… (Ctrl+C to stop)`,
      '',
    ].join('\n'));
    ctx.openUrl(started.url);
  }
  const waitMinutes = Number(ctx.flags.wait) > 0 ? Number(ctx.flags.wait) : 30;
  const deadline = Date.now() + waitMinutes * 60_000;
  for (;;) {
    const result = await ctx.api.post('/v1/claims/collect', { secret });
    if (result.status === 'claimed') {
      saveProfile(ctx, result.agent, result.key);
      options.claimed = findProfile(ctx.config, result.agent.handle);
      return { profile: options.claimed, created: true };
    }
    if (Date.now() >= deadline) throw new CliError('The link wasn\'t finished in time.', { hint: 'Run attach again for a new link.' });
    await ctx.sleep(3000);
  }
}

// An agent made elsewhere (the dashboard, another computer) gets a key for
// this computer, which needs the owner signed in here.
async function keyFor(ctx, ref, why) {
  if (!ctx.hasOwnerKey()) {
    throw new CliError(`${why}, and there is no key for it on this computer.`, { hint: `Sign in with \`timewarp-id login --owner-key two_…\` and run this again: attach then gets a key for ${ref} here.` });
  }
  const id = await ctx.agentIdFor(ref);
  const { agent } = await ctx.owner.get(`/v1/agents/${id}`);
  const created = await ctx.owner.post(`/v1/agents/${id}/keys`, { name: ctx.hostname() });
  saveProfile(ctx, agent, created.secret);
  return { profile: findProfile(ctx.config, agent.handle), created: false, keyed: true };
}

async function agentFor(ctx, target, current, options) {
  const named = async ref => {
    const profile = findProfile(ctx.config, ref);
    return profile ? { profile, created: false } : keyFor(ctx, ref, `"${ref}" is not on this computer yet`);
  };
  if (options.agentRef) return named(options.agentRef);
  if (typeof ctx.flags.claim === 'string') return claimAgent(ctx, target, options);
  if (current) {
    const profile = (current.agentId && profileById(ctx.config, current.agentId)) || (current.handle && findProfile(ctx.config, current.handle));
    if (profile) return { profile, created: false };
    return keyFor(ctx, current.agentId || current.handle, `${target.tool} ${target.label} is attached to ${current.handle || current.agentId}`);
  }
  // Not signed in here: one link sets up one Agent ID for everything chosen.
  if (!ctx.hasOwnerKey()) return claimAgent(ctx, target, options);
  const name = String((typeof ctx.flags.name === 'string' && ctx.flags.name) || target.name).slice(0, 60);
  if (ctx.interactive && !ctx.flags.yes) {
    const answer = (await ctx.ask(`Agent ID for ${target.tool} ${target.label}: Enter for a new one named "${name}", or an existing agent's handle: `)).trim();
    if (answer) return named(answer);
  }
  const origin = originOf(ctx, target);
  const runtime = typeof ctx.flags.runtime === 'string' ? ctx.flags.runtime : origin.app;
  const created = await withTerms(ctx, () => sendWithOrigin(body => ctx.owner.post('/v1/agents', body), {
    name, runtime, origin, keyName: ctx.hostname(), ...(target.desktopId ? { desktopAgentId: target.desktopId.slice(0, 100) } : {}),
  }));
  saveProfile(ctx, created.agent, created.secret);
  return { profile: findProfile(ctx.config, created.agent.handle), created: true };
}

async function toolNames(ctx, key) {
  const answer = await ctx.api.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: key });
  return (answer?.result?.tools || []).map(tool => tool.name).filter(name => /^[A-Za-z0-9_-]+$/.test(name));
}

async function attachOne(ctx, target, state, options) {
  if (target.manual) {
    throw new CliError(`${target.tool} is here, but attach can't write its MCP setup. Add this MCP server in ${target.tool}'s settings (${short(target.where)}):\n${snippet(options.agentRef)}`);
  }
  const current = attachedTo(ctx, target, state);
  const { profile, created } = await agentFor(ctx, target, current, options);
  const handle = profile.handle, key = profile.key;
  const given = [];
  if (options.give.length && !ctx.hasOwnerKey()) throw new CliError(`${profile.name || handle} is set up, but giving it mail, a number or a wallet needs you signed in here.`, { hint: 'Add them on the Agent ID website, or run `timewarp-id login --owner-key two_…` first.' });
  for (const kind of options.give) {
    if (kind === 'card' && !options.test) throw new UsageError('Cards are applied for: `timewarp-id card apply --agent <agent> --use-case "…" --monthly 200 --country US`.');
    try { await ctx.owner.post(`/v1/agents/${profile.agentId}/resources`, { kind, mode: options.test ? 'test' : 'live' }); given.push(kind); }
    catch (error) { if (!(error instanceof ApiError && error.code === 'already_has')) throw error; }
  }
  const me = await ctx.api.get('/v1/me', { token: key });
  const earlier = state[target.key]?.handle === handle ? state[target.key].changes || [] : [];
  const findEarlier = (type, file, name) => earlier.find(c => c.type === type && c.file === file && (name === undefined || c.name === name));
  const changes = [], wrote = [], notes = [];

  let server = null;
  for (const mcp of target.mcps) {
    const result = writeMcp(ctx, target, mcp, handle, findEarlier('mcp', mcp.file, mcpName(mcp, handle)));
    changes.push(result.change);
    wrote.push([result.file, result.note]);
    if (result.pinned) notes.push(result.note);
    else server ??= result.change.name;
  }

  if (target.subagent && server) {
    const before = readText(target.instructions);
    const names = await toolNames(ctx, key);
    const { text, listed } = setSubagentTools(before, server, names);
    if (listed) {
      if (text !== before) writeText(target.instructions, text);
      changes.push({ type: 'tools', file: target.instructions, server });
      wrote.push([target.instructions, `${names.length} ${server} tools in its tools: list`]);
    }
  }

  const instructions = instructionsOf(target);
  if (instructions) {
    const block = identityBlock(me, { server: target.commandOnly ? null : server, global: target.global });
    const before = readText(instructions);
    // A rule file is Agent ID's own.
    const after = target.rule ? `${target.ruleHeader || ''}${block}\n` : upsertBlock(before || '', block);
    if (after !== before) writeText(instructions, after);
    const prior = findEarlier('block', instructions);
    changes.push({ type: 'block', file: instructions, createdFile: prior ? prior.createdFile : before === null, rule: !!target.rule, agentId: profile.agentId });
    wrote.push([instructions, 'identity block']);
  }

  if (target.projectDir) {
    const file = path.join(target.projectDir, PROJECT_FILE);
    const before = readText(file);
    let previousAgent = null;
    try { previousAgent = before ? JSON.parse(before).agent || null : null; } catch { /* replaced */ }
    const prior = findEarlier('project', file);
    writeText(file, `${JSON.stringify({ agent: handle }, null, 2)}\n`);
    changes.push({ type: 'project', file, previous: prior ? prior.previous : (previousAgent && previousAgent !== handle ? before : null) });
    wrote.push([file, `timewarp-id here acts as ${handle}${previousAgent && previousAgent !== handle ? ` (was ${previousAgent})` : ''}`]);
  }

  // One Agent ID, many apps: this one is listed on the dashboard from now on.
  if (APP_SLUG.test(String(target.app || ''))) await ctx.api.post('/v1/me/apps', { app: target.app }, { token: key }).catch(() => {});

  // Where the agent comes from, for the dashboard (and the desktop link).
  if (ctx.hasOwnerKey()) {
    const origin = originOf(ctx, target);
    const patch = { origin, ...(target.desktopId ? { desktopAgentId: target.desktopId.slice(0, 100), runtime: 'timewarp' } : {}) };
    if (!created || target.desktopId) await sendWithOrigin(body => ctx.owner.patch(`/v1/agents/${profile.agentId}`, body), patch);
    wrote.push([null, `origin: ${origin.app}${origin.detail ? `, ${origin.detail}` : ''}`]);
    if (target.desktopId) {
      changes.push({ type: 'link', desktopAgentId: target.desktopId });
      wrote.push([null, `linked to Timewarp desktop agent ${target.desktopId}`]);
    }
  } else if (target.desktopId) notes.push('Sign in (`timewarp-id login`) to link it to its Timewarp desktop agent.');

  if (target.kind === 'timewarp') notes.push('Timewarp agents get no MCP server of their own yet: they use the `timewarp-id` command in their workspace, which the .timewarp-id.json there makes act as them.');
  if (target.kind === 'openclaw') notes.push(`OpenClaw agents use the \`timewarp-id\` command in their workspace, which acts as them there. For MCP tools, add this to OpenClaw:\n${snippet(handle)}`);
  if (target.kind === 'folder') notes.push('A custom agent uses the `timewarp-id` command in this folder, which acts as it; or connect its tool with `timewarp-id connect`.');
  if (target.kind === 'claude-project') notes.push('Claude Code asks once before it uses a project\'s MCP server.');
  if (target.mcps.length && !target.subagent && target.kind !== 'claude-project') notes.push(`Restart ${target.tool} to load it.`);

  state[target.key] = {
    target: { key: target.key, ref: target.ref, kind: target.kind, tool: target.tool, app: target.app, label: target.label, where: target.where, instructions: target.instructions, rule: target.rule, projectDir: target.projectDir, mcps: target.mcps, subagent: !!target.subagent, desktopId: target.desktopId, commandOnly: !!target.commandOnly },
    handle, agentId: profile.agentId, at: new Date().toISOString(), changes,
  };
  return { target, agent: { id: me.agent.id, handle, name: me.agent.name, created }, given, wrote, notes };
}

const parseGive = value => {
  if (value === undefined) return [];
  const kinds = String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const wrong = kinds.find(kind => !KINDS.includes(kind));
  if (wrong) throw new UsageError(`--give takes ${KINDS.join(', ')} (comma-separated), not "${wrong}".`);
  return [...new Set(kinds)];
};

function listing(ctx, targets, state) {
  return targets.map((target, i) => {
    const current = target.manual ? null : attachedTo(ctx, target, state);
    return {
      number: i + 1, ref: target.ref, tool: target.tool, app: target.app, agent: target.label, description: target.description || undefined, where: target.where,
      attached: current ? current.handle || current.agentId : null, ...(target.manual ? { manual: true, snippet: snippet() } : {}),
    };
  });
}
const listingText = rows => table(rows, [
  ['#', r => r.number], ['TOOL', r => r.tool], ['AGENT', r => r.agent], ['AGENT ID', r => r.manual ? 'manual setup' : r.attached], ['REF', r => r.ref], ['WHERE', r => short(r.where)],
]);

export async function scan(ctx) {
  const state = loadState(ctx.env);
  const rows = listing(ctx, discover(ctx), state);
  const manual = rows.filter(r => r.manual);
  ctx.print({ targets: rows }, () => rows.length
    ? [
      listingText(rows), '',
      'Give one an Agent ID: `timewarp-id attach <# or ref>` (or a folder: `timewarp-id attach --here`).',
      ...(manual.length ? [`Found, manual setup: ${manual.map(r => r.tool).join(', ')}. Add this MCP server in their settings:`, snippet()] : []),
    ].join('\n')
    : 'No agents found here. Give a folder\'s agent an Agent ID with `timewarp-id attach --here`.');
}

async function choose(ctx, targets, state, verb) {
  const chosen = [];
  const add = target => { if (!chosen.some(t => t.key === target.key)) chosen.push(target); };
  if (ctx.flags.here) add(folderTarget(ctx, ctx.cwd, targets));
  for (const arg of ctx.args) add(resolveOne(ctx, arg, targets));
  if (chosen.length) return chosen;
  const rows = listing(ctx, targets, state);
  if (!ctx.json) ctx.out(rows.length ? listingText(rows) : 'No agents found here.');
  if (!ctx.interactive || !rows.length) throw new UsageError(`Name what to ${verb}: a number or ref from the list, or a folder (e.g. \`timewarp-id ${verb} claude\`, \`timewarp-id ${verb} --here\`).`);
  const answer = await ctx.ask(`${verb === 'attach' ? 'Attach' : 'Detach'} which? Numbers like 1,3 (Enter to stop): `);
  for (const part of answer.split(/[\s,]+/).filter(Boolean)) add(resolveOne(ctx, part, targets));
  return chosen;
}

export async function attach(ctx) {
  const options = { agentRef: typeof ctx.flags.agent === 'string' ? ctx.flags.agent : null, give: parseGive(ctx.flags.give), test: !!ctx.flags.test, claimed: null };
  if (options.agentRef && typeof ctx.flags.claim === 'string') throw new UsageError('Use --agent or --claim, not both.');
  if (typeof ctx.flags.runtime === 'string' && ![...APPS, 'other', 'any'].includes(ctx.flags.runtime)) throw new UsageError(`--runtime is one of ${APPS.join(', ')}.`);
  if (typeof ctx.flags.origin === 'string' && !APPS.includes(ctx.flags.origin)) throw new UsageError(`--origin is one of ${APPS.join(', ')}.`);
  const state = loadState(ctx.env);
  const targets = discover(ctx);
  const chosen = await choose(ctx, targets, state, 'attach');
  if (!chosen.length) return 0;
  // Signed in, each gets its own new Agent ID; through a link they share one.
  if (typeof ctx.flags.name === 'string' && chosen.length > 1 && ctx.hasOwnerKey() && typeof ctx.flags.claim !== 'string') throw new UsageError('--name names one agent; attach one at a time.');
  const results = [];
  try {
    for (const target of chosen) results.push(await attachOne(ctx, target, state, options));
  } finally {
    saveState(ctx.env, state);
  }
  ctx.print({ attached: results.map(r => ({ ref: r.target.ref, tool: r.target.tool, label: r.target.label, origin: { app: r.target.app, detail: r.target.detail ?? null }, agent: r.agent, given: r.given, wrote: r.wrote.map(([file, what]) => ({ file, what })), notes: r.notes })) }, () => results.map(r => [
    `${r.target.tool} ${r.target.label} → Agent ID ${r.agent.name} (${r.agent.handle}, ${r.agent.id})${r.agent.created ? ', new' : ''}`,
    ...r.wrote.map(([file, what]) => `  ${file ? `${short(file)}: ` : ''}${what}`),
    ...(r.given.length ? [`  gave it: ${r.given.join(', ')}${options.test ? ' (test)' : ''}`] : []),
    ...r.notes.map(note => `  ${note.replace(/\n/g, '\n  ')}`),
  ].join('\n')).join('\n\n'));
}

// --- Detach -------------------------------------------------------------------------------
// The changes attach would have made, for something attached without a record.
function inferredChanges(ctx, target, handle) {
  const changes = [];
  for (const mcp of target.mcps || []) {
    if (!handle || (mcp.format === 'toml' && mcp.mode === 'follow')) continue;
    changes.push({ type: 'mcp', file: mcp.file, format: mcp.format, name: mcpName(mcp, handle), app: target.app, mcp, previous: null, createdFile: false });
  }
  if (target.subagent && handle) changes.push({ type: 'tools', file: target.instructions, server: mcpName(target.mcps[0], handle) });
  const instructions = instructionsOf(target);
  if (instructions) changes.push({ type: 'block', file: instructions, createdFile: false, rule: !!target.rule });
  if (target.projectDir) changes.push({ type: 'project', file: path.join(target.projectDir, PROJECT_FILE), previous: null });
  return changes;
}

function detachOne(ctx, target, state) {
  const record = state[target.key];
  const current = record ? { handle: record.handle, agentId: record.agentId } : attachedTo(ctx, target, state);
  if (!current) return { target, handle: null, undone: [] };
  const handle = current.handle;
  const changes = record?.changes || inferredChanges(ctx, target, handle);
  const others = Object.entries(state).filter(([key]) => key !== target.key).map(([, other]) => other);
  const undone = [];
  for (const change of changes) {
    if (change.type === 'mcp') {
      const stillUsed = others.some(other => (other.changes || []).some(c => c.type === 'mcp' && c.file === change.file && c.name === change.name));
      const done = removeMcp(ctx, change, handle, stillUsed);
      if (done) undone.push(done);
    } else if (change.type === 'tools') {
      const before = readText(change.file);
      if (before === null) continue;
      const { text } = setSubagentTools(before, change.server, []);
      if (text !== before) { writeText(change.file, text); undone.push(`${short(change.file)}: removed its ${change.server} tools`); }
    } else if (change.type === 'block') {
      const before = readText(change.file);
      const span = before && blockSpan(before);
      if (!span) continue;
      // Only this agent's block: another agent may have been attached to the same file since.
      const id = AGENT_ID.exec(before.slice(span.start, span.end))?.[0];
      if (current.agentId && id && id !== current.agentId) continue;
      // Tools sharing an instructions file (Gemini CLI and Antigravity) keep it while one is attached.
      if (others.some(other => other.agentId === id && (other.changes || []).some(c => c.type === 'block' && c.file === change.file))) continue;
      const after = change.rule ? '' : removeBlock(before);
      if (!after.trim()) fs.rmSync(change.file, { force: true });
      else writeText(change.file, after);
      undone.push(`${short(change.file)}: removed the identity block${!after.trim() ? ' (and the file it was alone in)' : ''}`);
    } else if (change.type === 'project') {
      // Claude Code and Codex in one folder share it.
      if (others.some(other => other.handle === handle && (other.changes || []).some(c => c.type === 'project' && c.file === change.file))) continue;
      const before = readText(change.file);
      let agent = null;
      try { agent = before ? JSON.parse(before).agent : null; } catch { /* not ours */ }
      if (!agent || (handle && agent !== handle)) continue;
      if (change.previous) writeText(change.file, change.previous);
      else fs.rmSync(change.file, { force: true });
      undone.push(`${short(change.file)}: ${change.previous ? 'restored' : 'removed'}`);
    }
  }
  delete state[target.key];
  return { target, handle, undone };
}

export async function detach(ctx) {
  const state = loadState(ctx.env);
  const discovered = discover(ctx).filter(t => !t.manual);
  // Recorded attachments count too, wherever they are, and match by handle.
  const recorded = Object.entries(state).map(([key, record]) => ({ ...(discovered.find(t => t.key === key) || { mcps: [], ...record.target } || { key, ref: key, tool: '', label: key, mcps: [] }), handle: record.handle }));
  const targets = [...recorded, ...discovered.filter(t => !state[t.key] && attachedTo(ctx, t, state))];
  let chosen;
  if (ctx.flags.all) chosen = targets;
  else {
    const byHandle = ctx.args.length && ctx.args.every(arg => targets.some(t => t.handle === arg)) ? targets.filter(t => ctx.args.includes(t.handle)) : null;
    chosen = byHandle || await choose(ctx, targets, state, 'detach');
  }
  const results = [];
  try {
    for (const target of chosen) results.push(detachOne(ctx, target, state));
  } finally {
    saveState(ctx.env, state);
  }
  ctx.print({ detached: results.map(r => ({ ref: r.target.ref, agent: r.handle, undone: r.undone })) }, () => results.map(r => r.handle
    ? [`${r.target.tool} ${r.target.label}: detached from ${r.handle}`, ...r.undone.map(line => `  ${line}`), '  The Agent ID itself is kept; `timewarp-id agents revoke` ends it.'].join('\n')
    : `${r.target.tool} ${r.target.label}: nothing attached`).join('\n\n'));
}
