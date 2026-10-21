// What a person new to Agent ID sees: `timewarp-id` on its own (a guided
// setup in a terminal, how to start elsewhere), the help, nothing found,
// mistyped commands, the wait for the email link and the summary at the end.
// The terminal and Agent ID are stand-ins, so every word can be checked.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, tempDir } from '../testing/local-api.mjs';
import { main } from '../cli/src/main.js';
import { Api } from '../cli/src/api.js';
import { DEFAULT_API } from '../cli/src/config.js';
import { finished } from '../cli/src/commands/attach.js';
import { WELCOME } from '../cli/src/help.js';

const BASE = 'http://stand.in/agent-id';
const AGENT = { id: 'agt_aaaaaaaaaaaaaaaaaaaaaaaa', name: 'My agent', handle: 'my-agent-ab12' };
const RESOURCES = {
  mail: { kind: 'mail', status: 'active', mode: 'live', address: 'my-agent-ab12@agents.timewarpdev.com' },
  wallet: { kind: 'wallet', status: 'active', mode: 'live', address: '0x1234567890abcdef1234567890abcdef12345678' },
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// Agent ID as the claim flow sees it. `collect` answers the CLI's polls in turn.
function standIn(collect) {
  const seen = [];
  const send = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const route = `${init.method || 'GET'} ${new URL(url).pathname.replace(/^\/agent-id/, '')}`;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ route, body });
    switch (route) {
      case 'POST /v1/claims': return send(200, { claim: { code: 'c0de', matchCode: 'ABCD-EFGH' }, url: 'https://site.test/agent-id/claim/c0de', secret: 'twc_secret' });
      case 'POST /v1/claims/collect': { const [status, data] = collect.shift(); return send(status, data); }
      case 'GET /v1/me': return send(200, { agent: { ...AGENT, resources: RESOURCES }, owner: { verified: false } });
      case 'POST /v1/me/apps': return send(200, { app: body.app });
      case 'GET /v1/config': return send(200, { legal: { termsUrl: 'https://site.test/legal/agent-id-terms' } });
      default: return send(404, { error: { code: 'not_found', message: `No ${route} here.` } });
    }
  };
  return { fetch, seen };
}
const WAITING = [200, { status: 'waiting' }];
const CLAIMED = [200, { status: 'claimed', agent: { ...AGENT, resources: RESOURCES }, key: 'twa_stand-in' }];

// `timewarp-id <argv>` in a terminal: what it wrote, what it asked, what it opened.
async function inTerminal(argv, { env, cwd, fetch, answers = [] }) {
  const out = [], err = [], asked = [], opened = [];
  const tty = lines => ({ isTTY: true, write: chunk => { lines.push(String(chunk)); return true; } });
  const code = await main(argv, {
    env, cwd, fetch, stdout: tty(out), stderr: tty(err), stdin: { isTTY: true },
    ask: async question => { asked.push(question); return answers.length ? answers.shift() : ''; },
    openUrl: url => opened.push(url), sleep: async () => {},
  });
  return { code, stdout: out.join(''), stderr: err.join(''), asked, opened };
}

