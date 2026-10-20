// The timewarp-id CLI end to end, as separate processes, against the real
// Agent ID service running locally over HTTP.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLI, cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { upsertTable } from '../cli/src/toml.js';
import { withAgentId } from '../sdk/index.js';

// A strict-enough TOML reader for the files the test writes: tables,
// key = value with strings, numbers, booleans, arrays and inline tables.
function parseToml(text) {
  const root = {};
  let table = root;
  const seen = new Set();
  const value = s => {
    s = s.trim();
    if (/^".*"$/.test(s) || s.startsWith('[')) return JSON.parse(s);
    if (s.startsWith('{')) return Object.fromEntries(s.slice(1, -1).split(',').filter(p => p.trim()).map(p => { const [k, ...v] = p.split('='); return [k.trim().replace(/^"|"$/g, ''), value(v.join('='))]; }));
    if (/^-?\d+$/.test(s)) return Number(s);
    if (s === 'true' || s === 'false') return s === 'true';
    throw new Error(`Unsupported TOML value: ${s}`);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#[^"]*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const key = header[1].trim();
      if (seen.has(key)) throw new Error(`Table [${key}] defined twice`);
      seen.add(key);
      table = root;
      for (const part of key.split('.')) table = table[part.trim()] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) throw new Error(`Not TOML: ${line}`);
    const key = line.slice(0, eq).trim();
    if (key in table) throw new Error(`Key ${key} set twice`);
    table[key] = value(line.slice(eq + 1));
  }
  return root;
}

