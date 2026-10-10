"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const { assertCloudSafe } = require('../shared/privacy.cjs');
const { sanitizeCard } = require('../shared/vault.cjs');
const { createBridge } = require('../desktop/bridge.cjs');
test('payment details are rejected before cloud transport, including tool result text', () => {
  for (const value of [{ prompt: 'my card is 4111 1111 1111 1111' }, { nested: { cvc: '123' } }, { input: [{ type: 'function_call_output', output: 'CVV: 123' }] }, { password: 'private' }]) assert.throws(() => assertCloudSafe(value), /device/);
  assert.doesNotThrow(() => assertCloudSafe({ prompt: 'Create a weekly plan', requestId: '71119008-0000-4000-8000-111110011101' }));
});
test('dates, timestamps and tool parameter names are not taken for payment details', () => {
  for (const value of ['4111-1111-1111-1111', '4111111111111111', '3782 822463 10005', '5555 5555 5555 4444']) assert.throws(() => assertCloudSafe({ input: value }), /device/, value);
  // About one pair of dates in ten passes the card checksum; a chat holding
  // one was refused on every later turn.
  let pairs = 0;
  for (let month = 1; month <= 12; month++) for (let day = 1; day <= 28; day++) {
    const dates = `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 2024-02-20`;
    assert.doesNotThrow(() => assertCloudSafe({ input: dates }), dates);
    pairs++;
  }
  assert.equal(pairs, 336);
  assert.doesNotThrow(() => assertCloudSafe({ input: 'Order 1791464160360 shipped; call +46 70 123 45 67' }));
  // A tool's "password" parameter is a name in its schema, not a password.
  const tools = [{ type: 'function', name: 'save_sign_in', parameters: { type: 'object', properties: { site: { type: 'string' }, password: { type: 'string' } }, required: ['site', 'password'] } }];
  assert.doesNotThrow(() => assertCloudSafe({ tools, input: 'Save the sign-in' }));
  assert.throws(() => assertCloudSafe({ tools, input: [{ password: 'hunter2' }] }), /device/);
  assert.throws(() => assertCloudSafe({ type: 'object', properties: { note: '4111 1111 1111 1111' } }), /device/);
});
test('the cloud copy of the payment check matches the device copy', () => {
  const read = file => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
  const body = text => text.slice(text.indexOf('const secretKeys'), text.indexOf('module.exports') >= 0 ? text.indexOf('module.exports') : text.indexOf('export {'));
  assert.equal(body(read('cloud/privacy.ts')), body(read('shared/privacy.cjs')));
});
test('local card storage removes verification codes without changing non-card credentials', () => {
  const secret = JSON.stringify({ number: '4111111111111111', cardholder: 'Test', cvc: '123', expiryYear: '2030' });
  const stored = JSON.parse(sanitizeCard({ kind: 'credit-card' }, secret));
  assert.equal(stored.number, '4111111111111111'); assert.equal(stored.cvc, undefined);
  assert.equal(sanitizeCard({ kind: 'password' }, 'pass'), 'pass');
});

