// The wallet, card application, mail attachment and trash, and machine file
// commands, against a stand-in API that answers like the endpoints the
// dashboard uses, recording what the CLI sends.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { cliEnv, runCli, tempDir } from '../testing/local-api.mjs';
import { balanceLine } from '../cli/src/commands/act.js';

const AGENT = 'agt_aaaaaaaaaaaaaaaaaaaaaaaa';

function standIn() {
  const seen = [];
  let application = null, files = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname.replace(/^\/agent-id/, '')}`;
    const body = /json/.test(req.headers['content-type'] || '') && raw.length ? JSON.parse(raw.toString('utf8')) : null;
    seen.push({ route, query: Object.fromEntries(url.searchParams), headers: req.headers, body, raw });
    const send = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    const usd = amount => ({ amount, currency: 'USD', display: `${(amount / 100).toFixed(2)} USD` });
    switch (route) {
      case 'GET /v1/me/wallet':
        return send(200, { wallet: { address: '0xabc', mode: 'live', network: 'base', currency: 'USD', balance: usd(1234), assets: [{ asset: 'usdc', amount: usd(1000) }, { asset: 'usdt', amount: usd(234) }], limits: { perTransfer: 5000 }, sent: { last24Hours: usd(0), last30Days: null } } });
      case 'POST /v1/me/wallet/transfers':
        return send(200, { status: 'completed', transfer: { amount: usd(500), counterparty: body.to }, balance: usd(734) });
      case `GET /v1/agents/${AGENT}/card-application`:
        return send(200, { application });
      case `POST /v1/agents/${AGENT}/card-application`:
        application = { status: 'submitted', useCase: body.useCase, monthlySpend: usd(body.monthlySpend), country: body.country, createdAt: '2026-10-20T12:00:00.000Z' };
        return send(200, { application });
      case 'POST /v1/me/files':
        files++;
        return send(200, { file: { id: `file_${files}`, filename: decodeURIComponent(req.headers['x-filename']), contentType: req.headers['content-type'], size: raw.length } });
      case 'POST /v1/me/mail':
        return send(200, { message: { id: 'msg_1', subject: body.subject, counterparty: body.to.join(', '), status: 'sent' } });
      case 'GET /v1/me/mail/msg_1':
        return send(200, { message: { id: 'msg_1', direction: 'in', counterparty: 'ada@example.com', subject: 'Report', text: 'Attached.', at: '2026-10-20T12:00:00.000Z', attachments: [{ id: 'file_9', filename: 'report.pdf', contentType: 'application/pdf', size: 2048 }] } });
      case 'POST /v1/me/mail/msg_1/move':
        return send(200, { folder: body.folder });
      case 'GET /v1/me/vm/files':
        return send(200, { path: url.searchParams.get('path') || '/home/agent', entries: [{ name: 'notes.txt', type: 'file', size: 2048, modifiedAt: '2026-10-20T10:00:00.000Z' }, { name: 'src', type: 'dir', size: null, modifiedAt: null }] });
      default:
        return send(404, { error: { code: 'not_found', message: `No ${route} here.` } });
    }
  });
  return { server, seen };
}

describe('wallet, card application, mail attachments and trash, machine files', () => {
  let api, home, env;
  const cli = args => runCli(args, { env, cwd: home });
  const ok = async args => {
    const result = await cli(args);
    assert.equal(result.code, 0, `timewarp-id ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const last = route => api.seen.filter(r => r.route === route).pop();

  before(async () => {
    api = standIn();
    await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
    home = tempDir('commands');
    const base = `http://127.0.0.1:${api.server.address().port}/agent-id`;
    env = cliEnv(base, { idHome: path.join(home, 'id'), codexHome: path.join(home, 'codex'), home }, { TIMEWARP_AGENT_KEY: 'twa_stand-in', TIMEWARP_OWNER_KEY: 'two_stand-in', TIMEWARP_ID_TOOL: 'claude-code' });
  });
  after(async () => {
    api.server.closeAllConnections?.();
    await new Promise(resolve => api.server.close(resolve));
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it('shows the wallet in USD with its stablecoins and network', async () => {
    const shown = await ok(['wallet', 'show']);
    assert.match(shown.stdout, /Balance: \$12\.34 USD · USDC\/USDT on Base/);
    assert.match(shown.stdout, /Assets: USDC \$10\.00 USD, USDT \$2\.34 USD/);
    assert.equal(balanceLine({ mode: 'test', network: 'test', balance: { amount: 500, currency: 'USD' } }), '$5.00 USD · test dollars');
    assert.equal(balanceLine({ mode: 'live', network: 'base-sepolia', balance: { amount: 5, currency: 'USD' } }), '$0.05 USD · USDC on Base Sepolia');
  });

  it('sends USDT when asked', async () => {
    const sent = await ok(['wallet', 'send', '0xdef', '5', '--asset', 'usdt', '--memo', 'api credits']);
    assert.match(sent.stdout, /Sent \$5\.00 USD to 0xdef\. Balance: \$7\.34 USD\./);
    assert.deepEqual(last('POST /v1/me/wallet/transfers').body, { to: '0xdef', value: '5.00', asset: 'usdt', memo: 'api credits' });
    const wrong = await cli(['wallet', 'send', '0xdef', '5', '--asset', 'btc']);
    assert.equal(wrong.code, 2);
  });

  it('applies for a card instead of giving one', async () => {
    assert.match((await ok(['card', 'application', '--agent', AGENT])).stdout, /No card application yet/);
    const applied = await ok(['card', 'apply', '--agent', AGENT, '--use-case', 'Cloud bills for the research agent', '--monthly', '200', '--country', 'se']);
    assert.deepEqual(last(`POST /v1/agents/${AGENT}/card-application`).body, { useCase: 'Cloud bills for the research agent', monthlySpend: 20000, country: 'SE' });
    assert.match(applied.stdout, /Card application: submitted/);
    assert.match(applied.stdout, /Monthly spend: \$200\.00 USD/);
    assert.match((await ok(['card', 'application', '--agent', AGENT])).stdout, /Country: SE/);
    const live = await cli(['give', 'card', '--live', '--agent', AGENT]);
    assert.equal(live.code, 2);
    assert.match(live.stderr, /card apply/);
    const incomplete = await cli(['card', 'apply', '--agent', AGENT, '--use-case', 'x']);
    assert.equal(incomplete.code, 2);
  });

  it('uploads attachments and sends them with the mail', async () => {
    fs.writeFileSync(path.join(home, 'my report.pdf'), Buffer.from('%PDF-1.7 fake'));
    fs.writeFileSync(path.join(home, 'notes.txt'), 'notes');
    const sent = await ok(['mail', 'send', '--to', 'ada@example.com', '--subject', 'Report', '--text', 'See attached.', '--attach', 'my report.pdf', '--attach', 'notes.txt']);
    assert.match(sent.stdout, /with 2 attachments/);
    const uploads = api.seen.filter(r => r.route === 'POST /v1/me/files');
    assert.equal(uploads.length, 2);
    assert.equal(uploads[0].headers['content-type'], 'application/pdf');
    assert.equal(uploads[0].headers['x-filename'], 'my%20report.pdf');
    assert.equal(uploads[0].raw.toString(), '%PDF-1.7 fake');
    assert.equal(uploads[1].headers['content-type'], 'text/plain');
    assert.deepEqual(last('POST /v1/me/mail').body, { to: ['ada@example.com'], subject: 'Report', text: 'See attached.', attachments: ['file_1', 'file_2'] });
    const missing = await cli(['mail', 'send', '--to', 'ada@example.com', '--subject', 'x', '--text', 'y', '--attach', 'nope.pdf']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Can't read nope\.pdf/);
  });

  it('reads attachments, and moves mail to the trash and back', async () => {
    assert.match((await ok(['mail', 'read', 'msg_1'])).stdout, /Attachments: report\.pdf \(2\.0 KB, file_9\)/);
    assert.match((await ok(['mail', 'trash', 'msg_1'])).stdout, /Moved to the trash/);
    assert.deepEqual(last('POST /v1/me/mail/msg_1/move').body, { folder: 'trash' });
    await ok(['mail', 'restore', 'msg_1']);
    assert.deepEqual(last('POST /v1/me/mail/msg_1/move').body, { folder: 'inbox' });
  });

  it('lists the machine\'s files', async () => {
    const listed = await ok(['vm', 'files', '/home/agent/work']);
    assert.equal(last('GET /v1/me/vm/files').query.path, '/home/agent/work');
    const lines = listed.stdout.trim().split('\n');
    assert.equal(lines[0], '/home/agent/work');
    assert.match(lines[2], /^src\//, 'folders first');
    assert.match(lines[3], /^notes\.txt\s+2\.0 KB/);
  });

  it('names the tool it runs in on every request', () => {
    assert.ok(api.seen.length > 10);
    for (const request of api.seen) assert.match(request.headers['user-agent'], /^timewarp-id\/\S+ \(claude-code\)$/, request.route);
  });
});
