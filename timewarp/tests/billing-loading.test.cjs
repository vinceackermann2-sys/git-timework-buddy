"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
const status = (plan = 'free') => ({
  plan, plans: [{ id: 'free', name: 'Free', monthlyUsd: 0, monthlyCredits: 0 }, { id: 'pro', name: 'Pro', monthlyUsd: 20, monthlyCredits: 100 }],
  includedCredits: { allowance: plan === 'free' ? 0 : 100, balance: 50 }, purchasedCredits: { balance: 25 }, credits: { packs: [] },
});

function renderer(t, override = () => {}) {
  const dom = new JSDOM('<main id="host"></main>', { url: 'https://fixture.invalid', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls = [], window = dom.window;
  window.timewarp = { request: async (action, input = {}) => {
    calls.push({ action, input });
    const result = override(action, input);
    if (result !== undefined) return result;
    if (action === 'state') return { user: { id: 'owner' } };
    if (action === 'chatgptDetails') return { funding: { subscriptionAllowed: true }, status: 'disconnected' };
    if (input.route === '/billing/history') return { events: [] };
    if (input.data?.action === 'status') return status();
    return {};
  } };
  window.eval(fs.readFileSync(path.join(root, 'desktop/native-billing.js'), 'utf8'));
  return { window, calls, mount: () => window.timewarpMountBilling(window.document.getElementById('host')) };
}

test('billing starts the status request while local account state is still loading', async t => {
  const state = deferred(), ui = renderer(t, action => action === 'state' ? state.promise : undefined);
  ui.mount();
  await flush();
  assert.ok(ui.calls.some(call => call.input.data?.action === 'status'));
  state.resolve({ user: { id: 'owner' } });
  await flush();
  assert.equal(ui.window.document.querySelectorAll('.tw-plan-card').length, 2);
});

test('a slow checkout sync does not block billing and completion reloads the verified plan', async t => {
  const sync = deferred(); let paid = false;
  const ui = renderer(t, (_action, input) => {
    if (input.data?.action === 'sync-checkout') return sync.promise;
    if (input.data?.action === 'status') return status(paid ? 'pro' : 'free');
  });
  ui.window.localStorage.setItem('timewarp-checkout:owner', JSON.stringify({ id: 'cs_fixture', createdAt: Date.now() }));
  ui.mount();
  await flush();
  assert.equal(ui.window.document.querySelector('.tw-plan-current')?.dataset.plan, 'free');
  assert.equal(ui.window.document.querySelector('.tw-billing-content').getAttribute('aria-busy'), 'false');
  assert.ok(ui.calls.some(call => call.input.data?.action === 'sync-checkout'));
  paid = true; sync.resolve({ pending: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  await flush();
  assert.equal(ui.window.document.querySelector('.tw-plan-current')?.dataset.plan, 'pro');
  assert.equal(ui.window.localStorage.getItem('timewarp-checkout:owner'), null);
});

test('checkout sync failure preserves loaded balances and the pending payment for retry', async t => {
  const ui = renderer(t, (_action, input) => input.data?.action === 'sync-checkout' ? Promise.reject(Error('Sync unavailable')) : undefined);
  ui.window.localStorage.setItem('timewarp-checkout:owner', JSON.stringify({ id: 'cs_fixture', createdAt: Date.now() }));
  ui.mount(); await flush();
  assert.equal(ui.window.document.querySelectorAll('.tw-plan-card').length, 2);
  assert.match(ui.window.document.querySelector('.tw-notice').textContent, /Sync unavailable/);
  assert.ok(ui.window.localStorage.getItem('timewarp-checkout:owner'));
});

test('repeated refreshes share checkout synchronization and cannot erase a newer checkout', async t => {
  const sync = deferred();
  const ui = renderer(t, (_action, input) => input.data?.action === 'sync-checkout' ? sync.promise : undefined);
  ui.window.localStorage.setItem('timewarp-checkout:owner', JSON.stringify({ id: 'cs_first', createdAt: Date.now() }));
  ui.mount(); await flush();
  for (let i = 0; i < 2; i++) {
    [...ui.window.document.querySelectorAll('button')].find(button => button.textContent === 'Refresh').click(); await flush();
  }
  assert.equal(ui.calls.filter(call => call.input.data?.action === 'sync-checkout').length, 1);
  const next = JSON.stringify({ id: 'cs_next', createdAt: Date.now() });
  ui.window.localStorage.setItem('timewarp-checkout:owner', next);
  ui.window.document.getElementById('host').remove();
  sync.resolve({ pending: false }); await flush();
  assert.equal(ui.window.localStorage.getItem('timewarp-checkout:owner'), next);
});

test('credit history loads once when Recent activity is first opened', async t => {
  const ui = renderer(t); ui.mount(); await flush();
  const historyCalls = () => ui.calls.filter(call => call.input.route === '/billing/history').length;
  assert.equal(historyCalls(), 0);
  const activity = ui.window.document.querySelector('.tw-activity');
  activity.open = true; activity.dispatchEvent(new ui.window.Event('toggle')); await flush();
  assert.equal(historyCalls(), 1);
  assert.match(activity.textContent, /No credit activity yet/);
  activity.open = false; activity.dispatchEvent(new ui.window.Event('toggle'));
  activity.open = true; activity.dispatchEvent(new ui.window.Event('toggle')); await flush();
  assert.equal(historyCalls(), 1);
});

test('expired or malformed checkout state is cleared before the payment notice renders', async t => {
  for (const pending of ['{broken', JSON.stringify({ id: 'cs_expired', createdAt: Date.now() - 25 * 60 * 60 * 1000 })]) {
    const ui = renderer(t);
    ui.window.localStorage.setItem('timewarp-checkout:owner', pending);
    ui.mount(); await flush();
    assert.equal(ui.window.localStorage.getItem('timewarp-checkout:owner'), null);
    assert.equal(ui.window.document.querySelector('.tw-pending'), null);
    assert.ok(!ui.calls.some(call => call.input.data?.action === 'sync-checkout'));
  }
});

test('a plan change renders before a slow AI funding refresh completes', async t => {
  const funding = deferred(); let paid = false;
  const ui = renderer(t, (action, input) => {
    if (action === 'refreshAiFunding') return funding.promise;
    if (input.data?.action === 'status') return status(paid ? 'pro' : 'free');
  });
  ui.mount(); await flush(); paid = true;
  [...ui.window.document.querySelectorAll('button')].find(button => button.textContent === 'Refresh').click();
  await flush();
  assert.equal(ui.window.document.querySelector('.tw-plan-current')?.dataset.plan, 'pro');
  assert.equal(ui.window.document.querySelector('.tw-billing-content').getAttribute('aria-busy'), 'false');
  funding.resolve({});
});

function service(override = {}) {
  const calls = []; let handler;
  const admin = {
    from(table) {
      const scope = {}, query = { select: () => query, eq: (key, value) => { scope[key] = value; return query; }, is: (key, value) => { scope[key] = value; return query; },
        maybeSingle: async () => { calls.push({ table, scope }); return override.read?.(table) || { data: table === 'timewarp_subscriptions' ? { plan: 'pro' } : { stripe_customer_id: 'cus_fixture' }, error: null }; } };
      return query;
    },
    rpc: async (name, input) => {
      calls.push({ name, input });
      return override.rpc?.(name, input) || { data: name === 'timewarp_ai_usage' ? { period_start: '2026-10-01T00:00:00Z', included_allowance_credits: 100, included_balance_credits: 60, purchased_balance_credits: 25 } : {}, error: null };
    },
  };
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/stripe-billing/index.ts'), 'utf8'), { mode: 'strip' }).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '');
  const budget = { monthlyCredits: 100 };
  vm.runInNewContext(source, { Request, Response, Date, console: { error() {} }, Deno: { serve: callback => { handler = callback; }, env: { get: () => 'fixture' } },
    createClient: () => admin, authenticateRequest: async () => ({ user: { id: 'owner' } }), isPlanId: value => ['free', 'pro', 'max', 'ultra'].includes(value),
    canManageBilling: role => role === 'owner', getPlanBudget: () => budget, PLAN_BUDGETS: { pro: budget }, MONTHLY_CREDIT_ADDONS: [], CREDIT_PACKS: [], USD_PER_CREDIT: .125, AI_COST_MARKUP: 2.5,
    jsonResponse: (body, status = 200) => Response.json(body, { status }),
  });
  return { calls, send: (workspaceId = null) => handler(new Request('https://fixture.invalid/billing', { method: 'POST', body: JSON.stringify({ action: 'status', surface: 'energy', workspaceId }) })) };
}

test('status loads independent usage and customer queries together after the usage period is known', async () => {
  const cloud = deferred();
  const billing = service({ rpc: name => name === 'timewarp_cloud_credit_usage' ? cloud.promise : undefined });
  const response = billing.send(); await flush();
  try {
    assert.ok(billing.calls.some(call => call.name === 'timewarp_credit_usage_summary'), 'purchased usage must not wait for cloud usage');
    assert.ok(billing.calls.some(call => call.table === 'timewarp_billing_customers'), 'billing customer must not wait for usage summaries');
  } finally { cloud.resolve({ data: { cloud_balance_credits: 10 }, error: null }); }
  const result = await response, data = await result.json();
  assert.equal(result.status, 200); assert.equal(data.plan, 'pro'); assert.equal(data.canOpenPortal, true);
  assert.equal(data.includedCredits.balance, 60); assert.equal(data.purchasedCredits.balance, 25); assert.equal(data.cloudCredits.balance, 10);
  const summary = billing.calls.find(call => call.name === 'timewarp_credit_usage_summary');
  assert.equal(summary.input.p_period_start, '2026-10-01T00:00:00Z');
  assert.ok(billing.calls.filter(call => call.name).every(call => call.input.p_user_id === 'owner' && call.input.p_workspace_id === null));
});

test('status fails closed on query errors and verifies membership before reading billing', async () => {
  for (const name of ['timewarp_ai_usage', 'timewarp_cloud_credit_usage', 'timewarp_credit_usage_summary']) {
    const billing = service({ rpc: rpc => rpc === name ? { data: null, error: { message: 'Database unavailable' } } : undefined });
    assert.equal((await billing.send()).status, 500, name);
  }
  const customerFailure = service({ read: table => table === 'timewarp_billing_customers' ? { data: null, error: { message: 'Database unavailable' } } : undefined });
  assert.equal((await customerFailure.send()).status, 500);
  const billing = service({ rpc: name => name === 'timewarp_workspace_role_for' ? { data: null, error: null } : undefined });
  assert.equal((await billing.send('foreign-workspace')).status, 403);
  assert.equal(billing.calls.length, 1);
});
