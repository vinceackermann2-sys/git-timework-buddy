// The agent's memory from the CLI: what's already on this computer (Claude
// Code, Codex, Cursor, Antigravity, Windsurf) brought in with secrets left
// out, and the memory commands; actions the owner asked to approve first.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { collect, sections, withoutSecrets } from '../cli/src/memory.js';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// Made-up keys, put together here so none appears whole in the code.
const FAKE_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234';
const FAKE_TOKEN = 'gh' + 'p_abcdefghijklmnopqrstuvwxyz0123456789';

// A computer with each app's memory on it.
async function computerWithMemory(home, env) {
  write(path.join(home, '.claude', 'CLAUDE.md'), `# Style\nShort answers, no headings.\n<!-- timewarp-agent-id:start -->\nYou are Bot, an AI agent.\n<!-- timewarp-agent-id:end -->\n# Tools\nUse pnpm, not npm.\nAPI_KEY=${FAKE_KEY}\n`);
  write(path.join(home, '.claude', 'projects', 'C--work-acme', 'memory', 'MEMORY.md'), '- [User role](user_role.md) — data scientist\n');
  write(path.join(home, '.claude', 'projects', 'C--work-acme', 'memory', 'user_role.md'), '---\nname: user-role\ndescription: who the user is\n---\n\nThe user is a data scientist who works in Python.\n');
  write(path.join(env.CODEX_HOME, 'memories', 'MEMORY.md'), '# Projects\n## Acme\nAcme ships releases on Fridays.\n## Billing\nInvoices go out on the 1st.\n');
  write(path.join(home, '.gemini', 'GEMINI.md'), '## Gemini Added Memories\n- Prefers metric units.\n- Lives in Stockholm, Sweden.\n');
  write(path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'), 'Always write the tests first.\n');
  // Cursor's User Rules, in its settings database.
  let cursor = false;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const base = process.platform === 'win32' ? path.join(env.APPDATA, 'Cursor') : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cursor') : path.join(env.XDG_CONFIG_HOME, 'Cursor');
    const file = path.join(base, 'User', 'globalStorage', 'state.vscdb');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('create table ItemTable (key text unique on conflict replace, value blob)');
    db.prepare('insert into ItemTable values (?, ?)').run('aicontext.personalContext', 'Answer in British English.');
    db.close();
    cursor = true;
  } catch { /* Node without SQLite: Cursor is skipped */ }
  return { cursor };
}

