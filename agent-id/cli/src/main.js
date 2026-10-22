// timewarp-id: the command line for Timewarp Agent ID.
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { parseArgs } from './args.js';
import { Api } from './api.js';
import { ApiError, CliError, UsageError, hintFor } from './errors.js';
import { apiBase, DASHBOARD, findProfile, loadConfig, saveConfig, selectAgent } from './config.js';
import { COMMANDS, fullHelp, quickHelp, usageOf, WELCOME } from './help.js';
import { VERSION } from './version.js';
import { hostTool } from './origin.js';
import * as account from './commands/account.js';
import * as act from './commands/act.js';
import { mcp } from './commands/mcp.js';
import { memory } from './commands/memory.js';
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
  wallet: act.wallet, card: act.card, vm: act.vm, vault: act.vault, memory, passport: act.passport,
  mcp, connect, git,
};
const ALIASES = { agent: 'agents', calls: 'call', contact: 'contacts', machine: 'vm', approval: 'approvals', apply: 'attach', unapply: 'detach', memories: 'memory' };
// After these, a one-line notice says when transfers wait for the owner.
const NO_NOTICE = new Set(['approvals', 'logout', 'mcp', 'passport']);
const AGENT_ID = /^agt_[a-z0-9]{24}$/;
// App names people may type as a command, meaning `attach <app>`.
const APP_REFS = new Set(['claude', 'claude-code', 'codex', 'cursor', 'claude-desktop', 'gemini', 'antigravity', 'windsurf', 'opencode', 'grok', 'kiro', 'qwen', 'factory', 'copilot', 'amazonq', 'continue', 'cline', 'roo', 'kilo', 'openclaw']);

// What the person types to run this again (npx runs it as `npm exec`).
export const binName = (env = process.env) => env.npm_command === 'exec' || env.npm_lifecycle_event === 'npx' ? 'npx @timewarp/agent-id' : 'timewarp-id';

// Edits between two words, for "did you mean".
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// "There is no command", with the one they probably meant.
export function unknownCommand(word, bin = 'timewarp-id') {
  const lower = String(word).toLowerCase();
  if (APP_REFS.has(lower)) return `There is no command "${word}". To give that app an Agent ID, run: ${bin} attach ${lower}`;
  if (lower === 'scan') return `There is no command "${word}". Did you mean: ${bin} agents scan`;
  const near = [...Object.keys(ROUTES), 'help']
    .map(name => [name, distance(lower, name)])
    .filter(([name, edits]) => edits <= Math.max(1, Math.floor(name.length / 3)) || (lower.length >= 3 && name.startsWith(lower)))
    .sort((a, b) => a[1] - b[1]);
  return [`There is no command "${word}".${near.length ? ` Did you mean: ${bin} ${near[0][0]}` : ''}`, `See all commands: ${bin} help`].join('\n');
}

// Opens a link in the default browser; the link is printed too, so a
// computer without one still works.
function openInBrowser(url) {
  try {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch { /* printed anyway */ }
}

const readAll = async stream => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
};

// A question in the terminal. Resolves the line typed, or null when input
// ends without one; Ctrl+C stops the command, as anywhere in a terminal.
const askIn = (stdin, stderr) => question => new Promise(resolve => {
  const rl = readline.createInterface({ input: stdin, output: stderr, terminal: true });
  let answered = false;
  rl.question(question, answer => { answered = true; rl.close(); resolve(answer); });
  rl.on('close', () => { if (!answered) resolve(null); });
  rl.on('SIGINT', () => { stderr.write('\n'); process.exit(130); });
});

// A secret typed in the terminal: the question shows, what's typed doesn't.
const askHiddenIn = (stdin, stderr) => question => new Promise(resolve => {
  const rl = readline.createInterface({ input: stdin, output: stderr, terminal: true });
  let answered = false, muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = text => { if (!muted) write(text); };
  rl.question(question, answer => { answered = true; rl.close(); stderr.write('\n'); resolve(answer); });
  muted = true;
  rl.on('close', () => { if (!answered) resolve(null); });
  rl.on('SIGINT', () => { stderr.write('\n'); process.exit(130); });
});

