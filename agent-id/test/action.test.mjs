// The GitHub Action's commit check and the pre-receive hook, in real Git
// repositories, against allowed signers from the real Agent ID service.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, cliEnv, run, runCli, startApi, tempDir } from '../testing/local-api.mjs';

const SCRIPT = path.join(ROOT, 'action', 'verify-commits.mjs');
const HOOK = path.join(ROOT, 'hooks', 'pre-receive.sh');
const HUMAN = 'lead@acme.test';
const SIGNERS_FILE = '.github/allowed_signers';

// Whether Git can sign commits with an SSH key here.
async function sshSigningWorks(dir, env) {
  const key = path.join(dir, 'probe_ed25519');
  const made = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'probe', '-f', key], { env }).catch(error => ({ code: -1, stderr: error.message }));
  if (made.code !== 0) return `ssh-keygen could not make a key: ${made.stderr}`;
  const repo = path.join(dir, 'probe-repo');
  fs.mkdirSync(repo);
  await run('git', ['init', '-q', repo], { env });
  const signed = await run('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@test', '-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}.pub`, 'commit', '-q', '-S', '--allow-empty', '-m', 'probe'], { env, cwd: repo });
  return signed.code === 0 ? null : `git could not sign with SSH: ${signed.stderr}`;
}

describe('Agent ID commit check (GitHub Action and pre-receive hook)', () => {
  let api, dir, env, repo, org, secret, leadKey, strangerKey, humanLine, strangerLine, skip = null;
  const shas = {};
  const git = async (args, options = {}) => {
    const result = await run('git', args, { env, cwd: repo, ...options });
    assert.equal(result.code, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
    return result.stdout.trim();
  };
  // `config` goes before `commit` (-c …), `extra` after it (--author …).
  const commit = async (name, config = [], extra = []) => {
    await git([...config, 'commit', '-q', '--allow-empty', '-m', name, ...extra]);
    shas[name] = await git(['rev-parse', 'HEAD']);
  };
  const cli = async (args, cwd) => {
    const result = await runCli(args, { env, cwd: cwd || dir });
    assert.equal(result.code, 0, `timewarp-id ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const check = (extra = {}) => run(process.execPath, [SCRIPT], {
    cwd: repo,
    env: { ...env, AGENT_ID_ORGANIZATION: org, AGENT_ID_SECRET: '', AGENT_ID_API: api.base, AGENT_ID_HUMAN_SIGNERS: SIGNERS_FILE, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: '', GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', ...extra },
  });
  const lineFor = (result, name) => result.stdout.split('\n').find(l => /^(PASS|FAIL) /.test(l) && l.includes(shas[name].slice(0, 12))) || '';
  const agentSigned = (handle, name) => {
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'id', 'config.json'), 'utf8'));
    return ['-c', `user.signingkey=${path.join(dir, 'id', 'keys', `${handle}_ed25519.pub`)}`, '-c', `user.name=${name}`, '-c', `user.email=${config.profiles[handle].agentId}@agents.timewarpdev.com`];
  };
  const keySigned = (key, name, email) => ['-c', 'gpg.format=ssh', '-c', 'commit.gpgsign=true', '-c', `user.signingkey=${key}.pub`, '-c', `user.name=${name}`, '-c', `user.email=${email}`];
  const unsigned = (name, email) => ['-c', 'commit.gpgsign=false', '-c', `user.name=${name}`, '-c', `user.email=${email}`];
  const signerLine = (principal, key) => `${principal} namespaces="git" ${fs.readFileSync(`${key}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ')}`;

  before(async () => {
    dir = tempDir('action');
    env = cliEnv('', { idHome: path.join(dir, 'id'), codexHome: path.join(dir, 'codex'), home: dir });
    skip = await sshSigningWorks(dir, env);
    if (skip) return;
    api = await startApi();
    env.AGENT_ID_API = api.base;

    // A company: an organization whose owner is a verified person (and, for
    // the older setup, a company secret registered for it).
    const owner = await api.local.user({ email: 'owner@acme.test', plan: 'pro' });
    const reviewer = await api.local.user({ email: 'reviewer@timewarp.test' });
    org = await api.local.organization('Acme', [[owner, 'owner']]);
    const ownerKey = await api.ownerKey(owner);
    await api.acceptTerms(ownerKey);
    api.local.setEnv({ AGENT_ID_REVIEWERS: reviewer.id });
    await api.call('POST', '/v1/account/verification', { token: ownerKey, body: { kind: 'person', legalName: 'Ada Lovelace', country: 'GB', consent: true } });
    await api.call('POST', `/v1/reviews/person/${owner.id}`, { token: reviewer.session, body: { decision: 'approve' } });
    secret = (await api.call('POST', '/v1/relying-parties', { token: ownerKey, body: { name: 'Acme CI', audience: 'https://github.com/acme/app', organizationId: org } })).secret;

    // Agents: two in the organization, one outside it; each gets a signing key.
    await cli(['login', '--owner-key', ownerKey]);
    for (const [name, flags] of [['Coder', ['--org', org]], ['Rogue', ['--org', org]], ['Outsider', []]]) {
      const created = JSON.parse((await cli(['agents', 'create', name, ...flags, '--json'])).stdout);
      shas[`handle:${name}`] = created.agent.handle;
      const scratch = path.join(dir, `setup-${name}`);
      fs.mkdirSync(scratch);
      await run('git', ['init', '-q', scratch], { env });
      await cli(['git', 'setup', '--agent', created.agent.handle], scratch);
    }

    // A human who signs with their own SSH key, and a stranger with a key nobody listed.
    leadKey = path.join(dir, 'lead_ed25519');
    strangerKey = path.join(dir, 'stranger_ed25519');
    for (const key of [leadKey, strangerKey]) assert.equal((await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', path.basename(key), '-f', key], { env })).code, 0);
    humanLine = signerLine(HUMAN, leadKey);
    strangerLine = signerLine('stranger@evil.test', strangerKey);

    // The repository: the human's signed base commit holds the human signers
    // file; then commits of every kind.
    repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    await git(['init', '-q', '-b', 'main']);
    fs.mkdirSync(path.join(repo, '.github'));
    fs.writeFileSync(path.join(repo, SIGNERS_FILE), `# People who sign their own commits\n${humanLine}\n`);
    await git(['add', SIGNERS_FILE]);
    await commit('base', keySigned(leadKey, 'Lead Human', HUMAN));
    const setup = JSON.parse((await cli(['git', 'setup', '--agent', shas['handle:Coder'], '--json'], repo)).stdout);
    assert.equal(setup.registered, false, 'the key made in the scratch repository is reused');
    assert.equal(await git(['config', 'commit.gpgsign']), 'true');
    await commit('coder: first change');
    await commit('rogue: change', agentSigned(shas['handle:Rogue'], 'Rogue'));
    await commit('mallory: unsigned', unsigned('Mallory', 'mallory@evil.test'));
    await commit('stranger: unregistered key', keySigned(strangerKey, 'Stranger', 'stranger@evil.test'));
    await commit('outsider: other organization', agentSigned(shas['handle:Outsider'], 'Outsider'));
    await commit('human: signed', keySigned(leadKey, 'Lead Human', HUMAN));
    await commit('human: spoofed author', unsigned('Mallory', 'mallory@evil.test'), ['--author', `Lead Human <${HUMAN}>`]);
    await commit('human: spoofed, stranger key', keySigned(strangerKey, 'Lead Human', HUMAN));
    // A commit that tries to list its own key: it only counts once merged.
    fs.appendFileSync(path.join(repo, SIGNERS_FILE), `${strangerLine}\n`);
    await git(['add', SIGNERS_FILE]);
    await commit('stranger: adds own key', keySigned(strangerKey, 'Stranger', 'stranger@evil.test'));
    // A signed merge of a signed branch.
    await git(['checkout', '-q', '-b', 'feature']);
    await commit('coder: feature');
    await git(['checkout', '-q', 'main']);
    await commit('coder: main');
    await git(['merge', '-q', '--no-ff', '-m', 'coder: merge feature', 'feature']);
    shas['coder: merge feature'] = await git(['rev-parse', 'HEAD']);
  });
  after(async () => {
    await api?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('git setup configured the repository to sign as the agent', async t => {
    if (skip) return t.skip(skip);
    assert.equal(await git(['config', 'gpg.format']), 'ssh');
    assert.match(await git(['config', 'user.email']), /^agt_[a-z0-9]{24}@agents\.timewarpdev\.com$/);
    assert.equal(await git(['config', 'user.name']), 'Coder');
    assert.ok((await git(['config', 'user.signingkey'])).endsWith(`${shas['handle:Coder']}_ed25519.pub`));
    assert.match(await git(['cat-file', 'commit', shas['coder: merge feature']]), /BEGIN SSH SIGNATURE/);
  });

  it('passes commits signed by agents and listed humans, fails everything else', async t => {
    if (skip) return t.skip(skip);
    const result = await check({ AGENT_ID_BASE: shas.base, AGENT_ID_HEAD: 'HEAD' });
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /2 agent signing keys .*; 1 human signer line from \.github\/allowed_signers at [0-9a-f]{12}/);
    for (const name of ['coder: first change', 'rogue: change', 'coder: feature', 'coder: main', 'coder: merge feature']) assert.match(lineFor(result, name), /^PASS.*: signed by agent agt_[a-z0-9]{24}@/, name);
    assert.match(lineFor(result, 'coder: merge feature'), /\(merge\)/);
    assert.match(lineFor(result, 'human: signed'), /^PASS.*: signed by human signer lead@acme\.test$/);
    assert.match(lineFor(result, 'mallory: unsigned'), /^FAIL.*: not signed$/);
    assert.match(lineFor(result, 'human: spoofed author'), /^FAIL.*: not signed$/, 'an allowed author email alone proves nothing');
    for (const name of ['stranger: unregistered key', 'outsider: other organization', 'human: spoofed, stranger key', 'stranger: adds own key']) {
      assert.match(lineFor(result, name), /^FAIL.*: signed with a key that is neither a current agent of this organization nor a listed human signer$/, name);
    }
    assert.match(result.stderr, /6 commits are not signed by a current agent of this organization or a listed human signer/);
  });

  it("fails a revoked agent's commits from the moment it is revoked", async t => {
    if (skip) return t.skip(skip);
    await cli(['agents', 'revoke', shas['handle:Rogue'], '--yes']);
    const result = await check({ AGENT_ID_BASE: shas.base, AGENT_ID_HEAD: shas['coder: first change'] });
    assert.equal(result.code, 0, 'the commits before it still pass');
    const after = await check({ AGENT_ID_BASE: shas.base, AGENT_ID_HEAD: shas['rogue: change'] });
    assert.equal(after.code, 1);
    assert.match(after.stdout, new RegExp(`FAIL ${shas['rogue: change'].slice(0, 12)}.*neither a current agent`));
  });

  it('takes human signers inline or from the base commit, never from the commits checked', async t => {
    if (skip) return t.skip(skip);
    const just = name => ({ AGENT_ID_BASE: `${shas[name]}^`, AGENT_ID_HEAD: shas[name] });
    const none = await check({ ...just('human: signed'), AGENT_ID_HUMAN_SIGNERS: '' });
    assert.equal(none.code, 1, 'without human signers a human commit fails');
    assert.match(lineFor(none, 'human: signed'), /FAIL.*neither a current agent/, none.stderr);

    const inline = await check({ ...just('human: signed'), AGENT_ID_HUMAN_SIGNERS: humanLine });
    assert.equal(inline.code, 0, inline.stdout + inline.stderr);
    assert.match(lineFor(inline, 'human: signed'), /signed by human signer lead@acme\.test/);
    const several = await check({ ...just('human: signed'), AGENT_ID_HUMAN_SIGNERS: `# humans\n${strangerLine}\r\n${humanLine}\n` });
    assert.equal(several.code, 0, several.stdout + several.stderr);

    // The stranger's own commit added its key to the file; the base commit's
    // copy doesn't have it, so it fails.
    const self = await check(just('stranger: adds own key'));
    assert.equal(self.code, 1);
    assert.match(lineFor(self, 'stranger: adds own key'), /FAIL.*neither a current agent/);

    const missing = await check({ ...just('human: signed'), AGENT_ID_HUMAN_SIGNERS: 'nope/allowed_signers' });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /nope\/allowed_signers, which is not in the base commit/);
    const malformed = await check({ ...just('human: signed'), AGENT_ID_HUMAN_SIGNERS: `# humans\n${HUMAN} is trusted\n` });
    assert.equal(malformed.code, 1);
    assert.match(malformed.stderr, /human-signers line 1 is not an allowed_signers line/);

    // The removed email allowlist doesn't let anything through.
    const legacy = await check({ ...just('human: spoofed author'), AGENT_ID_ALLOW_UNSIGNED_AUTHORS: HUMAN });
    assert.equal(legacy.code, 1);
    assert.match(legacy.stderr, /allow-unsigned-authors was removed/);
    assert.match(lineFor(legacy, 'human: spoofed author'), /FAIL.*not signed/);
  });

  it('reads base and head from a pull_request event and reports to GitHub', async t => {
    if (skip) return t.skip(skip);
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: shas['stranger: adds own key'] }, head: { sha: shas['coder: merge feature'] } } }));
    const summary = path.join(dir, 'summary.md'), output = path.join(dir, 'output.txt');
    const clean = await check({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output });
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /checking 3 commits/);
    assert.match(fs.readFileSync(summary, 'utf8'), /all 3 commits are signed by allowed agents or humans/);
    assert.match(fs.readFileSync(output, 'utf8'), /checked=3\nfailed=0\nfailed-commits=\nagent-commits=3\nhuman-commits=0\n/);

    fs.writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: shas.base }, head: { sha: shas['coder: merge feature'] } } }));
    const failing = await check({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output });
    assert.equal(failing.code, 1);
    assert.match(failing.stdout, /::error title=Commit not signed by an allowed agent or human::/);
    assert.match(fs.readFileSync(output, 'utf8'), /human-commits=1\n$/);
  });

  it('reads the organization\'s public list, with no secret', t => {
    if (skip) return t.skip(skip);
    const fetches = api.requests.filter(r => r.path === `/v1/orgs/${org}/allowed-signers`);
    assert.ok(fetches.length > 0);
    assert.ok(fetches.every(r => r.headers.authorization === undefined));
  });

  it('still works with a company secret from older setups', async t => {
    if (skip) return t.skip(skip);
    const result = await check({ AGENT_ID_ORGANIZATION: '', AGENT_ID_SECRET: secret, AGENT_ID_BASE: shas['human: signed'], AGENT_ID_HEAD: shas['coder: merge feature'] });
    assert.match(result.stdout, /PASS .*coder: merge feature/, result.stdout + result.stderr);
    const wrong = await check({ AGENT_ID_ORGANIZATION: '', AGENT_ID_SECRET: 'twrp_wrong', AGENT_ID_BASE: shas['human: signed'] });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /did not list the allowed signers.*invalid_key/);
  });

  it('fails closed without an organization, or when Agent ID can\'t be asked', async t => {
    if (skip) return t.skip(skip);
    const missing = await check({ AGENT_ID_ORGANIZATION: '', AGENT_ID_BASE: shas.base });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /`organization` input is required/);
    const odd = await check({ AGENT_ID_ORGANIZATION: '../../v1/me', AGENT_ID_BASE: shas['human: signed'] });
    assert.equal(odd.code, 1);
    assert.match(odd.stderr, /not an organization id/);
    const unknown = await check({ AGENT_ID_ORGANIZATION: '00000000-0000-4000-8000-000000000999', AGENT_ID_BASE: shas['human: signed'], AGENT_ID_HEAD: shas['coder: merge feature'] });
    assert.equal(unknown.code, 1, 'an organization Agent ID doesn\'t know lets nothing through');
    const down = await check({ AGENT_ID_API: 'http://127.0.0.1:9/agent-id', AGENT_ID_BASE: shas['human: signed'] });
    assert.equal(down.code, 1);
    assert.match(down.stderr, /could not reach Agent ID/);
  });

  it('the pre-receive hook accepts agent and human-signed commits and rejects the rest', async t => {
    if (skip) return t.skip(skip);
    const server = path.join(dir, 'server.git');
    await run('git', ['init', '-q', '--bare', server], { env });
    fs.copyFileSync(HOOK, path.join(server, 'hooks', 'pre-receive'));
    fs.chmodSync(path.join(server, 'hooks', 'pre-receive'), 0o755);
    const humans = path.join(dir, 'server_human_signers');
    fs.writeFileSync(humans, `# Admins only\r\n${humanLine}\r\n`);
    const push = (refspec, extra = {}) => run('git', ['push', server, refspec], { cwd: repo, env: { ...env, AGENT_ID_ORGANIZATION: org, AGENT_ID_SECRET: '', AGENT_ID_API: api.base, AGENT_ID_HUMAN_SIGNERS_FILE: humans, ...extra } });

    const good = await push(`${shas['coder: first change']}:refs/heads/main`);
    assert.equal(good.code, 0, good.stderr);
    const bad = await push(`${shas['mallory: unsigned']}:refs/heads/main`);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, new RegExp(`${shas['rogue: change'].slice(0, 12)}.*neither a current agent`));
    assert.match(bad.stderr, new RegExp(`${shas['mallory: unsigned'].slice(0, 12)}.*not signed`));
    assert.match(bad.stderr, /push rejected/);

    // A human's signed commit, and one that only claims to be theirs.
    await git(['checkout', '-q', '-b', 'hook-human', shas['coder: first change']]);
    try {
      await commit('hook: human signed', keySigned(leadKey, 'Lead Human', HUMAN));
      const withoutList = await push('HEAD:refs/heads/hook-human', { AGENT_ID_HUMAN_SIGNERS_FILE: '' });
      assert.notEqual(withoutList.code, 0);
      assert.match(withoutList.stderr, /hook: human signed.*neither a current agent/);
      const human = await push('HEAD:refs/heads/hook-human');
      assert.equal(human.code, 0, human.stderr);
      await commit('hook: spoofed author', unsigned('Mallory', 'mallory@evil.test'), ['--author', `Lead Human <${HUMAN}>`]);
      const spoofed = await push('HEAD:refs/heads/hook-human', { AGENT_ID_ALLOW_UNSIGNED_AUTHORS: HUMAN });
      assert.notEqual(spoofed.code, 0);
      assert.match(spoofed.stderr, /hook: spoofed author" \(author lead@acme\.test, unverified\): not signed/);
      assert.match(spoofed.stderr, /allowUnsignedAuthors was removed/);
    } finally {
      await git(['checkout', '-q', 'main']);
    }

    const unreadable = await push(`${shas['coder: first change']}:refs/heads/other`, { AGENT_ID_HUMAN_SIGNERS_FILE: path.join(dir, 'missing') });
    assert.notEqual(unreadable.code, 0);
    assert.match(unreadable.stderr, /human signers file .* can't be read/);
    const already = await push(`${shas.base}:refs/heads/human`, { AGENT_ID_HUMAN_SIGNERS_FILE: '' });
    assert.equal(already.code, 0, 'commits already on the server are not checked again');
    const noOrganization = await push(`${shas['coder: first change']}:refs/heads/other`, { AGENT_ID_ORGANIZATION: '' });
    assert.notEqual(noOrganization.code, 0);
    assert.match(noOrganization.stderr, /no organization is configured/);
    const legacy = await push(`${shas['coder: first change']}:refs/heads/legacy`, { AGENT_ID_ORGANIZATION: '', AGENT_ID_SECRET: secret });
    assert.equal(legacy.code, 0, `a company secret still works: ${legacy.stderr}`);
  });
});
