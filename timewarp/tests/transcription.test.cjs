"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createBridge } = require('../desktop/bridge.cjs');
const { createModelPicker } = require('../desktop/model-picker.cjs');

async function bridge(t, cloud, services) {
  const server = createBridge({ authorize: async token => token === 'test-capability' }, cloud, 0, services);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const dictation = () => { const form = new FormData(); form.append('file', new Blob([Buffer.from('fake-opus-audio')], { type: 'audio/webm' }), 'dictation.webm'); return form; };

test('dictation audio is forwarded unchanged as multipart to the cloud', async t => {
  const calls = [];
  const url = await bridge(t, async (route, payload, method, type) => { calls.push({ route, payload, method, type }); return Response.json({ text: 'Hello there' }); });
  const reply = await fetch(url + '/v1/transcriptions', { method: 'POST', headers: { authorization: 'Bearer test-capability' }, body: dictation() });
  assert.equal(reply.status, 200); assert.deepEqual(await reply.json(), { text: 'Hello there' });
  assert.equal(calls.length, 1); assert.equal(calls[0].route, '/v1/transcriptions'); assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].type, /^multipart\/form-data; boundary=/);
  assert.ok(Buffer.isBuffer(calls[0].payload)); assert.match(calls[0].payload.toString('latin1'), /fake-opus-audio/);
});

test('a credit rejection keeps the provider error shape the dictation client reads', async t => {
  const url = await bridge(t, async () => Response.json({ error: { message: 'Voice input requires available credits.', type: 'usage_limit_reached' } }, { status: 402 }));
  const reply = await fetch(url + '/v1/transcriptions', { method: 'POST', headers: { authorization: 'Bearer test-capability' }, body: dictation() });
  assert.equal(reply.status, 402); assert.equal((await reply.json()).error.type, 'usage_limit_reached');
});

test('a connected Codex account still transcribes through Timewarp', async t => {
  let calls = 0;
  const chatgpt = { refresh: async () => {}, connection: () => ({ status: 'available' }), canUse: () => true };
  const aiFunding = { current: async () => ({ plan: 'free', subscriptionAllowed: true, source: 'chatgpt', canFundUsage: true, timewarpCredits: 0 }) };
  const url = await bridge(t, async () => { calls++; return Response.json({ text: 'ok' }); }, { chatgpt, aiFunding });
  assert.equal((await fetch(url + '/v1/transcriptions', { method: 'POST', headers: { authorization: 'Bearer test-capability' }, body: dictation() })).status, 200);
  assert.equal(calls, 1);
});

test('transcription requires sign-in, multipart audio and a bounded size', async t => {
  let calls = 0;
  const url = await bridge(t, async () => { calls++; return Response.json({ text: '' }); });
  assert.equal((await fetch(url + '/v1/transcriptions', { method: 'POST', body: dictation() })).status, 401);
  assert.equal((await fetch(url + '/v1/transcriptions', { method: 'POST', headers: { authorization: 'Bearer test-capability', 'content-type': 'application/json' }, body: '{}' })).status, 415);
  const huge = new FormData(); huge.append('file', new Blob([Buffer.alloc(9 * 1024 * 1024)], { type: 'audio/webm' }), 'dictation.webm');
  assert.equal((await fetch(url + '/v1/transcriptions', { method: 'POST', headers: { authorization: 'Bearer test-capability' }, body: huge })).status, 413);
  assert.equal(calls, 0);
});

test('the model picker shows the routed catalog model, never upstream modes', () => {
  const run = (models, name) => {
    const jsx={jsx:(type,props)=>({type,...props}),jsxs:(type,props)=>({type,...props})};
    const React={useState:value=>[value,()=>{}],useRef:()=>({current:[]}),useEffect:()=>{}};
    const Picker=createModelPicker({React,jsx,Popover:'popover',Trigger:'trigger',Content:'content',Button:'button',useModels:()=>({data:models})});
    const tree=Picker({settings:{name,reasoningEffort:'low'},onChange:()=>{}});
    return tree.children[0].render.children[0].children;
  };
  const timewarp = [{ id: 'openai/gpt-5.6-sol', displayName: 'Sol', featured: true }, { id: 'openai/gpt-5.6-luna', displayName: 'Luna', featured: true }];
  const codex = [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }, { id: 'gpt-5.5', displayName: 'GPT-5.5', featured: true }];
  assert.equal(run(timewarp, 'openai/gpt-5.6-luna'), 'Luna');
  // A chat saved on Codex shows Sol after upgrading, which is where it runs.
  assert.equal(run(timewarp, 'gpt-5.5'), 'Sol');
  assert.equal(run(timewarp, 'energy/auto'), 'Sol');
  assert.equal(run(codex, 'openai/gpt-5.4'), 'GPT-5.4');
  assert.equal(run(codex, 'openai/gpt-5.6-sol'), 'GPT-5.5');
  assert.equal(run([], 'openai/gpt-5.6-luna'), 'GPT-5.6 Luna');
});