describe('a person new to Agent ID', () => {
  let root, home, env;
  const freshHome = name => {
    home = path.join(root, name);
    fs.mkdirSync(home, { recursive: true });
    // discover() looks in the real home folder: point it here.
    process.env.HOME = home; process.env.USERPROFILE = home;
    env = cliEnv(BASE, { idHome: path.join(home, '.timewarp-id'), codexHome: path.join(home, '.codex'), home });
    delete env.npm_command; delete env.npm_lifecycle_event; // Not started by npx here.
    return home;
  };
  before(() => { root = tempDir('guided'); });
  after(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('runs the setup when started with nothing else in a terminal', async () => {
    freshHome('setup');
    write(path.join(home, '.claude.json'), '{}\n');
    write(path.join(home, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\nReview.\n');
    write(path.join(home, '.codex', 'config.toml'), '');
    const api = standIn([WAITING, CLAIMED]);
    const result = await inTerminal([], { env, cwd: home, fetch: api.fetch });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.startsWith(`${WELCOME}\n\nFound on this computer:\n  1  Claude Code\n  2  Claude Code subagent reviewer\n  3  Codex\n`), result.stdout);
    assert.deepEqual(result.asked, ['Set up which? Press Enter for 1 and 3, or type numbers like 1,3: ']);
    // One link, for both apps, opened in the browser.
    assert.equal(api.seen.filter(r => r.route === 'POST /v1/claims').length, 1);
    assert.equal(api.seen.find(r => r.route === 'POST /v1/claims').body.name, 'My agent', 'one agent in several apps isn\'t named after one of them');
    assert.deepEqual(result.opened, ['https://site.test/agent-id/claim/c0de']);
    assert.equal(result.stderr, [
      '',
      'Open this link to confirm your email:',
      '  https://site.test/agent-id/claim/c0de',
      'We opened it in your browser. The page should show ABCD-EFGH.',
      'Waiting… (press Ctrl+C to stop)',
      '✓ Email confirmed.',
      '', '',
    ].join('\n'));
    assert.doesNotMatch(result.stderr + result.stdout, /verif/i, 'no identity check to set up');
    assert.ok(result.stdout.endsWith([
      '✓ Claude Code is set up. Restart Claude Code to use it.',
      '✓ Codex is set up. Restart Codex to use it.',
      '',
      'Your agent has:',
      '  Email     my-agent-ab12@agents.timewarpdev.com',
      '  Wallet    0x1234567890abcdef1234567890abcdef12345678',
      '            Add money at https://site.test/agent-id/agents/agt_aaaaaaaaaaaaaaaaaaaaaaaa?tab=wallet',
      '  Phone     Apply at https://site.test/agent-id/agents/agt_aaaaaaaaaaaaaaaaaaaaaaaa?tab=phone',
      '  Computer  Starts the first time your agent uses it',
      '',
      'Ask Claude: “What\'s my Agent ID email address?”',
      '',
    ].join('\n')), result.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(home, '.timewarp-id', 'config.json'), 'utf8'));
    assert.equal(config.profiles[AGENT.handle].key, 'twa_stand-in');
    assert.ok(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['timewarp-id']);
  });

  it('gives a new app the Agent ID already set up here, without a new link', async () => {
    // Same home: the agent from the last test is on this computer now.
    write(path.join(home, '.cursor', 'mcp.json'), '{}\n');
    const api = standIn([]);
    const result = await inTerminal(['attach', 'cursor'], { env, cwd: home, fetch: api.fetch });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!api.seen.some(r => r.route === 'POST /v1/claims'), 'no second claim');
    assert.match(result.stdout, /^✓ Cursor is set up\. Restart Cursor to use it\.$/m);
    assert.match(result.stdout, /Ask Cursor: /);
  });

  it('asks again when the number typed isn\'t in the list', async () => {
    freshHome('numbers');
    write(path.join(home, '.claude.json'), '{}\n');
    write(path.join(home, '.codex', 'config.toml'), '');
    const result = await inTerminal(['attach'], { env, cwd: home, fetch: standIn([CLAIMED]).fetch, answers: ['7', '2'] });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.asked.length, 2);
    assert.match(result.stderr, /There is no number 7 in the list/);
    assert.match(result.stdout, /^✓ Codex is set up\./m);
    assert.doesNotMatch(result.stdout, /✓ Claude Code/);
  });

  it('says plainly when the link expires, and what to do next', async () => {
    freshHome('expired');
    write(path.join(home, '.claude.json'), '{}\n');
    const result = await inTerminal(['attach', 'claude'], { env, cwd: home, fetch: standIn([WAITING, [410, { error: { code: 'expired', message: 'The link expired before it was used.' } }]]).fetch });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Error: The link expired before your email was confirmed\.\nRun `timewarp-id` again for a new link\.\n$/);
    const canceled = await inTerminal(['attach', 'claude'], { env, cwd: home, fetch: standIn([[404, { error: { code: 'not_found', message: 'No claim with this secret.' } }]]).fetch });
    assert.match(canceled.stderr, /Error: The link was canceled\.\nRun `timewarp-id` again for a new link\./);
  });

  it('keeps waiting through a dropped connection', async () => {
    freshHome('offline');
    write(path.join(home, '.claude.json'), '{}\n');
    const api = standIn([WAITING, CLAIMED]);
    let drops = 2;
    const flaky = async (url, init) => (/collect/.test(url) && drops-- > 0 ? Promise.reject(new TypeError('fetch failed')) : api.fetch(url, init));
    const result = await inTerminal(['attach', 'claude'], { env, cwd: home, fetch: flaky });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /✓ Claude Code is set up/);
  });

  it('finds nothing kindly, in a terminal and out of one', async () => {
    freshHome('empty');
    const guided = await inTerminal([], { env, cwd: home, fetch: standIn([]).fetch });
    assert.equal(guided.code, 1);
    assert.equal(guided.stderr, '', 'no error, no usage');
    assert.equal(guided.stdout, [
      WELCOME, '',
      'No AI apps found on this computer.',
      '',
      'Agent ID works with Claude Code, Codex, Cursor, Claude Desktop, Gemini CLI,',
      'Windsurf, Copilot CLI, Cline and more. Install one, then run this again.',
      '',
      'Your own agent in a folder? Run this in that folder:',
      '  timewarp-id attach --here',
      '',
      'More help: https://timewarpdev.com/agent-id',
      '',
    ].join('\n'));
    const piped = await runCli(['attach'], { env, cwd: home });
    assert.equal(piped.code, 1);
    assert.match(piped.stdout, /^No AI apps found on this computer\./);
    assert.equal(piped.stderr, '');
    const npx = await runCli(['attach'], { env: { ...env, npm_command: 'exec' }, cwd: home });
    assert.match(npx.stdout, /  npx @timewarp\/agent-id attach --here/, 'says what they typed');
    const detach = await runCli(['detach'], { env, cwd: home });
    assert.equal(detach.code, 0);
    assert.equal(detach.stdout, 'Nothing to detach: no app on this computer has an Agent ID.\n');
  });

  it('says how to start when there is no terminal to ask in', async () => {
    freshHome('piped');
    const result = await runCli([], { env, cwd: home });
    assert.equal(result.code, 0);
    assert.ok(result.stdout.startsWith(`${WELCOME}\n\nGet started: run \`timewarp-id\` in a terminal and follow the steps.\n`), result.stdout);
    assert.match(result.stdout, /`timewarp-id attach claude codex`/);
    assert.doesNotMatch(result.stdout, /Advanced/, 'short, not the full reference');
    const npx = await runCli([], { env: { ...env, npm_command: 'exec' }, cwd: home });
    assert.match(npx.stdout, /Get started: run `npx @timewarp\/agent-id` in a terminal/);
  });

  it('puts getting started first in the help, and developer commands after', async () => {
    freshHome('help');
    const help = await runCli(['help'], { env, cwd: home });
    assert.equal(help.code, 0);
    assert.ok(help.stdout.startsWith(`${WELCOME}\n\nGet started: run \`timewarp-id\` and follow the steps.\n`), help.stdout);
    const start = help.stdout.indexOf('Get started'), useful = help.stdout.indexOf('Also useful'), advanced = help.stdout.indexOf('Advanced and developer commands');
    assert.ok(start < useful && useful < advanced, 'people first, developers after');
    assert.ok(help.stdout.indexOf('login --owner-key') > advanced, 'owner keys are for developers');
    assert.equal((await runCli(['--help'], { env, cwd: home })).stdout, help.stdout);
    const attach = (await runCli(['help', 'attach'], { env, cwd: home })).stdout;
    assert.match(attach, /where you confirm your email/);
    assert.doesNotMatch(attach, /verify who you are/);
  });

  it('suggests the command meant, and keeps usage mistakes short', async () => {
    freshHome('typos');
    const typo = await runCli(['atach'], { env, cwd: home });
    assert.equal(typo.code, 2);
    assert.equal(typo.stderr, 'Error: There is no command "atach". Did you mean: timewarp-id attach\nSee all commands: timewarp-id help\n');
    assert.match((await runCli(['codex'], { env, cwd: home })).stderr, /To give that app an Agent ID, run: timewarp-id attach codex/);
    const mistake = await runCli(['attach', '--give', 'pizza'], { env, cwd: home });
    assert.equal(mistake.code, 2);
    assert.match(mistake.stderr, /^Error: --give takes mail, phone, wallet, card, vm \(comma-separated\), not "pizza"\.\n\nUsage: timewarp-id attach /);
    assert.match(mistake.stderr, /More: timewarp-id help attach\n$/);
    assert.doesNotMatch(mistake.stderr, /Each gets a new Agent ID/, 'the usage, not the whole help');
  });

  it('says it can\'t reach Agent ID in plain words', async () => {
    const api = new Api(DEFAULT_API, async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
    await assert.rejects(api.get('/v1/me'), error => error.message === 'Can\'t reach Agent ID. Check your internet connection and try again.' && error.code === 'network' && !error.hint);
    const local = new Api('http://127.0.0.1:9/agent-id', async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); });
    await assert.rejects(local.get('/v1/me'), error => /Tried http:\/\/127\.0\.0\.1:9\/agent-id \(ECONNREFUSED\)/.test(error.hint));
    freshHome('offline-cli');
    const result = await runCli(['me'], { env: { ...env, AGENT_ID_API: 'http://127.0.0.1:9/agent-id', TIMEWARP_AGENT_KEY: 'twa_x' }, cwd: home });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Error: Can't reach Agent ID\. Check your internet connection and try again\.\n/);
    assert.doesNotMatch(result.stderr, /at .*\.js:\d+/, 'no stack');
  });
});

