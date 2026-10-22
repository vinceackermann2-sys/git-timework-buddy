// An agent saving into its vault: the key or password is sealed on the
// agent's own computer (by the CLI, or its MCP server) before anything is
// sent, so Agent ID only ever receives it sealed.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLI, cliEnv, runCli, startApi, tempDir } from '../testing/local-api.mjs';
import { hostsOf, seal, sendOf, vaultItem } from '../cli/src/vault.js';
import { createProxy, VAULT_SAVE_TOOL } from '../cli/src/commands/mcp.js';

// What the vault on the agent's computer does with an envelope.
function open(privateKey, envelope) {
  const aes = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const data = Buffer.from(envelope.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', aes, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8'));
}
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

describe('saving into the vault', () => {
  it('seals an item so only the vault opens it, and checks it first', () => {
    const item = vaultItem({ kind: 'key', secret: 're_secret_1', hosts: 'https://api.resend.com/emails, *.Example.com', as: 'header:X-Api-Key' });
    assert.deepEqual(item, { kind: 'key', value: 're_secret_1', hosts: ['api.resend.com', '*.example.com'], send: { as: 'header', name: 'X-Api-Key' } });
    const envelope = seal(pair.publicKey, item);
    assert.equal(envelope.v, 1);
    assert.ok(!JSON.stringify(envelope).includes('re_secret_1'));
    assert.deepEqual(open(pair.privateKey, envelope), item);

    assert.deepEqual(vaultItem({ kind: 'login', secret: 'pw-long-1', site: 'https://github.com/login', username: 'ada' }), { kind: 'login', site: 'https://github.com', username: 'ada', password: 'pw-long-1' });
    assert.deepEqual(sendOf('basic:ada'), { as: 'basic', username: 'ada' });
    assert.deepEqual(sendOf(undefined), { as: 'bearer' });
    assert.throws(() => sendOf('header'), /needs its name/);
    assert.throws(() => hostsOf(''), /Name the sites/);
    assert.throws(() => hostsOf('not a host'), /isn't a website's address/);
    assert.throws(() => vaultItem({ kind: 'key', secret: '  ', hosts: 'a.example.com' }), /nothing to save/);
    assert.throws(() => vaultItem({ kind: 'login', secret: 'pw', site: 'http://example.com' }), /https/);
  });

  it('the MCP server offers vault_save to agents with a vault, and answers it itself, sealed', async () => {
    const written = [], forwarded = [], saved = [];
    const fetchImpl = async (_url, init) => {
      const message = JSON.parse(init.body);
      forwarded.push(message);
      const tools = [{ name: 'whoami' }, { name: 'vault_list' }, { name: 'vault_request' }];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'tools/list' ? { tools } : {} }), { headers: { 'content-type': 'application/json' } });
    };
    const vault = {
      list: async () => ({ ready: true, publicKey: pair.publicKey, items: [] }),
      save: async body => { saved.push(body); return { item: { id: 'vlt_000000000000000000000001', kind: 'key', label: body.label, savedBy: 'agent' } }; },
    };
    const proxy = createProxy({ url: 'http://agent-id.test/mcp', auth: async () => ({}), fetchImpl, write: m => written.push(m), log: () => {}, vault });

    await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = written.at(-1).result.tools.map(t => t.name);
    assert.ok(names.includes('vault_save'));
    assert.deepEqual(written.at(-1).result.tools.find(t => t.name === 'vault_save'), VAULT_SAVE_TOOL);

    await proxy.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'vault_save', arguments: { label: 'Resend', kind: 'key', secret: 're_mcpSecret_42', hosts: 'api.resend.com' } } });
    const reply = written.at(-1);
    assert.equal(reply.id, 2);
    assert.equal(reply.result.isError, undefined);
    assert.match(reply.result.content[0].text, /Saved, sealed on this computer/);
    assert.ok(!forwarded.some(m => m.params?.name === 'vault_save'), 'Not sent to Agent ID as a tool call.');
    assert.equal(saved.length, 1);
    assert.ok(!JSON.stringify(saved).includes('re_mcpSecret_42'), 'Only sealed.');
    assert.deepEqual(open(pair.privateKey, saved[0].envelope), { kind: 'key', value: 're_mcpSecret_42', hosts: ['api.resend.com'], send: { as: 'bearer' } });

    // Without a vault, it says so; with bad input, it says what's wrong.
    vault.list = async () => ({ ready: false, items: [], note: 'The vault isn\'t set up yet.' });
    await proxy.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vault_save', arguments: { label: 'X', kind: 'key', secret: 'abcd1234', hosts: 'api.example.com' } } });
    assert.deepEqual([written.at(-1).result.isError, written.at(-1).result.content[0].text], [true, 'The vault isn\'t set up yet.']);
    await proxy.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'vault_save', arguments: { label: 'X', kind: 'key', secret: 'abcd1234' } } });
    assert.match(written.at(-1).result.content[0].text, /Name the sites/);

    // An agent without a vault (no computer) isn't offered it.
    const bare = createProxy({ url: 'http://agent-id.test/mcp', auth: async () => ({}), write: m => written.push(m), log: () => {}, vault,
      fetchImpl: async (_url, init) => new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { tools: [{ name: 'whoami' }] } }), { headers: { 'content-type': 'application/json' } }) });
    await bare.handle({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    assert.deepEqual(written.at(-1).result.tools.map(t => t.name), ['whoami']);
  });

  describe('through the CLI, against Agent ID', () => {
    let api, home, env, owner, agent;
    const cli = (args, input) => runCli(args, { env, cwd: home, input });
    before(async () => {
      api = await startApi();
      home = tempDir('vault');
      owner = await api.local.user({ email: 'vault-owner@example.test' });
      await api.acceptTerms(owner.session);
      const created = await api.call('POST', '/v1/agents', { token: owner.session, body: { name: 'Keeper' } });
      agent = created.agent;
      env = cliEnv(api.base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home }, { TIMEWARP_AGENT_KEY: created.secret });
    });
    after(async () => {
      await api?.close();
      if (home) fs.rmSync(home, { recursive: true, force: true });
    });

    it('saves a key from stdin, sealed here, then uses it without seeing it', async () => {
      const early = await cli(['vault', 'save', '--label', 'Resend', '--for', 'api.resend.com'], 're_early\n');
      assert.notEqual(early.code, 0);
      assert.match(early.stderr, /isn't set up yet/);

      await api.call('POST', `/v1/agents/${agent.id}/vault/setup`, { token: owner.session, body: {} });
      const flag = await cli(['vault', 'save', '--label', 'Resend', '--for', 'api.resend.com', '--secret', 're_flagSecret']);
      assert.notEqual(flag.code, 0);
      assert.match(flag.stderr, /shell would keep it in its history/);

      const before = api.requests.length;
      const saved = await cli(['vault', 'save', '--label', 'Resend', '--for', 'https://api.resend.com/emails'], 're_cliSecret_77\n');
      assert.equal(saved.code, 0, saved.stderr);
      assert.match(saved.stdout, /Saved "Resend" in the vault \(vlt_[a-z0-9]{24}\), sealed on this computer/);
      const sent = api.requests.slice(before);
      assert.ok(sent.some(r => r.method === 'POST' && r.path === '/v1/me/vault/items' && r.body?.envelope), 'Sent sealed.');
      assert.ok(!JSON.stringify(sent.map(r => r.body)).includes('re_cliSecret_77'), 'Never in the clear.');

      const listed = (await cli(['vault', 'list', '--json'])).json();
      const item = listed.items.find(i => i.label === 'Resend');
      assert.deepEqual([item.kind, item.hosts, item.savedBy], ['key', ['api.resend.com'], 'agent']);
      assert.match((await cli(['vault', 'list'])).stdout, /Resend\s+api\.resend\.com\s+agent/);

      // A test computer says what it would have sent; elsewhere, it doesn't go.
      const used = await cli(['vault', 'request', item.id, 'https://api.resend.com/domains']);
      assert.equal(used.code, 0, used.stderr);
      assert.match(used.stdout, /would go to api\.resend\.com with the key added/);
      const elsewhere = await cli(['vault', 'request', item.id, 'https://evil.example/collect']);
      assert.notEqual(elsewhere.code, 0);
      assert.match(elsewhere.stderr, /can only be sent to api\.resend\.com/);

      // The owner sees what the agent saved.
      const owners = await api.call('GET', `/v1/agents/${agent.id}/vault`, { token: owner.session });
      assert.equal(owners.items.find(i => i.id === item.id).savedBy, 'agent');
    });

    it('the stdio MCP server saves through vault_save the same way', async () => {
      const child = spawn(process.execPath, [CLI, 'mcp'], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'] });
      const replies = new Map();
      let buffer = '', stderr = '';
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      const waiting = [];
      child.stdout.setEncoding('utf8').on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const message = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
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
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } } });
      await reply(1);
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      assert.ok((await reply(2)).result.tools.some(t => t.name === 'vault_save'));
      const before = api.requests.length;
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vault_save', arguments: { label: 'GitHub', kind: 'login', secret: 'gh-mcp-password', site: 'https://github.com/login', username: 'keeper' } } });
      const saved = await reply(3);
      assert.equal(saved.result.isError, undefined, saved.result.content[0].text);
      assert.ok(!JSON.stringify(api.requests.slice(before).map(r => r.body)).includes('gh-mcp-password'), 'Never in the clear.');
      child.stdin.end();
      await new Promise(resolve => child.on('close', resolve));
      const owners = await api.call('GET', `/v1/agents/${agent.id}/vault`, { token: owner.session });
      assert.deepEqual(owners.items.filter(i => i.label === 'GitHub').map(i => [i.kind, i.site, i.savedBy]), [['login', 'https://github.com', 'agent']]);
    });
  });
});
