// The CLI's own files: ~/.timewarp-id/config.json (or $TIMEWARP_ID_HOME),
// holding the owner key and one profile per agent with that agent's key.
// Which agent a command acts as: TIMEWARP_AGENT_KEY, else --agent, else the
// nearest .timewarp-id.json above the working directory, else the default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './errors.js';

export const DEFAULT_API = 'https://mrqoeywofslgnquvzhuf.supabase.co/functions/v1/agent-id';
export const PROJECT_FILE = '.timewarp-id.json';
export const DASHBOARD = 'https://timewarpdev.com/agent-id';

export const homeDir = (env = process.env) => env.TIMEWARP_ID_HOME || path.join(os.homedir(), '.timewarp-id');
export const configPath = (env = process.env) => path.join(homeDir(env), 'config.json');

export function loadConfig(env = process.env) {
  const file = configPath(env);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { profiles: {} }; throw error; }
  let config;
  try { config = JSON.parse(raw); } catch { throw new CliError(`${file} is not valid JSON.`, { hint: 'Fix it by hand, or delete it and log in again.' }); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new CliError(`${file} is not a Timewarp ID config.`);
  if (!config.profiles || typeof config.profiles !== 'object') config.profiles = {};
  return config;
}

// Written whole to a temporary file and renamed over the old one, readable
// by this user only where the OS supports it.
export function saveConfig(config, env = process.env) {
  const dir = homeDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath(env);
  const temp = `${file}.${process.pid}.tmp`;
  const clean = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined && value !== null));
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(temp, 0o600); } catch { /* Windows */ }
  fs.renameSync(temp, file);
}

export const apiBase = (flags, env, config) => String(flags.api || env.AGENT_ID_API || config.api || DEFAULT_API).replace(/\/+$/, '');

// --- Profiles --------------------------------------------------------------------
// An agent named by handle, id, name, or a handle prefix only one agent has.
export function findProfile(config, ref) {
  if (!ref) return null;
  const entries = Object.entries(config.profiles || {});
  const want = String(ref).trim();
  const lower = want.toLowerCase();
  const as = ([handle, profile]) => ({ handle, ...profile });
  const exact = entries.find(([handle, p]) => handle === want || p.agentId === want);
  if (exact) return as(exact);
  const byName = entries.filter(([, p]) => String(p.name || '').toLowerCase() === lower);
  if (byName.length === 1) return as(byName[0]);
  const byPrefix = entries.filter(([handle]) => handle.startsWith(lower));
  if (byPrefix.length === 1) return as(byPrefix[0]);
  if (byName.length > 1 || byPrefix.length > 1) throw new CliError(`"${want}" matches more than one agent: ${[...byName, ...byPrefix].map(([h]) => h).join(', ')}.`, { hint: 'Use the full handle.' });
  return null;
}

// The nearest .timewarp-id.json from `start` up to the filesystem root.
export function findProjectFile(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const file = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(file)) {
      let data;
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new CliError(`${file} is not valid JSON.`, { hint: 'It should look like { "agent": "<handle>" }.' }); }
      if (!data || typeof data.agent !== 'string' || !data.agent.trim()) throw new CliError(`${file} doesn't name an agent.`, { hint: 'It should look like { "agent": "<handle>" }.' });
      return { file, agent: data.agent.trim() };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The agent a command acts as, with its key.
export function selectAgent(config, { flags = {}, env = process.env, cwd = process.cwd() } = {}) {
  if (env.TIMEWARP_AGENT_KEY) return { key: env.TIMEWARP_AGENT_KEY.trim(), source: 'TIMEWARP_AGENT_KEY', handle: null, agentId: null, name: null };
  let ref = typeof flags.agent === 'string' ? flags.agent : null, source = '--agent';
  if (!ref) {
    const project = findProjectFile(cwd);
    if (project) { ref = project.agent; source = project.file; }
  }
  // --default-agent: what a tool-wide MCP entry acts as outside such projects.
  if (!ref && typeof flags['default-agent'] === 'string') { ref = flags['default-agent']; source = '--default-agent'; }
  if (!ref && config.default) { ref = config.default; source = 'default'; }
  if (!ref) {
    throw new CliError('No agent selected.', { hint: Object.keys(config.profiles || {}).length
      ? 'Pick one with --agent <handle>, or `timewarp-id use <handle>` (see `timewarp-id agents list`).'
      : 'Create one with `timewarp-id agents create <name>` (after `timewarp-id login`).' });
  }
  const profile = findProfile(config, ref);
  if (!profile) {
    throw new CliError(`There is no key for agent "${ref}" on this computer${source === '--agent' ? '' : ` (chosen by ${source})`}.`, {
      hint: `If the agent exists, get a key for it with \`timewarp-id agents key ${ref}\`; \`timewarp-id agents list\` shows your agents.`,
    });
  }
  if (!profile.key) throw new CliError(`The profile for "${profile.handle}" has no key.`, { hint: `Run \`timewarp-id agents key ${profile.handle}\`.` });
  return { ...profile, source };
}