export function createContext({ env = process.env, cwd = process.cwd(), flags = {}, args = [], rest = [], stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, fetch = globalThis.fetch, command = '', sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), openUrl = openInBrowser, ask = null, askSecret = null } = {}) {
  let config = null, api = null, selected = null;
  const out = text => { stdout.write(String(text).endsWith('\n') ? String(text) : `${text}\n`); };
  const err = text => { stderr.write(String(text).endsWith('\n') ? String(text) : `${text}\n`); };
  const ctx = {
    command, env, cwd, flags, args, rest, stdout, stderr, stdin, out, err,
    bin: binName(env),
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
    ask: ask || askIn(stdin, stderr),
    askSecret: askSecret || askHiddenIn(stdin, stderr),
    ownerUsed: false,
    sleep,
    // Only from a terminal: scripts and tests just get the printed link.
    // Says whether it tried.
    openUrl: url => { if (!stderr?.isTTY || env.CI) return false; openUrl(url); return true; },
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
    if (count) ctx.err(`${count} approval${count === 1 ? '' : 's'} waiting — run \`${ctx.bin} approvals\``);
  } catch { /* only a reminder */ }
}

export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr;
  const err = text => stderr.write(`${text}\n`);
  const bin = binName(io.env || process.env);
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) { err(`Error: ${error.message}`); return 2; }
  const { positionals, flags, rest } = parsed;
  if (flags.version) { stdout.write(`${VERSION}\n`); return 0; }
  let [command, ...args] = positionals;
  if (command === 'help') { command = args[0] === 'help' ? undefined : args[0]; args = []; flags.help = true; }
  if (!command && flags.help) { stdout.write(`${fullHelp(bin)}\n`); return 0; }
  // Nothing to do: in a terminal that means setting up (attach, welcomed);
  // elsewhere, how to start.
  const guided = !command;
  command = ALIASES[command] || command || 'attach';
  let run = ROUTES[command];
  if (!run) { err(`Error: ${unknownCommand(command, bin)}`); return 2; }
  if (flags.help) { stdout.write(`${COMMANDS[command] || fullHelp(bin)}\n`); return 0; }
  if (command === 'agents' && args[0] === 'scan') { run = attaching.scan; args = args.slice(1); }

  const ctx = createContext({ ...io, flags, args, rest, command });
  if (guided && !ctx.interactive) { stdout.write(`${quickHelp(bin)}\n`); return 0; }
  try {
    if (guided) ctx.out(`${WELCOME}\n\n`);
    const code = await run(ctx);
    if (!NO_NOTICE.has(command) && (ctx.ownerUsed || command === 'attach')) await approvalsNotice(ctx);
    return typeof code === 'number' ? code : 0;
  } catch (error) {
    // Mistyped: what went wrong and the command's usage, briefly.
    if (error instanceof UsageError) {
      err(`Error: ${error.message}`);
      const usage = usageOf(command);
      err(usage ? `\n${usage}\nMore: ${bin} help ${command}` : `See: ${bin} help`);
      return 2;
    }
    if (error instanceof ApiError || error instanceof CliError) {
      if (ctx.json) stdout.write(`${JSON.stringify({ error: { code: error.code || 'error', message: error.message, ...(error.status ? { status: error.status } : {}) } }, null, 2)}\n`);
      err(`Error: ${error.message}${error instanceof ApiError ? ` (${error.code})` : ''}`);
      const hint = hintFor(error, ctx.as);
      if (hint) err(hint);
      return 1;
    }
    // A bug or the computer refusing (a file it can't write): the message,
    // and the details only when asked for.
    err(`Something went wrong: ${error?.message || error}`);
    err(ctx.env.TIMEWARP_ID_DEBUG ? String(error?.stack || error) : 'Run it again with TIMEWARP_ID_DEBUG=1 to see the details.');
    return 1;
  }
}