describe('timewarp-id CLI', () => {
  let api, home, env, owner, alice, bob, aliceMail, bobMail;
  const cli = (args, options = {}) => runCli(args, { env: options.env || env, cwd: options.cwd || home, input: options.input });
  const ok = async (args, options) => {
    const result = await cli(args, options);
    assert.equal(result.code, 0, `timewarp-id ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const json = async (args, options) => (await ok([...args, '--json'], options)).json();

  before(async () => {
    api = await startApi();
    home = tempDir('cli');
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home });
    owner = await api.local.user({ email: 'owner@example.test', plan: 'pro', credits: 100 });
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('explains itself and refuses to act without an owner key', async () => {
    const help = await ok(['--help']);
    assert.match(help.stdout, /Usage: timewarp-id <command>/);
    assert.match((await ok(['mail', '--help'])).stdout, /mail send --to/);
    const unknown = await cli(['frobnicate']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /no command "frobnicate"/);
    const notSignedIn = await cli(['agents', 'list']);
    assert.equal(notSignedIn.code, 1);
    assert.match(notSignedIn.stderr, /not signed in/i);
    assert.match(notSignedIn.stderr, /login --owner-key/);
  });

  it('logs in with an owner key and keeps it private', async () => {
    const bad = await cli(['login', '--owner-key', 'twa_nope']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /not an owner key/);
    const wrong = await cli(['login', '--owner-key', 'two_not-a-real-key']);
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /invalid_key/);

    const key = await api.ownerKey(owner);
    const result = await ok(['login', '--owner-key', key]);
    assert.match(result.stdout, /Signed in as owner@example\.test/);
    const file = path.join(home, 'id', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(config.ownerKey, key);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const who = await json(['whoami']);
    assert.equal(who.owner.user.email, 'owner@example.test');
    assert.equal(who.agent, null);
  });

  it('asks for Agent ID\'s terms before the first agent', async () => {
    const early = await cli(['agents', 'create', 'Early']);
    if (early.code === 0) await cli(['agents', 'revoke', 'Early', '--yes']); // Keep the later tests' first agent first.
    assert.equal(early.code, 1, 'creating an agent needs the terms accepted');
    assert.match(early.stderr, /terms_required/);
    assert.match(early.stderr, /Run `timewarp-id terms`/);
    const declined = await cli(['terms']);
    assert.equal(declined.code, 1, 'without a terminal or --yes nothing is accepted');
    assert.match(declined.stderr, /terms of service \(version [^)]+\): https?:\/\/\S+/);
    assert.match(declined.stderr, /timewarp-id terms --yes/);
    const accepted = await ok(['terms', '--yes']);
    assert.match(accepted.stdout, /Accepted Agent ID's terms of service \(version [^)]+\)/);
    const { legal } = await api.call('GET', '/v1/config');
    assert.deepEqual(api.requests.filter(r => r.path === '/v1/account/terms').pop().body, { version: legal.termsVersion });
  });

  it('creates two agents and stores their keys as profiles', async () => {
    const a = await json(['agents', 'create', 'Alice', '--runtime', 'codex']);
    const b = await json(['agents', 'create', 'Bob', 'Builder']);
    assert.equal(a.agent.name, 'Alice');
    assert.equal(a.agent.runtime, 'codex');
    assert.equal(b.agent.name, 'Bob Builder');
    assert.equal(a.secret, undefined, 'the key is not printed');
    alice = a.agent; bob = b.agent;
    const config = JSON.parse(fs.readFileSync(path.join(home, 'id', 'config.json'), 'utf8'));
    assert.equal(config.default, alice.handle);
    assert.equal(config.profiles[alice.handle].agentId, alice.id);
    assert.match(config.profiles[alice.handle].key, /^twa_/);
    assert.match(config.profiles[bob.handle].key, /^twa_/);
    const list = await ok(['agents', 'list']);
    assert.match(list.stdout, new RegExp(`\\*\\s+${alice.handle}`));
    assert.match(list.stdout, new RegExp(bob.handle));
    const runtime = await cli(['agents', 'create', 'X', '--runtime', 'gpt']);
    assert.equal(runtime.code, 2);
  });

  it('gives test mail, wallet, card, phone and a machine', async () => {
    aliceMail = (await json(['give', 'mail', '--test', '--agent', alice.handle])).resource.address;
    bobMail = (await json(['give', 'mail', '--test', '--agent', 'Bob Builder'])).resource.address;
    assert.match(aliceMail, /@agents\.timewarp\.test$/);
    const wallet = await json(['give', 'wallet', '--test', '--agent', alice.handle]);
    assert.equal(wallet.resource.mode, 'test');
    await ok(['give', 'wallet', '--test', '--agent', bob.handle]);
    const card = await ok(['give', 'card', '--test', '--agent', alice.handle]);
    assert.match(card.stdout, /test virtual card: Test Visa/);
    const phone = await json(['give', 'phone', '--test', '--agent', alice.handle, '--country', 'US', '--area-code', '415']);
    assert.match(phone.resource.address, /^\+1\d{10}$/);
    const vm = await json(['give', 'vm', '--test', '--agent', alice.handle, '--size', 'small']);
    assert.equal(vm.resource.details.size, 'small');
    const again = await cli(['give', 'mail', '--test', '--agent', alice.handle]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already has/);
    const me = await json(['me']);
    assert.deepEqual(Object.keys(me.agent.resources).sort(), ['card', 'mail', 'phone', 'vm', 'wallet']);
  });

  it('sends mail between the agents, reads it and replies', async () => {
    const sent = await ok(['mail', 'send', '--agent', alice.handle, '--to', bobMail, '--subject', 'Hello Bob', '--text', '-'], { input: 'First line\nSecond line\n' });
    assert.match(sent.stdout, /Sent "Hello Bob" to .* \(delivered\)/);
    const inbox = await json(['mail', 'list', '--agent', bob.handle]);
    assert.equal(inbox.messages.length, 1);
    const [message] = inbox.messages;
    assert.equal(message.subject, 'Hello Bob');
    assert.equal(message.counterparty, aliceMail);
    assert.equal(message.read, false);
    const read = await ok(['mail', 'read', message.id, '--agent', bob.handle]);
    assert.match(read.stdout, /Subject: Hello Bob/);
    assert.match(read.stdout, /First line\nSecond line/);
    const unread = await json(['mail', 'list', '--unread', '--agent', bob.handle]);
    assert.equal(unread.messages.length, 0);
    await ok(['mail', 'reply', message.id, '--agent', bob.handle, '--text', 'Hi Alice']);
    const aliceInbox = await json(['mail', 'list', '--agent', alice.handle]);
    assert.equal(aliceInbox.messages[0].subject, 'Re: Hello Bob');
    assert.equal(aliceInbox.messages[0].preview, 'Hi Alice');
    const sentFolder = await ok(['mail', 'list', '--folder', 'sent', '--agent', alice.handle]);
    assert.match(sentFolder.stdout, /Hello Bob/);
  });

  it('sends attachments, and moves mail to the trash and back (real service)', async () => {
    fs.writeFileSync(path.join(home, 'q3 report.txt'), 'Revenue up.\n');
    const sent = await ok(['mail', 'send', '--agent', alice.handle, '--to', bobMail, '--subject', 'Q3', '--text', 'Attached.', '--attach', 'q3 report.txt']);
    assert.match(sent.stdout, /with 1 attachment/);
    const upload = api.requests.find(r => r.path === '/v1/me/files');
    assert.equal(upload.headers['x-filename'], 'q3%20report.txt');
    const { messages } = await json(['mail', 'list', '--agent', bob.handle]);
    const q3 = messages.find(m => m.subject === 'Q3');
    assert.match((await ok(['mail', 'read', q3.id, '--agent', bob.handle])).stdout, /Attachments: q3 report\.txt \(12 B, /);
    await ok(['mail', 'trash', q3.id, '--agent', bob.handle]);
    assert.ok((await json(['mail', 'list', '--folder', 'trash', '--agent', bob.handle])).messages.some(m => m.id === q3.id));
    assert.ok(!(await json(['mail', 'list', '--agent', bob.handle])).messages.some(m => m.id === q3.id));
    await ok(['mail', 'restore', q3.id, '--agent', bob.handle]);
    assert.ok((await json(['mail', 'list', '--agent', bob.handle])).messages.some(m => m.id === q3.id));
  });

  it('applies for a card and records where agents come from (real service)', async () => {
    const applied = await ok(['card', 'apply', '--agent', alice.handle, '--use-case', 'Paying for API credits', '--monthly', '200', '--country', 'se']);
    assert.match(applied.stdout, /Card application: submitted/);
    assert.match(applied.stdout, /Monthly spend: \$200\.00 USD/);
    assert.match((await ok(['card', 'application', '--agent', alice.handle])).stdout, /Country: SE/);
    const { agent } = await json(['agents', 'show', alice.handle]);
    assert.equal(agent.origin.app, 'codex', 'agents create --runtime codex says where it comes from');
    const made = await json(['agents', 'create', 'Origin Test', '--origin', 'strawberry', '--origin-detail', 'browser tab']);
    assert.deepEqual({ app: made.agent.origin.app, detail: made.agent.origin.detail }, { app: 'strawberry', detail: 'browser tab' });
    await ok(['agents', 'revoke', made.agent.handle, '--yes']);
  });

  it('texts, calls and keeps contacts', async () => {
    assert.match((await ok(['sms', 'send', '+14155550123', 'on', 'my', 'way'])).stdout, /Texted \+14155550123/);
    const texts = await json(['sms', 'list']);
    assert.equal(texts.messages[0].text, 'on my way');
    assert.match((await ok(['call', 'place', '+14155550123', '--say', 'Your order is ready'])).stdout, /Called/);
    const contact = await json(['contacts', 'add', 'Grace', 'Hopper', '--email', 'grace@example.com']);
    assert.equal(contact.contact.name, 'Grace Hopper');
    const contacts = await json(['contacts', 'list', 'grace']);
    assert.equal(contacts.contacts.length, 1);
    await ok(['contacts', 'rm', contact.contact.id]);
    assert.equal((await json(['contacts', 'list'])).contacts.length, 0);
  });

  it('funds a wallet, sends money and surfaces the approval flow', async () => {
    assert.match((await ok(['fund', '--agent', alice.handle, '100'])).stdout, /Balance: \$100\.00/);
    await ok(['limits', 'wallet', '--agent', alice.handle, '--per-transfer', '50', '--daily', '100', '--approval-above', '25']);
    const limits = await json(['limits', 'wallet', '--agent', alice.handle]);
    assert.deepEqual(limits.settings, { perTransfer: 5000, daily: 10000, approvalAbove: 2500 });
    const wrongKind = await cli(['limits', 'wallet', '--monthly', '10']);
    assert.equal(wrongKind.code, 2);

    // Bob by the name this computer knows him by.
    const sent = await ok(['wallet', 'send', 'Bob Builder', '10', '--memo', 'lunch', '--agent', alice.handle]);
    assert.match(sent.stdout, /Sent \$10\.00 USD to Bob Builder.*Balance: \$90\.00 USD/);
    assert.equal((await json(['wallet', 'show', '--agent', bob.handle])).wallet.balance.amount, 1000);
    assert.match((await ok(['wallet', 'show', '--agent', bob.handle])).stdout, /Balance: \$10\.00 USD · test dollars/);

    const waiting = await ok(['wallet', 'send', bob.handle, '30', '--agent', alice.handle]);
    assert.match(waiting.stdout, /Waiting for the owner/);
    const approvalId = /Approval id: (\S+)/.exec(waiting.stdout)[1];
    assert.match(waiting.stdout, new RegExp(`timewarp-id approve ${approvalId}`));
    const pending = await json(['approvals']);
    assert.equal(pending.approvals.length, 1);
    assert.equal(pending.approvals[0].id, approvalId);
    assert.equal(pending.approvals[0].request.amount, 3000);
    assert.match((await ok(['approvals'])).stdout, /Alice\s+\$30\.00\s+Bob Builder \(agt_/);
    assert.match((await ok(['deny', approvalId])).stdout, /Denied/);
    assert.equal((await json(['approvals'])).approvals.length, 0);

    const over = await cli(['wallet', 'send', bob.handle, '60', '--agent', alice.handle]);
    assert.equal(over.code, 1);
    assert.match(over.stderr, /over_limit/);
    const history = await json(['wallet', 'history', '--agent', alice.handle]);
    assert.ok(history.transactions.some(t => t.direction === 'out' && t.amount.amount === 1000));
  });

  it('approving a waiting transfer sends it', async () => {
    const waiting = await json(['wallet', 'send', bob.handle, '26', '--agent', alice.handle]);
    assert.equal(waiting.status, 'needs_approval');
    const approved = await ok(['approve', waiting.approval]);
    assert.match(approved.stdout, /Approved and sent \$26\.00 USD to Bob Builder/);
    assert.equal((await json(['wallet', 'show', '--agent', bob.handle])).wallet.balance.amount, 3600);
    const again = await cli(['approve', waiting.approval]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already_decided/);
  });

  it('charges the test card within its limits', async () => {
    const approved = await json(['card', 'test-charge', '12.50', '--merchant', 'Books']);
    assert.equal(approved.approved, true);
    const declined = await ok(['card', 'test-charge', '80']);
    assert.match(declined.stdout, /Declined: \$80\.00 \(over_transaction_limit\)/);
    const card = await json(['card', 'show']);
    assert.equal(card.card.last4, '4242');
    assert.equal(card.card.spent.last24Hours.amount, 1250);
    const reveal = await ok(['card', 'reveal']);
    assert.match(reveal.stdout, /Number: 4242424242424242/);
    assert.match(reveal.stderr, /logged/);
  });

  it('reports a test machine honestly', async () => {
    assert.equal((await json(['vm', 'start'])).machine.state, 'running');
    assert.match((await ok(['vm', 'status'])).stdout, /State: running/);
    const exec = await cli(['vm', 'exec', '--', 'echo', 'hi']);
    assert.equal(exec.code, 1);
    assert.match(exec.stderr, /test_machine/);
  });

  it('prints only the passport token', async () => {
    const result = await ok(['passport', '--audience', 'https://api.example.com']);
    assert.match(result.stdout, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\n$/);
    const claims = JSON.parse(Buffer.from(result.stdout.trim().split('.')[1], 'base64url').toString());
    assert.equal(claims.sub, alice.id);
    assert.equal(claims.aud, 'https://api.example.com');
    const missing = await cli(['passport']);
    assert.equal(missing.code, 2);
  });

  it('picks the agent from .timewarp-id.json, the default, --agent and TIMEWARP_AGENT_KEY', async () => {
    const project = path.join(home, 'project');
    const nested = path.join(project, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal((await json(['me'], { cwd: nested })).agent.id, alice.id, 'the default without a project file');
    await ok(['use', bob.handle, '--project'], { cwd: project });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.timewarp-id.json'), 'utf8')), { agent: bob.handle });
    assert.equal((await json(['me'], { cwd: nested })).agent.id, bob.id, 'the project file wins over the default');
    assert.equal((await json(['me', '--agent', alice.handle], { cwd: nested })).agent.id, alice.id, '--agent wins over the project file');
    const aliceKey = JSON.parse(fs.readFileSync(path.join(home, 'id', 'config.json'), 'utf8')).profiles[alice.handle].key;
    assert.equal((await json(['me', '--agent', bob.handle], { cwd: nested, env: { ...env, TIMEWARP_AGENT_KEY: aliceKey } })).agent.id, alice.id, 'TIMEWARP_AGENT_KEY wins over everything');
    const who = await json(['whoami'], { cwd: nested });
    assert.equal(who.agent.agent.id, bob.id);
    assert.match(who.agentSource, /\.timewarp-id\.json$/);

    await ok(['use', bob.handle]);
    assert.equal((await json(['me'])).agent.id, bob.id);
    await ok(['use', alice.handle]);
    fs.writeFileSync(path.join(project, '.timewarp-id.json'), '{ "agent": "nobody" }');
    const missing = await cli(['me'], { cwd: nested });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no key for agent "nobody".*\.timewarp-id\.json/s);
  });

  it('connect codex writes valid TOML and keeps the other tables', async () => {
    const codexHome = path.join(home, 'codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const file = path.join(codexHome, 'config.toml');
    fs.writeFileSync(file, [
      '# My Codex settings',
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.github]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      '',
      '[mcp_servers.timewarp_id]',
      'command = "old"',
      '',
      '[mcp_servers.timewarp_id.env]',
      'OLD = "1"',
      '',
      '# Profiles',
      '[profiles.fast]',
      'model = "gpt-5-mini"',
      '',
    ].join('\n'));
    const result = await ok(['connect', 'codex', '--agent', alice.handle]);
    assert.match(result.stdout, /Added Agent ID to Codex as alice/);
    const text = fs.readFileSync(file, 'utf8');
    const toml = parseToml(text);
    assert.equal(toml.model, 'gpt-5-codex');
    assert.deepEqual(toml.mcp_servers.github, { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
    assert.equal(toml.profiles.fast.model, 'gpt-5-mini');
    const server = toml.mcp_servers.timewarp_id;
    const expected = process.platform === 'win32' ? ['cmd', ['/c', 'npx', '-y', '@timewarp/agent-id', 'mcp', '--agent', alice.handle]] : ['npx', ['-y', '@timewarp/agent-id', 'mcp', '--agent', alice.handle]];
    assert.equal(server.command, expected[0]);
    assert.deepEqual(server.args, expected[1]);
    assert.equal(server.env.TIMEWARP_ID_HOME, path.join(home, 'id'));
    assert.equal(server.env.AGENT_ID_API, api.base);
    assert.equal(server.env.TIMEWARP_ID_TOOL, 'codex');
    assert.ok(!('OLD' in server.env), 'the old sub-table is gone');
    assert.match(text, /^# My Codex settings/);
    assert.match(text, /# Profiles\n\[profiles\.fast\]/);
    assert.ok(fs.existsSync(`${file}.timewarp-id.bak`));

    // Running it again changes nothing; a new file gets just the table.
    await ok(['connect', 'codex', '--agent', alice.handle]);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    const fresh = path.join(home, 'codex2');
    await ok(['connect', 'codex'], { env: { ...env, CODEX_HOME: fresh } });
    const freshToml = parseToml(fs.readFileSync(path.join(fresh, 'config.toml'), 'utf8'));
    assert.ok(!freshToml.mcp_servers.timewarp_id.args.includes('--agent'), 'without --agent it follows the project');
    const project = await cli(['connect', 'codex', '--scope', 'project']);
    assert.equal(project.code, 2);
  });

  it('replaces inline and dotted Codex definitions too', () => {
    const block = '[mcp_servers.timewarp_id]\ncommand = "new"';
    const inline = upsertTable('[mcp_servers]\ntimewarp_id = { command = "old" }\nother = { command = "x" }\n', ['mcp_servers', 'timewarp_id'], block);
    assert.deepEqual(parseToml(inline).mcp_servers, { other: { command: 'x' }, timewarp_id: { command: 'new' } });
    const dotted = upsertTable('mcp_servers.timewarp_id.command = "old"\nmcp_servers.timewarp_id.args = [\n  "a",\n]\nmodel = "m"\n', ['mcp_servers', 'timewarp_id'], block);
    assert.equal(dotted, 'model = "m"\n\n[mcp_servers.timewarp_id]\ncommand = "new"\n');
    const strings = upsertTable('x = """\n[mcp_servers.timewarp_id]\n"""\n', ['mcp_servers', 'timewarp_id'], block);
    assert.match(strings, /^x = """\n\[mcp_servers\.timewarp_id\]\n"""\n\n\[mcp_servers\.timewarp_id\]\ncommand = "new"\n$/);
  });

  it('connect claude --print prints the claude mcp add command', async () => {
    const result = await ok(['connect', 'claude', '--agent', alice.handle, '--print']);
    const runner = process.platform === 'win32' ? 'cmd /c npx' : 'npx';
    assert.match(result.stdout.trim(), new RegExp(`^claude mcp add timewarp-id -s user -e TIMEWARP_ID_TOOL=claude-code -e TIMEWARP_ID_HOME=.+ -e AGENT_ID_API=\\S+ -- ${runner} -y @timewarp/agent-id mcp --agent ${alice.handle}$`));
    const project = await json(['connect', 'claude', '--agent', alice.handle, '--scope', 'project', '--print']);
    assert.deepEqual(project.args.slice(0, 5), ['mcp', 'add', 'timewarp-id', '-s', 'project']);
    const nobody = await cli(['connect', 'claude', '--agent', 'nobody', '--print']);
    assert.equal(nobody.code, 1);
  });

  it('connect claude-desktop and cursor merge JSON configs', async () => {
    const desktop = path.join(home, 'desktop.json');
    fs.writeFileSync(desktop, JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
    await ok(['connect', 'claude-desktop', '--agent', alice.handle, '--config', desktop]);
    const merged = JSON.parse(fs.readFileSync(desktop, 'utf8'));
    assert.equal(merged.theme, 'dark');
    assert.deepEqual(merged.mcpServers.other, { command: 'x' });
    assert.deepEqual(merged.mcpServers['timewarp-id'].args, ['-y', '@timewarp/agent-id', 'mcp', '--agent', alice.handle]);
    const cursorProject = path.join(home, 'cursor-project');
    fs.mkdirSync(cursorProject);
    await ok(['connect', 'cursor', '--agent', alice.handle, '--scope', 'project'], { cwd: cursorProject });
    assert.equal(JSON.parse(fs.readFileSync(path.join(cursorProject, '.cursor', 'mcp.json'), 'utf8')).mcpServers['timewarp-id'].command, 'npx');
    fs.writeFileSync(desktop, '{ broken');
    const broken = await cli(['connect', 'claude-desktop', '--agent', alice.handle, '--config', desktop]);
    assert.equal(broken.code, 1);
    assert.equal(fs.readFileSync(desktop, 'utf8'), '{ broken', 'a broken file is left alone');
  });

  it('mcp proxies stdio JSON-RPC to Agent ID', async () => {
    const child = spawn(process.execPath, [CLI, 'mcp', '--agent', alice.handle], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = new Map();
    let buffer = '', stderr = '';
    const waiting = [];
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = JSON.parse(line);
        replies.set(message.id, message);
        for (const w of waiting.splice(0)) w();
      }
    });
    const reply = id => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${id}; stderr: ${stderr}`)), 20000);
      const check = () => { if (replies.has(id)) { clearTimeout(timer); resolve(replies.get(id)); } else waiting.push(check); };
      check();
    });
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    const exited = new Promise(resolve => child.on('close', resolve));

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const init = await reply(1);
    assert.equal(init.result.serverInfo.name, 'timewarp-agent-id');
    assert.match(init.result.instructions, /You are Alice/);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (await reply(2)).result.tools.map(t => t.name);
    for (const name of ['whoami', 'mail_send', 'wallet_send', 'card_get', 'vm_exec', 'passport_issue', 'signing_key_add']) assert.ok(tools.includes(name), name);
    send({ jsonrpc: '2.0', id: 'three', method: 'tools/call', params: { name: 'mail_send', arguments: { to: bobMail, subject: 'Via MCP', text: 'Sent through the stdio proxy' } } });
    const call = await reply('three');
    assert.equal(call.result.isError, undefined);
    assert.equal(JSON.parse(call.result.content[0].text).message.status, 'delivered');
    child.stdin.write('this is not json\n');
    const parseError = await reply(null);
    assert.equal(parseError.error.code, -32700);
    send({ jsonrpc: '2.0', id: 4, method: 'no/such/method' });
    assert.equal((await reply(4)).error.code, -32601);
    child.stdin.end();
    assert.equal(await exited, 0);
    assert.equal(replies.size, 5, 'no answer to the notification');
    assert.match(stderr, /acting as alice/);
    const inbox = await json(['mail', 'list', '--agent', bob.handle]);
    assert.ok(inbox.messages.some(m => m.subject === 'Via MCP'));
  });

  it('mcp --remote reaches another MCP server with passports, never the key', async () => {
    // A company's MCP server that accepts only Agent ID agents.
    const seen = [];
    const handler = withAgentId(async (request, agent) => {
      const message = await request.json();
      seen.push({ passport: request.headers.get('agent-passport'), authorization: request.headers.get('authorization') });
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'acme', version: '1' } }
        : message.method === 'tools/call' ? { content: [{ type: 'text', text: `Hello ${agent.agent.name}, owner ${agent.owner.level}` }] }
        : { tools: [{ name: 'hello', inputSchema: { type: 'object' } }] };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }, { audience: 'https://mcp.acme.test', api: api.base, require: 'any' });
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'), body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      const lines = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hello', arguments: {} } },
      ].map(m => JSON.stringify(m)).join('\n');
      const result = await runCli(['mcp', '--remote', url, '--audience', 'https://mcp.acme.test', '--agent', alice.handle], { env, cwd: home, input: `${lines}\n` });
      assert.equal(result.code, 0, result.stderr);
      const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(replies.find(r => r.id === 1).result.serverInfo.name, 'acme');
      assert.equal(replies.find(r => r.id === 2).result.content[0].text, 'Hello Alice, owner none');
      assert.ok(seen.length >= 2);
      assert.ok(seen.every(s => s.authorization === null && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s.passport)), 'only passports are sent');
      assert.equal(new Set(seen.map(s => s.passport)).size, 1, 'one passport is reused while it is fresh');

      // A server for another audience turns the passport away.
      const wrong = await runCli(['mcp', '--remote', url, '--agent', alice.handle], { env, cwd: home, input: `${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })}\n` });
      const denied = JSON.parse(wrong.stdout.trim());
      assert.equal(denied.error.code, -32001);
      assert.match(denied.error.message, /wrong_audience/);
    } finally {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('mcp answers JSON-RPC errors when the key no longer works', async () => {
    const result = await runCli(['mcp'], {
      env: { ...env, TIMEWARP_AGENT_KEY: 'twa_revoked-or-wrong' }, cwd: home,
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`,
    });
    assert.equal(result.code, 0);
    const answer = JSON.parse(result.stdout.trim());
    assert.equal(answer.id, 7);
    assert.equal(answer.error.code, -32001);
    assert.match(answer.error.message, /invalid_key/);
  });

  it('pauses, resumes and revokes an agent', async () => {
    await ok(['agents', 'pause', bob.handle]);
    const paused = await cli(['me', '--agent', bob.handle]);
    assert.equal(paused.code, 1);
    assert.match(paused.stderr, /paused/);
    await ok(['agents', 'resume', bob.handle]);
    await ok(['me', '--agent', bob.handle]);
    const unconfirmed = await cli(['agents', 'revoke', bob.handle]);
    assert.equal(unconfirmed.code, 1);
    assert.match(unconfirmed.stderr, /--yes/);
    const bobKey = JSON.parse(fs.readFileSync(path.join(home, 'id', 'config.json'), 'utf8')).profiles[bob.handle].key;
    await ok(['agents', 'revoke', bob.handle, '--yes']);
    const config = JSON.parse(fs.readFileSync(path.join(home, 'id', 'config.json'), 'utf8'));
    assert.equal(config.profiles[bob.handle], undefined);
    const gone = await cli(['me'], { env: { ...env, TIMEWARP_AGENT_KEY: bobKey } });
    assert.equal(gone.code, 1);
    assert.match(gone.stderr, /invalid_key|revoked/);
    const shown = await json(['agents', 'show', bob.id]);
    assert.equal(shown.agent.status, 'revoked');
  });

  it('logs out', async () => {
    await ok(['logout']);
    const config = JSON.parse(fs.readFileSync(path.join(home, 'id', 'config.json'), 'utf8'));
    assert.equal(config.ownerKey, undefined);
    assert.ok(config.profiles[alice.handle], 'agent keys stay');
    assert.equal((await cli(['agents', 'list'])).code, 1);
    await ok(['me']);
  });
});