describe('the summary after attach', () => {
  const target = (kind, tool, app, extra = {}) => ({ kind, tool, app, label: 'every project', mcps: [{}], ...extra });
  const result = (t, resources, agent = AGENT) => ({ target: t, agent, resources, notes: [], restart: t.mcps.length ? `Restart ${t.tool} to use it.` : null });

  it('names each app, what the agent has, and where to get the rest', () => {
    const text = finished([result(target('claude', 'Claude Code', 'claude-code'), { ...RESOURCES, vm: { kind: 'vm', status: 'active', mode: 'live' } }, { ...AGENT, name: 'Ada\'s helper' })], { dashboard: 'https://timewarpdev.com/agent-id/dashboard' });
    assert.equal(text, [
      '✓ Claude Code is set up. Restart Claude Code to use it.',
      '',
      'Your agent “Ada\'s helper” has:',
      '  Email     my-agent-ab12@agents.timewarpdev.com',
      '  Wallet    0x1234567890abcdef1234567890abcdef12345678',
      '            Add money at https://timewarpdev.com/agent-id/agents/agt_aaaaaaaaaaaaaaaaaaaaaaaa?tab=wallet',
      '  Phone     Apply at https://timewarpdev.com/agent-id/agents/agt_aaaaaaaaaaaaaaaaaaaaaaaa?tab=phone',
      '  Computer  Ready',
      '',
      'Ask Claude: “What\'s my Agent ID email address?”',
    ].join('\n'));
  });

  it('says what is still being set up, and names folders and subagents', () => {
    const resources = { mail: { kind: 'mail', status: 'provisioning', mode: 'test', address: null } };
    const text = finished([
      result({ kind: 'folder', tool: 'Folder', app: 'custom', projectDir: path.join(process.cwd(), 'bot'), mcps: [] }, resources),
      result({ kind: 'claude-agent', tool: 'Claude Code', app: 'claude-code', label: 'subagent reviewer', name: 'reviewer', mcps: [{}] }, resources),
    ], { dashboard: 'https://x.test/agent-id/dashboard' });
    assert.match(text, /^✓ Your agent in .*bot is set up\.$/m);
    assert.match(text, /^✓ Claude Code subagent reviewer is set up\. Restart Claude Code to use it\.$/m);
    assert.match(text, /^ {2}Email {5}Being set up \(ready in a minute\) \(test\)$/m);
    assert.match(text, /^ {2}Wallet {4}Add one at https:\/\/x\.test\/agent-id\/dashboard$/m);
    assert.match(text, /Ask your agent: “What can you do with your Agent ID\?”$/);
  });
});
