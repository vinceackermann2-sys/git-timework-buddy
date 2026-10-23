// An action the owner asked to approve first, from the CLI: it says it waits,
// and the owner sees exactly what it is.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';

describe('asking the owner first, from the CLI', () => {
  let api, home, env, owner, agent;
  const cli = (args, input) => runCli(args, { env, cwd: home, input });
  before(async () => {
    api = await startApi();
    home = tempDir('ask-first');
    owner = await api.local.user({ email: 'ask-owner@example.test' });
    await api.acceptTerms(owner.session);
    const created = await api.call('POST', '/v1/agents', { token: owner.session, body: { name: 'Rememberer' } });
    agent = created.agent;
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, '.codex'), home }, { TIMEWARP_AGENT_KEY: created.secret });
  });
  after(async () => {
    await api?.close();
    if (home) fs.rmSync(home, { recursive: true, force: true });
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