test('response telemetry is discarded before cloud transport without exempting sensitive model input', async t => {
  let forwarded;
  const server=createBridge({authorize:async()=>true},async(_route,input)=>{forwarded=input;return Response.json({});},0);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  // This real-shaped timestamp passes Luhn and used to block guardian reviews;
  // no card number starts like a timestamp, so it's no longer flagged.
  let stamp=1791463223381;while(!require('../shared/privacy.cjs').luhn(String(stamp)))stamp++;
  assert.doesNotThrow(()=>assertCloudSafe({client_metadata:{'x-codex-turn-metadata':JSON.stringify({turn_started_at_unix_ms:stamp})}}));
  // Telemetry is dropped before the check even when it looks like a card.
  const telemetry={'x-codex-turn-metadata':JSON.stringify({trace:'4111111111111111'})};
  assert.throws(()=>assertCloudSafe({client_metadata:telemetry}),/device/);
  const send=input=>fetch(`http://127.0.0.1:${server.address().port}/v1/responses`,{method:'POST',body:JSON.stringify(input)});
  assert.equal((await send({input:'Read the visible page',client_metadata:telemetry,prompt_cache_key:'stable'})).status,200);
  assert.deepEqual(forwarded,{input:'Read the visible page',prompt_cache_key:'stable'});
  forwarded=null;
  assert.equal((await send({input:'4111 1111 1111 1111',client_metadata:telemetry})).status,400);
  assert.equal(forwarded,null);
});
test('loopback bridge blocks unauthenticated requests, hostile origins, rebinding, and card exfiltration', async t => {
  let cloudCalls = 0;
  const auth = { authorize: async token => token === 'test-capability', accountSession: async () => ({ user: { id: 'test' } }) };
  const server = createBridge(auth, async () => { cloudCalls++; return new Response('{}'); }, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/v1/responses', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(url+'/v1/responses', { method: 'POST', headers: { authorization: 'Bearer test-capability', origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const req = require('node:http').get(url+'/healthz', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(url+'/v1/responses', { method: 'POST', headers: { authorization: 'Bearer test-capability' }, body: JSON.stringify({ input: '4111111111111111' }) })).status, 400);
  assert.equal(cloudCalls, 0);
  assert.equal((await fetch(url+'/v1/responses', { method: 'POST', headers: { authorization: 'Bearer test-capability', origin: 'http://127.0.0.1:7788' }, body: JSON.stringify({ input: 'Hello' }) })).status, 200);
  assert.equal(cloudCalls, 1);
});
test('the device vault flag is answered locally while vault calls never reach the cloud', async t => {
  let cloudCalls = 0;
  const server = createBridge({ authorize: async token => token === 'test-capability' }, async () => { cloudCalls++; return new Response('{}'); }, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`, headers = { authorization: 'Bearer test-capability' };
  const flags = await (await fetch(url+'/flags/?v=2', { method: 'POST', body: JSON.stringify({ distinct_id: 'test' }) })).json();
  assert.deepEqual(flags.featureFlags, { passwords: true });
  for (const rpc of ['product.vault.list', 'product.vault.create', 'product.secretInputs.read']) assert.equal((await fetch(url+'/api/product/trpc/'+rpc, { method: 'POST', headers, body: '{}' })).status, 403, rpc);
  assert.equal(cloudCalls, 0);
});

test('native account funding uses live Timewarp credits and fails closed on backend failure', async t => {
  let balance = { included: 2, purchased: 1.5, plan: 'free' }, status = 200;
  const auth = { authorize: async token => token === 'test-capability' };
  const server = createBridge(auth, async (route, payload) => {
    assert.equal(route, '/billing'); assert.deepEqual(payload, {});
    return new Response(JSON.stringify(balance), { status });
  }, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`, headers = { authorization: 'Bearer test-capability' };
  assert.equal((await fetch(url+'/api/funding/current')).status, 401);
  assert.deepEqual(await (await fetch(url+'/api/funding/current', { headers })).json(), { canFundUsage: true, timewarpCredits: 3.5 });
  const used = await (await fetch(url+'/api/product/trpc/product.usage.energy', { headers })).json();
  assert.equal(used.result.data.json.credits.availableMicroUsd, 437500);
  balance = { included: 0, purchased: 0 };
  assert.equal((await (await fetch(url+'/api/funding/current', { headers })).json()).canFundUsage, false);
  balance = { error: 'Credit service unavailable.' }; status = 503;
  assert.equal((await fetch(url+'/api/funding/current', { headers })).status, 503);
  balance = { included: 'unlimited', purchased: 0 }; status = 200;
  assert.equal((await fetch(url+'/api/funding/current', { headers })).status, 502);
  assert.equal((await fetch(url+'/connect/accounts', { method: 'POST', body: '{}' })).status, 401);
  assert.deepEqual(await (await fetch(url+'/connect/accounts', { method: 'POST', headers, body: '{}' })).json(), { connections: [] });
  assert.deepEqual(await (await fetch(url+'/api/execution/agents/test/connector-access', { headers })).json(), { items: [], allConnectedApps: false });
});
test('paid plans meter monthly included credits from the billing service status', async t => {
  const routes = [];
  const replies = {
    '/billing': { included: 75, purchased: 0, plan: 'pro' },
    '/billing/service': { plan: 'pro', includedCredits: { allowance: 100, balance: 75 }, currentPeriodEnd: '2026-11-01T00:00:00Z' },
  };
  const server = createBridge({ authorize: async token => token === 'test-capability' }, async (route, payload) => {
    routes.push(route); if (route === '/billing/service') assert.deepEqual(payload, { action: 'status' });
    return new Response(JSON.stringify(replies[route]), { status: 200 });
  }, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const used = await (await fetch(`http://127.0.0.1:${server.address().port}/api/product/trpc/product.usage.energy`, { headers: { authorization: 'Bearer test-capability' } })).json();
  assert.deepEqual(routes, ['/billing', '/billing/service']);
  assert.deepEqual(used.result.data.json.plans, [{ id: 'timewarp-pro', type: 'energy', name: 'Pro', status: 'available', limits: [{ id: 'monthly', label: 'Monthly credits', remainingPercent: 75, resetsAt: '2026-11-01T00:00:00Z' }] }]);
});
