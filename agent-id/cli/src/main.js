// timewarp-id: the command line for Timewarp Agent ID.
import os from 'node:os';
import readline from 'node:readline';
import { parseArgs } from './args.js';
import { Api } from './api.js';
import { ApiError, CliError, UsageError, hintFor } from './errors.js';
import { apiBase, DASHBOARD, findProfile, loadConfig, saveConfig, selectAgent } from './config.js';
import { COMMANDS, MAIN } from './help.js';
import { VERSION } from './version.js';
import { hostTool } from './origin.js';
import * as account from './commands/account.js';
import * as act from './commands/act.js';
import { mcp } from './commands/mcp.js';
import { connect } from './commands/connect.js';
import { git } from './commands/git.js';
import * as attaching from './commands/attach.js';
import { terms } from './terms.js';

const ROUTES = {
  attach: attaching.attach, detach: attaching.detach, terms,
  login: account.login, logout: account.logout, whoami: account.whoami, agents: account.agents,
  give: account.give, take: account.take, limits: account.limits, fund: account.fund,
  approvals: account.approvals, approve: account.approve, deny: account.deny, use: account.use,
  me: act.me, mail: act.mail, sms: act.sms, call: act.call, contacts: act.contacts,
  wallet: act.wallet, card: act.card, vm: act.vm, passport: act.passport,
  mcp, connect, git,
};
const ALIASES = { agent: 'agents', calls: 'call', contact: 'contacts', machine: 'vm', approval: 'approvals', apply: 'attach', unapply: 'detach' };
// After these, a one-line notice says when transfers wait for the owner.
const NO_NOTICE = new Set(['approvals', 'logout', 'mcp', 'passport']);
const AGENT_ID = /^agt_[a-z0-9]{24}$/;

const readAll = async stream => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
};

export function createContext({ env = process.env, cwd = process.cwd(), flags = {}, args = [], rest = [], stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, fetch = globalThis.fetch, command = '' } = {}) {
  let config = null, api = null, selected = null;
  const out = text => { stdout.write(String(text).endsWith('\n') ? String(text) : `${text}\n`); };
  const err = text => { stderr.write(String(text).endsWith('\n') ? String(text) : `${text}\n`); };
  const ctx = {
    command, env, cwd, flags, args, rest, stdout, stderr, stdin, out, err,
    json: flags.json === true,
    as: 'owner',
    get config() { return config ??= loadConfig(env); },
    save() { saveConfig(ctx.config, env); },
    get apiBase() { return apiBase(flags, env, ctx.config); },
    tool: hostTool(env),
    get api() { return api ??= new Api(ctx.apiBase, fetch, { tool: ctx.tool }); },
    readStdin: () => readAll(stdin),
    // Questions only in a terminal; prompts go to stderr so stdout stays clean.
    interactive: !!(stdin?.isTTY && stderr?.isTTY) && flags.json !== true,
    ask: question => new Promise(resolve => {
      const rl = readline.createInterface({ input: stdin, output: stderr, terminal: true });
      rl.question(question, answer => { rl.close(); resolve(answer); });
      rl.on('close', () => resolve(''));
    }),
    ownerUsed: false,
    hostname: () => { try { return os.hostname().slice(0, 40) || 'this computer'; } catch { return 'this computer'; } },

    ownerKey() {
      const key = env.TIMEWARP_OWNER_KEY || ctx.config.ownerKey;
      if (!key) throw new CliError('You are not signed in.', { hint: `Create an owner key on the Agent ID dashboard (${DASHBOARD}) and run \`timewarp-id login --owner-key two_…\`.` });
      ctx.ownerUsed = true;
      return key;
    },
    hasOwnerKey: () => !!(env.TIMEWARP_OWNER_KEY || ctx.config.ownerKey),
    agent() { return selected ??= selectAgent(ctx.config, { flags, env, cwd }); },

    // Requests as the owner, or as the selected agent.
    owner: {
      get: (path, options = {}) => { ctx.as = 'owner'; return ctx.api.get(path, { ...options, token: ctx.ownerKey() }); },
      post: (path, body, options = {}) => { ctx.as = 'owner'; return ctx.api.post(path, body, { ...options, token: ctx.ownerKey() }); },
      patch: (path, body, options = {}) => { ctx.as = 'owner'; return ctx.api.patch(path, body, { ...options, token: ctx.ownerKey() }); },
      delete: (path, options = {}) => { ctx.as = 'owner'; return ctx.api.delete(path, { ...options, token: ctx.ownerKey() }); },
    },
    self: {
      get: (path, options = {}) => { ctx.as = 'agent'; return ctx.api.get(path, { ...options, token: ctx.agent().key }); },
      post: (path, body, options = {}) => { ctx.as = 'agent'; return ctx.api.post(path, body, { ...options, token: ctx.agent().key }); },
      patch: (path, body, options = {}) => { ctx.as = 'agent'; return ctx.api.patch(path, body, { ...options, token: ctx.agent().key }); },
      delete: (path, options = {}) => { ctx.as = 'agent'; return ctx.api.delete(path, { ...options, token: ctx.agent().key }); },
      upload: (path, raw, headers) => { ctx.as = 'agent'; return ctx.api.request('POST', path, { raw, headers, token: ctx.agent().key }); },
    },

    // An owner command's agent: the one named (handle, id, name, or a unique
    // handle prefix), else the agent commands act as.
    async agentIdFor(ref = typeof flags.agent === 'string' ? flags.agent : null) {
      if (!ref) {
        const chosen = ctx.agent();
        if (chosen.agentId) return chosen.agentId;
        return (await ctx.self.get('/v1/me')).agent.id;
      }
      if (AGENT_ID.test(ref)) return ref;
      const profile = findProfile(ctx.config, ref);
      if (profile?.agentId) return profile.agentId;
      const { agents } = await ctx.owner.get('/v1/agents', { query: { status: 'all' } });
      const lower = ref.toLowerCase();
      const pick = list => {
        const live = list.filter(a => a.status !== 'revoked');
        if (live.length === 1) return live[0];
        if (live.length > 1) throw new CliError(`"${ref}" matches more than one agent: ${live.map(a => a.handle).join(', ')}.`, { hint: 'Use the full handle or the agent id.' });
        return list.length === 1 ? list[0] : null;
      };
      const match = pick(agents.filter(a => a.handle === lower)) || pick(agents.filter(a => a.name.toLowerCase() === lower)) || pick(agents.filter(a => a.handle.startsWith(lower)));
      if (!match) throw new CliError(`You have no agent called "${ref}".`, { hint: 'See `timewarp-id agents list`.' });
      return match.id;
    },

    // --json prints Agent ID's answer; otherwise `human` turns it into text.
    print(data, human) {
      if (ctx.json) return out(JSON.stringify(data, null, 2));
      const text = human ? human(data) : undefined;
      if (text) out(text);
    },
  };
  return ctx;
}

