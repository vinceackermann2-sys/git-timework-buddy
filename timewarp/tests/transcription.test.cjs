"use strict";
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createBridge } = require('../desktop/bridge.cjs');
const { patchModelPicker } = require('../scripts/model-picker.cjs');

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
  const picker = 'const s=le.product.models.list.useQuery(),i=s.data??[],a=s.isPending,o=!s.data,l=i.find(T=>T.id===r.name),c=1,d=m$.find(T=>T.id===r.name),f=!d,_=d?.label??ucn(l?.displayName??r.name,c);x({children:g?h.jsx(acn,{catalogLoading:a,modelId:r.name,models:i}):0});y(h.jsx("div",{className:"-mx-1 my-1 h-px bg-border"}),h.jsx(BCe,{checked:!0,disabled:n,onCheckedChange:i}))';
  const run = (models, name) => {
    let label, listed = null, upstreamMode = false;
    const source = patchModelPicker(picker).replace('const s=le.product.models.list.useQuery()', 'const s={data:models}');
    new Function('models', 'r', 'ucn', 'm$', 'x', 'y', 'h', 'acn', 'BCe', 'n', 'g', source + ';return _')
      (models, { name }, (model) => (label = model), [{ id: 'energy/auto', label: 'Auto' }], () => {}, () => {}, { jsx: (_, props) => { if (props?.modelId) listed = props.modelId; } }, null, () => { upstreamMode = true; }, false, false);
    return { label, listed, upstreamMode };
  };
  const timewarp = [{ id: 'openai/gpt-5.6-sol', displayName: 'Sol', featured: true }, { id: 'openai/gpt-5.6-luna', displayName: 'Luna', featured: true }];
  const codex = [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }, { id: 'gpt-5.5', displayName: 'GPT-5.5', featured: true }];
  assert.deepEqual(run(timewarp, 'openai/gpt-5.6-luna'), { label: 'Luna', listed: 'openai/gpt-5.6-luna', upstreamMode: false });
  // A chat saved on Codex shows Sol after upgrading, which is where it runs.
  assert.equal(run(timewarp, 'gpt-5.5').label, 'Sol');
  assert.equal(run(timewarp, 'energy/auto').label, 'Sol');
  assert.equal(run(codex, 'openai/gpt-5.4').label, 'GPT-5.4');
  assert.equal(run(codex, 'openai/gpt-5.6-sol').label, 'GPT-5.5');
  assert.equal(run([], 'openai/gpt-5.6-luna').label, 'Luna');
});