describe('memory from this computer', () => {
  it('reads each app, as memories, without secrets or the identity block', async () => {
    const home = tempDir('memory-read');
    const env = cliEnv('http://unused', { idHome: path.join(home, 'id'), codexHome: path.join(home, '.codex'), home });
    try {
      const { cursor } = await computerWithMemory(home, env);
      const { found, removed } = await collect({ env, home });
      const texts = name => (found[name] || []).map(item => item.text);
      assert.deepEqual(texts('claude-code').sort(), ['Short answers, no headings.', 'The user is a data scientist who works in Python.', 'Use pnpm, not npm.'].sort());
      assert.equal(found['claude-code'].find(item => /data scientist/.test(item.text)).topic, 'user-role');
      assert.deepEqual(texts('codex'), ['Acme ships releases on Fridays.', 'Invoices go out on the 1st.']);
      assert.deepEqual(found.codex.map(item => item.topic), ['Acme', 'Billing']);
      assert.deepEqual(texts('antigravity'), ['Prefers metric units.', 'Lives in Stockholm, Sweden.'], 'Each remembered fact is its own memory.');
      assert.deepEqual(texts('windsurf'), ['Always write the tests first.']);
      if (cursor) assert.deepEqual(texts('cursor'), ['Answer in British English.']);
      assert.equal(removed, 1, 'The key line is left out.');
      const all = JSON.stringify(found);
      assert.ok(!all.includes('sk-abcdef') && !all.includes('You are Bot') && !all.includes('[User role]'));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('splits long sections and finds secrets in any line', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`).join('\n\n');
    const parts = sections(`# Notes\n${long}`, { from: 'codex', file: 'x' });
    assert.ok(parts.length > 1 && parts.every(part => part.text.length <= 4000 && part.topic === 'Notes'));
    assert.deepEqual(withoutSecrets('fine\npassword: hunter2-long\nalso fine'), { text: 'fine\nalso fine', removed: 1 });
  });
});

describe('the memory commands, against Agent ID', () => {
  let api, home, env, owner, agent, cursor;
  const cli = (args, input) => runCli(args, { env, cwd: home, input });
  before(async () => {
    api = await startApi();
    home = tempDir('memory');
    owner = await api.local.user({ email: 'memory-owner@example.test' });
    await api.acceptTerms(owner.session);
    const created = await api.call('POST', '/v1/agents', { token: owner.session, body: { name: 'Rememberer' } });
    agent = created.agent;
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, '.codex'), home }, { TIMEWARP_AGENT_KEY: created.secret });
    ({ cursor } = await computerWithMemory(home, env));
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('imports what is on this computer only when told to, never a secret, once', async () => {
    const unasked = await cli(['memory', 'import']);
    assert.equal(unasked.code, 2);
    assert.match(unasked.stderr, /Add --yes to import without being asked/);

    const preview = await cli(['memory', 'import', '--dry-run']);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /Claude Code: 3 memories\n {2}Codex: 2 memories/);
    assert.match(preview.stdout, /1 line that looked like keys or passwords left out/);
    assert.ok(!api.requests.some(r => r.path === '/v1/me/memories/import'), 'Nothing sent for a dry run.');

    const done = await cli(['memory', 'import', '--yes']);
    assert.equal(done.code, 0, done.stderr);
    const expected = 3 + 2 + 2 + 1 + (cursor ? 1 : 0);
    assert.match(done.stdout, new RegExp(`Imported ${expected} memories into`));
    const sent = JSON.stringify(api.requests.filter(r => r.path === '/v1/me/memories/import').map(r => r.body));
    assert.ok(sent.includes('metric units') && !sent.includes('sk-abcdef'), 'Sent without the secret.');
    assert.match((await cli(['memory', 'import', '--yes'])).stdout, new RegExp(`Imported 0 memories .*\\(${expected} already there\\)`));

    const listed = (await cli(['memory', 'list', '--json'])).json().memories;
    assert.deepEqual([...new Set(listed.map(m => m.from))].sort(), ['antigravity', 'claude-code', 'codex', ...(cursor ? ['cursor'] : []), 'windsurf'].sort());
  });

  it('searches, saves and forgets; a secret is sent to the vault instead', async () => {
    assert.match((await cli(['memory', 'search', 'metric'])).stdout, /Prefers metric units/);
    const saved = await cli(['memory', 'save', 'Lunch', 'is', 'at', 'noon', '--topic', 'Food']);
    assert.equal(saved.code, 0, saved.stderr);
    const id = /mem_[a-z0-9]{24}/.exec(saved.stdout)[0];
    assert.match((await cli(['memory', 'search', 'lunch'])).stdout, new RegExp(id));
    const secret = await cli(['memory', 'save', `my token is ${FAKE_TOKEN}`]);
    assert.equal(secret.code, 1);
    assert.match(secret.stderr, /vault/);
    assert.equal((await cli(['memory', 'forget', id])).code, 0);
    assert.doesNotMatch((await cli(['memory', 'search', 'lunch'])).stdout, new RegExp(id));
    // The owner sees all of it.
    const owners = await api.call('GET', `/v1/agents/${agent.id}/memories`, { token: owner.session });
    assert.ok(owners.memories.some(m => m.text === 'Prefers metric units.'));
  });

  it('says when an action waits for the owner, who sees what it is', async () => {
    await api.call('POST', `/v1/agents/${agent.id}/resources`, { token: owner.session, body: { kind: 'mail' } });
    await api.call('PATCH', `/v1/agents/${agent.id}`, { token: owner.session, body: { askFirst: { mail: true } } });
    const sent = await cli(['mail', 'send', '--to', 'someone@example.test', '--subject', 'Hello there', '--text', 'Hi!']);
    assert.equal(sent.code, 0, sent.stderr);
    assert.match(sent.stdout, /Waiting for the owner: they asked to approve this first\. Nothing was done yet\./);
    const approval = /Approval id: ([0-9a-f-]{36})/.exec(sent.stdout)[1];
    const ownerKey = await api.ownerKey(owner);
    const listed = await runCli(['approvals'], { env: { ...env, TIMEWARP_AGENT_KEY: '', TIMEWARP_OWNER_KEY: ownerKey }, cwd: home });
    assert.match(listed.stdout, /Rememberer\s+email to someone@example\.test: "Hello there"/);
    const decided = await api.call('POST', `/v1/approvals/${approval}`, { token: owner.session, body: { decision: 'approve' } });
    assert.equal(decided.status, 'completed');
  });
});
