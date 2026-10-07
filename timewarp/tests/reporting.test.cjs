"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { createReporting } = require('../desktop/reporting.cjs');
const { createBridge } = require('../desktop/bridge.cjs');
const config = { supabaseUrl: 'https://reporting.example.invalid', publishableKey: 'public-key' };
const ticketId = 'bc6e1593-754d-4bd5-a88a-06ace373d9c6';
const user = { id: 'fixture-user', email: 'reporter@example.invalid', user_metadata: { full_name: 'Report tester' } };

function contact({ invalidSession = false, storageFails = false } = {}) {
  const inserts = [], tokens = [];
  let handler;
  const admin = {
    auth: { getUser: async token => { tokens.push(token); return { data: { user: invalidSession ? null : user }, error: invalidSession ? Error('Expired') : null }; } },
    from: table => ({ insert: row => {
      assert.equal(table, 'support_tickets'); inserts.push(row);
      return { select: () => ({ single: async () => ({ data: storageFails ? null : { id: ticketId, ticket_number: 123 }, error: storageFails ? Error('Unavailable') : null }) }) };
    } }),
  };
  const filename = process.env.TIMEWARP_CONTACT_TEST_SOURCE || path.join(__dirname, '../supabase/functions/contact/index.ts');
  const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, ''), { mode: 'strip' });
  const context = vm.createContext({
    Request, Response, Uint8Array, atob, crypto: require('node:crypto').webcrypto,
    console: { error() {} }, createClient: () => admin,
    Deno: { env: { get: name => ({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'server-key' })[name] }, serve: fn => { handler = fn; } },
    enqueueEmail: () => { throw Error('Feedback verification must not send email.'); },
  });
  vm.runInContext(source, context);
  return { inserts, tokens, request: (body, token = 'user-jwt') => handler(new Request(config.supabaseUrl + '/functions/v1/contact', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body),
  })) };
}

test('native feedback is authenticated and saved to Supabase before reporting success', async () => {
  const service = contact();
  const submit = createReporting({ config, auth: { accessToken: async () => 'user-jwt' }, fetcher: async (url, options) => {
    assert.equal(url, config.supabaseUrl + '/functions/v1/contact');
    assert.equal(options.headers.apikey, config.publishableKey);
    assert.equal(options.headers.Authorization, 'Bearer user-jwt');
    assert.equal(options.redirect, 'error');
    return service.request(JSON.parse(options.body), 'user-jwt');
  } });
  const input = { description: 'The sidebar disappears after reopening a chat.', route: '/chat/fixture', conversationId: 'fixture-chat', environment: { app: 'desktop', appVersion: '1.1.23', releaseChannel: 'stable', platform: 'win32' }, browserCookies: 'local-only', threadContents: 'local-only' };
  const result = await submit(input);
  assert.match(result.traceId, /^\d{8}_[a-f0-9]{16}$/);
  assert.deepEqual(Object.keys(result), ['traceId']);
  assert.deepEqual(service.tokens, ['user-jwt']);
  assert.equal(service.inserts.length, 1);
  const row = service.inserts[0], diagnostics = JSON.parse(row.diagnostics);
  assert.equal(row.user_id, user.id);
  assert.equal(row.reporter_email, user.email);
  assert.equal(row.reporter_name, 'Report tester');
  assert.equal(row.description, input.description);
  assert.equal(row.app_version, '1.1.23');
  assert.equal(row.source, 'timewarp_desktop');
  assert.equal(row.platform, 'win32');
  assert.equal(diagnostics.traceId, result.traceId);
  assert.equal(diagnostics.conversationId, 'fixture-chat');
  assert.equal(diagnostics.route, '/chat/fixture');
  assert.equal(diagnostics.releaseChannel, 'stable');
  assert.ok(!JSON.stringify(row).includes('local-only'));
});

test('feedback requires a live session and ignores supplied reporter identity', async () => {
  for (const options of [{}, { invalidSession: true }]) {
    const service = contact(options);
    const response = await service.request({ kind: 'feedback', description: 'Sidebar issue' }, options.invalidSession ? 'expired' : '');
    assert.equal(response.status, 401); assert.equal(service.inserts.length, 0);
  }
  const service = contact();
  assert.equal((await service.request({ kind: 'feedback', description: 'Sidebar issue', email: 'spoof@example.invalid', name: 'Spoof', user_id: 'spoof' })).status, 200);
  assert.equal(service.inserts[0].reporter_email, user.email);
  assert.equal(service.inserts[0].user_id, user.id);
});

test('short native reports need no screenshots and invalid descriptions never create tickets', async () => {
  assert.equal((await contact().request({ kind: 'feedback', description: 'Bug' })).status, 200);
  for (const description of ['', '  ', 'x'.repeat(5001), 123]) {
    const service = contact();
    assert.equal((await service.request({ kind: 'feedback', description })).status, 400);
    assert.equal(service.inserts.length, 0);
  }
  assert.equal((await contact().request({ kind: 'issue', name: 'Tester', email: user.email, title: 'Bug', message: 'Website issue with screenshot missing' })).status, 400);
});

test('database failures and unconfirmed responses remain errors in the feedback form', async () => {
  const service = contact({ storageFails: true });
  const submit = createReporting({ config, auth: { accessToken: async () => 'user-jwt' }, fetcher: (_, options) => service.request(JSON.parse(options.body)) });
  await assert.rejects(submit({ description: 'Report storage error' }), error => error.status === 502 && /could not be saved/.test(error.message));
  for (const value of [{ ok: true }, { ok: true, traceId: '20261007_0123456789abcdef' }, null]) {
    const unconfirmed = createReporting({ config, auth: { accessToken: async () => 'user-jwt' }, fetcher: async () => Response.json(value) });
    await assert.rejects(unconfirmed({ description: 'Check confirmation' }), /could not be confirmed/);
  }
});

test('empty, oversized, or sensitive reports are rejected before transport', async () => {
  let calls = 0;
  const submit = createReporting({ config, auth: { accessToken: async () => 'user-jwt' }, fetcher: async () => { calls++; throw Error('Unexpected transport'); } });
  for (const description of ['', ' ', 'x'.repeat(5001), 'My card number is 4111 1111 1111 1111']) await assert.rejects(submit({ description }));
  assert.equal(calls, 0);
});

test('the desktop feedback RPC routes authenticated submissions to the ticket service and preserves errors', async t => {
  const service = contact(), transport = createReporting({ config, auth: { accessToken: async () => 'user-jwt' }, fetcher: (_, options) => service.request(JSON.parse(options.body)) });
  const server = createBridge({ authorize: async token => token === 'device-capability' }, async () => { throw Error('Feedback must use the ticket service.'); }, 0, { submitFeedback: transport });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/product/trpc/product.feedback.submit`;
  const headers = { authorization: 'Bearer device-capability', 'content-type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(url, { headers })).status, 405);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body: '{}' })).status, 403);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ json: { description: 'Native feedback route verification', environment: { app: 'desktop', platform: 'win32' } } }) });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.match(value.result.data.json.traceId, /^\d{8}_[a-f0-9]{16}$/);
  assert.equal(service.inserts.length, 1);
  assert.equal(service.inserts[0].description, 'Native feedback route verification');
  const failed = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ json: { description: ' ' } }) });
  assert.equal(failed.status, 400);
  assert.equal((await failed.json()).error.json.data.code, 'BAD_REQUEST');
});
