// Attaching an Agent ID made on the dashboard (no key on this computer yet)
// in one command, and Timewarp agents whose folder still has an old name.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { desktopIdOf } from '../cli/src/commands/attach.js';

describe('attach an agent made elsewhere', () => {
  let api, home, project, env, owner, ownerKey;
  before(async () => {
    api = await startApi();
    owner = await api.local.user({ email: 'web@example.test' });
    ownerKey = await api.ownerKey(owner);
    home = tempDir('attach-existing');
    project = path.join(home, 'shop-bot');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Shop bot\n');
    env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home }, { TIMEWARP_PROFILE_DIR: path.join(home, 'tw') });
  });
  after(async () => { await api?.close(); if (home) fs.rmSync(home, { recursive: true, force: true }); });

  it('fetches a key for this computer and attaches it, once logged in', async () => {
    const made = await api.call('POST', '/v1/agents', { token: owner.session, body: { name: 'Shop Bot', key: false } });
    const handle = made.agent.handle;
    const before = await runCli(['attach', '--here', '--agent', handle, '--yes'], { env, cwd: project });
    assert.notEqual(before.code, 0, 'Without a login there is no key to use.');
    assert.match(before.stderr, /timewarp-id login/);
    assert.equal((await runCli(['login', '--owner-key', ownerKey], { env, cwd: project })).code, 0);
    const attached = await runCli(['attach', '--here', '--agent', handle, '--yes', '--json'], { env, cwd: project });
    assert.equal(attached.code, 0, attached.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.timewarp-id.json'), 'utf8')), { agent: handle });
    assert.match(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), new RegExp(made.agent.id));
    const me = await runCli(['me', '--json'], { env, cwd: project });
    assert.equal(JSON.parse(me.stdout).agent.id, made.agent.id, 'Commands in the folder act as the attached agent.');
    const keys = (await api.call('GET', `/v1/agents/${made.agent.id}`, { token: owner.session })).keys;
    assert.equal(keys.length, 1, 'One key was made for this computer.');
  });
});

describe('Timewarp desktop agent ids', () => {
  it('reads the UUID at the end of the folder, even after a rename', () => {
    assert.equal(desktopIdOf('timewarp-5d9718a8-4312-4a39-9a49-492e3f4f6601', 'Elon'), '5d9718a8-4312-4a39-9a49-492e3f4f6601');
    assert.equal(desktopIdOf('main-assistant-01a10b77-b00a-77a4-9b26-adf3375ca22d', 'Main Assistant'), '01a10b77-b00a-77a4-9b26-adf3375ca22d');
    assert.equal(desktopIdOf('research-assistant-7f3c-22aa', 'Research Assistant'), '7f3c-22aa');
  });
});
