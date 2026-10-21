// `timewarp-id attach` on a computer that isn't signed in: it prints a link,
// the person confirms their email and verifies who they are there (which
// makes their account), and the one Agent ID comes back to every app chosen.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const until = async (check, what) => {
  for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`Timed out waiting for ${what}`);
};

describe('timewarp-id attach without an account', () => {
  let api, home, env;
  before(async () => {
    api = await startApi({ env: { AGENT_ID_KYC: 'test' } });
    home = tempDir('claim');
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home });
    write(path.join(home, '.claude.json'), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
    write(path.join(home, 'codex', 'config.toml'), '');
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  // The person's side, as the claim page does it.
  async function finishAsPerson(code, email) {
    const sent = await api.call('POST', `/v1/claims/${code}/email`, { body: { email } });
    const confirmed = await api.call('POST', `/v1/claims/${code}/email/confirm`, { body: { code: sent.devCode } });
    const terms = (await api.call('GET', '/v1/config')).legal.termsVersion;
    const result = await api.local.call('POST', `/v1/claims/${code}/identity`, { headers: { 'timewarp-claim-session': confirmed.session }, body: { terms, consent: true, legalName: 'Ada Lovelace', country: 'GB' } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return confirmed.auth.access_token;
  }

  it('prints a link, waits for the person, and gives both apps the same Agent ID', async () => {
    const running = runCli(['attach', 'claude', 'codex', '--name', 'Ada\'s helper', '--json'], { env, cwd: home });
    const started = await until(() => api.requests.find(r => r.method === 'POST' && r.path === '/v1/claims' && r.status === 200), 'the claim');
    assert.equal(started.body.name, 'Ada\'s helper');
    assert.equal(started.body.app, 'claude-code');
    assert.ok(started.body.device);
    const { claim } = await until(async () => {
      const rows = (await api.local.db.query('select code from agent_id_claims order by created_at desc limit 1')).rows;
      return rows[0] && api.call('GET', `/v1/claims/${rows[0].code}`);
    }, 'the claim row');
    const session = await finishAsPerson(claim.code, 'ada@example.test');
    const result = await running;
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /open this link/i);
    assert.match(result.stderr, new RegExp(claim.matchCode));
    const attached = JSON.parse(result.stdout).attached;
    assert.deepEqual(attached.map(a => a.tool), ['Claude Code', 'Codex']);
    assert.equal(new Set(attached.map(a => a.agent.id)).size, 1, 'One Agent ID for both apps.');
    // The key is saved here and wired into both tools.
    const config = json(path.join(home, 'id', 'config.json'));
    const profile = Object.values(config.profiles)[0];
    assert.match(profile.key, /^twa_/);
    assert.ok(json(path.join(home, '.claude.json')).mcpServers['timewarp-id']);
    assert.match(fs.readFileSync(path.join(home, 'codex', 'config.toml'), 'utf8'), /timewarp_id|timewarp-id/);
    // The person's new account owns it, used in both apps.
    const { agents } = await api.call('GET', '/v1/agents', { token: session });
    assert.deepEqual(agents.map(a => [a.name, a.apps.map(x => x.app).sort()]), [['Ada\'s helper', ['claude-code', 'codex']]]);
  });

  it('finishes a claim started on the website with --claim', async () => {
    const started = await api.call('POST', '/v1/claims', { body: { name: 'Website agent', startedBy: 'person' } });
    await finishAsPerson(started.claim.code, 'grace@example.test');
    const project = path.join(home, 'proj');
    fs.mkdirSync(project, { recursive: true });
    const result = await runCli(['attach', '--here', '--claim', started.secret, '--json'], { env, cwd: project });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    const [attached] = JSON.parse(result.stdout).attached;
    assert.equal(attached.agent.name, 'Website agent');
    assert.doesNotMatch(result.stderr, /open this link/i, 'Nothing to open: the website already did it.');
    // A claim's key comes once.
    const again = await runCli(['attach', '--here', '--claim', started.secret, '--json'], { env, cwd: project });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already collected/i);
    assert.equal((await runCli(['attach', '--here', '--claim', 'nope'], { env, cwd: project })).code, 2);
  });
});