// "2 approvals waiting" on stderr, when the owner has transfers to answer.
async function approvalsNotice(ctx) {
  try {
    if (!ctx.hasOwnerKey()) return;
    const { approvals } = await ctx.api.get('/v1/approvals', { token: ctx.env.TIMEWARP_OWNER_KEY || ctx.config.ownerKey });
    const count = Array.isArray(approvals) ? approvals.length : 0;
    if (count) ctx.err(`${count} approval${count === 1 ? '' : 's'} waiting — run \`timewarp-id approvals\``);
  } catch { /* only a reminder */ }
}

export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr;
  const err = text => stderr.write(`${text}\n`);
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) { err(`Error: ${error.message}`); return 2; }
  const { positionals, flags, rest } = parsed;
  if (flags.version) { stdout.write(`${VERSION}\n`); return 0; }
  let [command, ...args] = positionals;
  if (command === 'help') { command = args[0]; args = []; flags.help = true; }
  if (!command) { stdout.write(`${MAIN}\n`); return 0; }
  command = ALIASES[command] || command;
  let run = ROUTES[command];
  if (!run) { err(`Error: there is no command "${command}".`); err('Run `timewarp-id --help` to see them all.'); return 2; }
  if (flags.help) { stdout.write(`${COMMANDS[command] || MAIN}\n`); return 0; }
  if (command === 'agents' && args[0] === 'scan') { run = attaching.scan; args = args.slice(1); }

  const ctx = createContext({ ...io, flags, args, rest, command });
  try {
    const code = await run(ctx);
    if (!NO_NOTICE.has(command) && (ctx.ownerUsed || command === 'attach')) await approvalsNotice(ctx);
    return typeof code === 'number' ? code : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`Error: ${error.message}`);
      err(COMMANDS[command] ? `\n${COMMANDS[command]}` : 'Run `timewarp-id --help`.');
      return 2;
    }
    if (error instanceof ApiError || error instanceof CliError) {
      if (ctx.json) stdout.write(`${JSON.stringify({ error: { code: error.code || 'error', message: error.message, ...(error.status ? { status: error.status } : {}) } }, null, 2)}\n`);
      err(`Error: ${error.message}${error instanceof ApiError ? ` (${error.code})` : ''}`);
      const hint = hintFor(error, ctx.as);
      if (hint) err(hint);
      return 1;
    }
    err(`Error: ${error?.stack || error}`);
    return 1;
  }
}
