'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const workspace = '00000000-0000-4000-8000-000000000003';
const root = path.resolve(__dirname, '..');
const sourceOf = file => stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8'), { mode: 'strip' })
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '').replace(/export /g, '');
const requestFor = (user = owner, scope = null) => ({
  mode: 'subscription', customer: 'cus_fixture', client_reference_id: user,
  metadata: { supabase_user_id: user, workspace_id: scope || '', plan: 'pro' },
  line_items: [{ price: 'price_pro', quantity: 1 }],
});

test('durable subscription checkout and billing failure recovery', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.timewarp_workspaces (id uuid PRIMARY KEY);
    CREATE TABLE public.timewarp_workspace_members (user_id uuid,workspace_id uuid,role text);
    CREATE TABLE public.timewarp_subscriptions (
      id uuid DEFAULT gen_random_uuid(), workspace_id uuid, owner_user_id uuid,
      stripe_customer_id text, stripe_subscription_id text, plan text,
      subscription_status text, cancel_at_period_end boolean, current_period_end timestamptz,
      energy_monthly_extra_credits integer, energy_monthly_usd numeric
    );
    CREATE TABLE public.timewarp_billing_customers (user_id uuid PRIMARY KEY,stripe_customer_id text NOT NULL);
    CREATE FUNCTION public.timewarp_workspace_role_for(p_user_id uuid,p_workspace_id uuid)
      RETURNS text LANGUAGE sql AS 'SELECT role FROM public.timewarp_workspace_members WHERE user_id=p_user_id AND workspace_id=p_workspace_id';
    INSERT INTO auth.users VALUES ('${owner}'),('${other}');
    INSERT INTO public.timewarp_workspaces VALUES ('${workspace}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261005220000_subscription_checkout_guard.sql'), 'utf8'));
  t.beforeEach(async () => db.exec('DELETE FROM timewarp_subscription_checkouts; DELETE FROM timewarp_subscriptions; DELETE FROM timewarp_billing_customers; DELETE FROM timewarp_workspace_members;'));

  async function rpc(name, input) {
    try {
      const prepared = name === 'timewarp_prepare_subscription_checkout';
      const result = await db.query(`SELECT public.${name}($1::uuid,$2::uuid,$3::${prepared ? 'jsonb' : 'uuid'},$4::${prepared ? 'uuid' : 'text'}) AS data`, [
        input.p_user_id, input.p_workspace_id, prepared ? JSON.stringify(input.p_request) : input.p_attempt_id,
        prepared ? input.p_previous_attempt || null : input.p_session_id,
      ]);
      return { data: result.rows[0].data, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  }
  const prepare = async (user = owner, scope = null, previous = null) => {
    const result = await rpc('timewarp_prepare_subscription_checkout', { p_user_id: user, p_workspace_id: scope, p_request: requestFor(user, scope), p_previous_attempt: previous });
    assert.equal(result.error, null);
    return result.data;
  };

  function harness(options = {}) {
    const sessions = new Map(), keys = new Map(), customers = new Map(), subscriptions = new Map();
    const calls = { creates: 0, customerCreates: 0, lists: [], subscriptionLists: [], updates: 0 };
    let now = Date.now(), saveFailures = options.saveFailures || 0, lostResponses = options.lostResponses || 0;
    let handler;
    const admin = {
      from(table) {
        const where = new Map();
        const query = {
          select: () => query, eq: (key, value) => { where.set(key, value); return query; },
          is: (key, value) => { where.set(key, value); return query; },
          maybeSingle: async () => {
            if ((table === 'timewarp_subscriptions' && options.subscriptionReadError)
              || (table === 'timewarp_billing_customers' && options.customerReadError)) return { data: null, error: { message: 'Database outage' } };
            const rows = (await db.query(`SELECT * FROM public.${table}`)).rows;
            return { data: rows.find(row => [...where].every(([key, value]) => row[key] === value)) || null, error: null };
          },
          upsert: async value => {
            if (options.customerWriteError) return { error: { message: 'Database outage' } };
            await db.query('INSERT INTO timewarp_billing_customers VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id', [value.user_id, value.stripe_customer_id]);
            return { error: null };
          },
        };
        return query;
      },
      rpc: async (name, input) => {
        if (name === 'timewarp_workspace_role_for') {
          const result = await db.query('SELECT public.timewarp_workspace_role_for($1,$2) AS data', [input.p_user_id, input.p_workspace_id]);
          return { data: result.rows[0].data, error: null };
        }
        if (name === 'timewarp_save_subscription_checkout' && saveFailures > 0) {
          saveFailures--; return { data: null, error: { message: 'Database outage' } };
        }
        return rpc(name, input);
      },
    };
    const stripe = {
      customers: { create: async (params, config) => {
        assert.ok(config.idempotencyKey && !config.idempotencyKey.includes(owner));
        if (!customers.has(config.idempotencyKey)) { calls.customerCreates++; customers.set(config.idempotencyKey, { id: 'cus_fixture' }); }
        return customers.get(config.idempotencyKey);
      } },
      subscriptions: {
        retrieve: async id => { if (options.stripeReadError) throw Error('Stripe outage'); if (!subscriptions.has(id)) throw Error('Unknown subscription'); return subscriptions.get(id); },
        list: async input => {
          calls.subscriptionLists.push(input);
          if (options.subscriptionListError) throw Error('Stripe outage');
          const all = [...subscriptions.values()].filter(subscription => (!input.customer || subscription.customer === input.customer)
            && (input.status === 'all' || (input.status ? subscription.status === input.status : subscription.status !== 'canceled')));
          const start = input.starting_after ? all.findIndex(subscription => subscription.id === input.starting_after) + 1 : 0;
          return { data: all.slice(start, start + input.limit), has_more: start + input.limit < all.length };
        },
        update: async () => { calls.updates++; throw Error('Unexpected update'); },
      },
      checkout: { sessions: {
        create: async (params, config) => {
          assert.ok(config.idempotencyKey);
          const previous = keys.get(config.idempotencyKey);
          if (previous) { assert.deepEqual(params, previous.params); return previous.session; }
          calls.creates++;
          const session = { id: 'cs_fixture' + calls.creates, mode: params.mode, customer: params.customer,
            client_reference_id: params.client_reference_id, metadata: { ...params.metadata }, created: Math.floor(now / 1000),
            expires_at: params.expires_at, status: 'open', url: 'https://checkout.stripe.com/fixture/' + calls.creates };
          keys.set(config.idempotencyKey, { params, session }); sessions.set(session.id, session);
          if (lostResponses > 0) { lostResponses--; throw Error('Response lost after Stripe created the session'); }
          return session;
        },
        retrieve: async id => { if (options.sessionReadError) throw Error('Stripe outage'); if (!sessions.has(id)) throw Error('Unknown session'); return sessions.get(id); },
        expire: async id => {
          const session = sessions.get(id);
          if (!session || session.status !== 'open') throw Error('Checkout cannot be expired');
          session.status = 'expired'; return session;
        },
        list: async input => {
          calls.lists.push(input);
          if (options.sessionListError) throw Error('Stripe outage');
          const all = [...sessions.values()].filter(session => (!input.customer || session.customer === input.customer)
            && (!input.created || session.created >= input.created.gte) && (!input.status || session.status === input.status));
          const start = input.starting_after ? all.findIndex(session => session.id === input.starting_after) + 1 : 0;
          return { data: all.slice(start, start + input.limit), has_more: start + input.limit < all.length };
        },
      } },
    };
    class Clock extends Date { static now() { return now; } }
    const guard = vm.createContext({ Date: Clock, Error });
    vm.runInContext(sourceOf('supabase/functions/_shared/subscriptionCheckout.ts'), guard);
    const context = vm.createContext({
      Request, Response, Date, Error, TextEncoder, Uint8Array, crypto: webcrypto, console: { error() {} },
      Deno: { serve: fn => { handler = fn; }, env: { get: () => 'fixture' } }, createClient: () => admin,
      authenticateRequest: async () => ({ user: { id: options.user || owner, email: 'fixture@example.invalid' } }),
      isPlanId: plan => ['free', 'pro', 'max', 'ultra'].includes(plan), canManageBilling: () => true,
      getPlanPriceId: plan => 'price_' + plan, monthlyPlanPrice: async (_stripe, plan) => 'price_' + plan,
      monthlyExtraCredits: () => 0, planSubscriptionExtras: () => 0,
      getStripe: () => stripe, getSiteUrl: () => 'https://fixture.invalid', corsHeaders: {},
      jsonResponse: (data, status = 200) => Response.json(data, { status }), subscriptionCheckout: guard.subscriptionCheckout,
    });
    vm.runInContext(sourceOf('supabase/functions/stripe-billing/index.ts'), context);
    return { calls, sessions, subscriptions, keys, admin, stripe,
      advance: ms => { now += ms; },
      send: (plan = 'pro', fields = {}) => handler(new Request('https://fixture.invalid/billing', {
        method: 'POST', body: JSON.stringify({ action: 'checkout', surface: 'energy', plan, ...fields }),
      })),
    };
  }

  await t.test('database and Stripe lookup failures never start another subscription', async () => {
    const missing = harness({ subscriptionReadError: true });
    assert.equal((await missing.send()).status, 500); assert.equal(missing.calls.creates, 0); assert.equal(missing.calls.customerCreates, 0);
    await db.query("INSERT INTO timewarp_subscriptions (owner_user_id,stripe_subscription_id,plan,subscription_status) VALUES ($1,'sub_existing','pro','active')", [owner]);
    const existing = harness({ stripeReadError: true });
    assert.equal((await existing.send('max')).status, 500); assert.equal(existing.calls.creates, 0);
  });
  await t.test('customer read and save failures never open checkout', async () => {
    for (const options of [{ customerReadError: true }, { customerWriteError: true }]) {
      const h = harness(options); assert.equal((await h.send()).status, 500); assert.equal(h.calls.creates, 0);
    }
  });
  await t.test('concurrent requests share one customer, attempt and payable Stripe session', async () => {
    const h = harness();
    const responses = await Promise.all([h.send(), h.send(), h.send()]);
    assert.ok(responses.every(response => response.status === 200));
    const ids = await Promise.all(responses.map(async response => (await response.json()).sessionId));
    assert.equal(new Set(ids).size, 1); assert.equal(h.calls.creates, 1); assert.equal(h.calls.customerCreates, 1);
    assert.equal((await db.query('SELECT * FROM timewarp_subscription_checkouts')).rows.length, 1);
  });
  await t.test('repeated checkout reopens its session; a different plan waits for expiry', async () => {
    const h = harness(); assert.equal((await h.send()).status, 200);
    assert.equal((await h.send()).status, 200); assert.equal((await h.send('max')).status, 409); assert.equal(h.calls.creates, 1);
    h.sessions.get('cs_fixture1').status = 'expired';
    assert.equal((await h.send('max')).status, 200); assert.equal(h.calls.creates, 2); assert.equal(h.keys.size, 2);
  });
  await t.test('lost Stripe responses and failed saves recover the existing session', async () => {
    for (const options of [{ lostResponses: 1 }, { saveFailures: 1 }]) {
      await db.exec('DELETE FROM timewarp_subscription_checkouts;');
      const h = harness(options); assert.ok((await h.send()).status >= 500);
      assert.equal((await h.send()).status, 200); assert.equal(h.calls.creates, 1);
      assert.equal((await db.query('SELECT session_id FROM timewarp_subscription_checkouts')).rows[0].session_id, 'cs_fixture1');
    }
  });
  await t.test('lost session recovery follows pagination and survives Stripe key expiry', async () => {
    const h = harness({ lostResponses: 1 }); assert.equal((await h.send()).status, 500);
    const checkout = h.sessions.get('cs_fixture1'); h.sessions.clear();
    for (let index = 0; index < 101; index++) h.sessions.set('cs_noise_' + index, { ...checkout, id: 'cs_noise_' + index, metadata: {} });
    checkout.status = 'complete'; checkout.subscription = 'sub_completed'; h.sessions.set(checkout.id, checkout);
    h.subscriptions.set('sub_completed', { id: 'sub_completed', status: 'active' });
    h.keys.clear(); h.advance(48 * 60 * 60 * 1000);
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 1);
    assert.ok(h.calls.lists.some(input => input.starting_after));
  });
  await t.test('session lookup failures and unexpected session ownership fail closed', async () => {
    const lookup = harness({ sessionListError: true }); assert.equal((await lookup.send()).status, 500); assert.equal(lookup.calls.creates, 0);
    const h = harness(); assert.equal((await h.send()).status, 200);
    h.sessions.get('cs_fixture1').customer = 'cus_foreign';
    assert.equal((await h.send()).status, 503); assert.equal(h.calls.creates, 1);
  });
  await t.test('legacy pending and completed checkouts block a second payable subscription', async () => {
    const h = harness();
    const legacy = { id: 'cs_legacy', mode: 'subscription', customer: 'cus_fixture', created: Math.floor(Date.now() / 1000),
      client_reference_id: owner, metadata: { workspace_id: '', supabase_user_id: owner }, status: 'open' };
    h.sessions.set(legacy.id, legacy);
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 0);
    legacy.status = 'complete';
    h.subscriptions.set('sub_legacy', { id: 'sub_legacy', customer: 'cus_fixture', status: 'active', metadata: { workspace_id: '' } });
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 0);
  });
  await t.test('personal legacy billing on an orphaned customer is still detected by its owner', async () => {
    const h = harness();
    const legacy = { id: 'cs_orphan', mode: 'subscription', customer: 'cus_unsaved', created: Math.floor(Date.now() / 1000),
      client_reference_id: owner, metadata: { workspace_id: '', supabase_user_id: owner }, status: 'open' };
    h.sessions.set(legacy.id, legacy);
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 0);
    legacy.status = 'complete';
    h.subscriptions.set('sub_orphan', { id: 'sub_orphan', customer: 'cus_unsaved', status: 'active', metadata: { workspace_id: '', supabase_user_id: owner } });
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 0);
  });
  await t.test('other owners personal legacy billing does not block this users checkout', async () => {
    const h = harness();
    h.sessions.set('cs_other', { id: 'cs_other', mode: 'subscription', customer: 'cus_other', created: Math.floor(Date.now() / 1000),
      client_reference_id: other, metadata: { workspace_id: '', supabase_user_id: other }, status: 'open' });
    h.subscriptions.set('sub_other', { id: 'sub_other', customer: 'cus_other', status: 'active', metadata: { workspace_id: '', supabase_user_id: other } });
    assert.equal((await h.send()).status, 200); assert.equal(h.calls.creates, 1);
  });
  await t.test('large cancelled subscription history does not prevent new checkout', async () => {
    const h = harness();
    for (let index = 0; index < 10001; index++) h.subscriptions.set('sub_cancelled' + index, {
      id: 'sub_cancelled' + index, customer: 'cus_other', status: 'canceled', metadata: { supabase_user_id: other },
    });
    assert.equal((await h.send()).status, 200); assert.equal(h.calls.creates, 1);
    assert.equal(h.calls.subscriptionLists.length, 1); assert.equal(h.calls.subscriptionLists[0].status, undefined);
  });
  await t.test('live subscription pagination has no record ceiling and detects an owner on a later page', async () => {
    const h = harness();
    for (let index = 0; index < 10001; index++) h.subscriptions.set('sub_other' + index, {
      id: 'sub_other' + index, customer: 'cus_other', status: 'active', metadata: { supabase_user_id: other },
    });
    h.subscriptions.set('sub_orphan', { id: 'sub_orphan', customer: 'cus_unsaved', status: 'past_due', metadata: { supabase_user_id: owner } });
    assert.equal((await h.send()).status, 409); assert.equal(h.calls.creates, 0);
    assert.equal(h.calls.subscriptionLists.length, 101);
  });
  await t.test('failure to verify legacy subscription state never opens checkout', async () => {
    const h = harness({ subscriptionListError: true });
    assert.equal((await h.send()).status, 500); assert.equal(h.calls.creates, 0);
  });
  await t.test('cancelling a pending checkout allows a different plan without keeping the old link payable', async () => {
    const h = harness(); assert.equal((await h.send()).status, 200);
    assert.equal((await h.send('pro', { action: 'cancel-checkout', sessionId: 'cs_fixture1' })).status, 200);
    assert.equal(h.sessions.get('cs_fixture1').status, 'expired');
    assert.equal((await h.send('max')).status, 200); assert.equal(h.calls.creates, 2);
    assert.equal([...h.sessions.values()].filter(session => session.status === 'open').length, 1);
  });
  await t.test('completed cancelled subscriptions allow resubscription after billing state is synchronized', async () => {
    const h = harness(); assert.equal((await h.send()).status, 200);
    const checkout = h.sessions.get('cs_fixture1'); checkout.status = 'complete'; checkout.subscription = 'sub_old';
    h.subscriptions.set('sub_old', { id: 'sub_old', customer: 'cus_fixture', status: 'canceled', metadata: { workspace_id: '' } });
    await db.query("INSERT INTO timewarp_subscriptions (owner_user_id,stripe_subscription_id,plan,subscription_status) VALUES ($1,'sub_old','free','canceled')", [owner]);
    assert.equal((await h.send('max')).status, 200); assert.equal(h.calls.creates, 2);
  });
  await t.test('cancellation with a stale active database row waits for reconciliation instead of duplicating billing', async () => {
    const h = harness();
    h.subscriptions.set('sub_old', { id: 'sub_old', customer: 'cus_fixture', status: 'canceled', metadata: { workspace_id: '' } });
    await db.query("INSERT INTO timewarp_subscriptions (owner_user_id,stripe_subscription_id,plan,subscription_status) VALUES ($1,'sub_old','pro','active')", [owner]);
    assert.equal((await h.send('max')).status, 409); assert.equal(h.calls.creates, 0);
  });
  await t.test('workspace checkout catches a legacy pending session funded by another member', async () => {
    await db.query("INSERT INTO timewarp_workspace_members VALUES ($1,$2,'owner')", [owner, workspace]);
    const h = harness();
    h.sessions.set('cs_otherpayer', { id: 'cs_otherpayer', mode: 'subscription', customer: 'cus_other', status: 'open',
      created: Math.floor(Date.now() / 1000), metadata: { workspace_id: workspace, supabase_user_id: other } });
    assert.equal((await h.send('pro', { workspaceId: workspace })).status, 409); assert.equal(h.calls.creates, 0);
  });
  await t.test('expired retries cannot rotate twice or let old requests overwrite a new attempt', async () => {
    const initial = await prepare();
    const [first, second] = await Promise.all([prepare(owner, null, initial.attempt_id), prepare(owner, null, initial.attempt_id)]);
    assert.equal(first.attempt_id, second.attempt_id); assert.notEqual(first.attempt_id, initial.attempt_id);
    const stale = await rpc('timewarp_save_subscription_checkout', { p_user_id: owner, p_workspace_id: null, p_attempt_id: initial.attempt_id, p_session_id: 'cs_stale' });
    assert.equal(stale.data, false);
    const save = async id => rpc('timewarp_save_subscription_checkout', { p_user_id: owner, p_workspace_id: null, p_attempt_id: first.attempt_id, p_session_id: id });
    assert.equal((await save('cs_current')).data, true); assert.equal((await save('cs_other')).data, false);
  });
  await t.test('activation during checkout preparation blocks a new attempt', async () => {
    await db.query("INSERT INTO timewarp_subscriptions (owner_user_id,stripe_subscription_id,subscription_status) VALUES ($1,'sub_active','active')", [owner]);
    assert.equal((await prepare()).subscription_exists, true);
    assert.equal((await db.query('SELECT * FROM timewarp_subscription_checkouts')).rows.length, 0);
  });
  await t.test('scope isolation and workspace roles are enforced by the migration', async () => {
    assert.notEqual((await prepare()).attempt_id, (await prepare(other)).attempt_id);
    const denied = await rpc('timewarp_prepare_subscription_checkout', { p_user_id: owner, p_workspace_id: workspace, p_request: requestFor(owner, workspace) });
    assert.match(denied.error.message, /access denied/);
    await db.query("INSERT INTO timewarp_workspace_members VALUES ($1,$2,'owner'),($3,$2,'admin')", [owner, workspace, other]);
    const [first, second] = await Promise.all([prepare(owner, workspace), prepare(other, workspace)]);
    assert.equal(first.attempt_id, second.attempt_id);
  });
  await t.test('anonymous and authenticated callers cannot read or mutate pending payment records', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('SET ROLE ' + role);
      try {
        await assert.rejects(db.query('SELECT * FROM public.timewarp_subscription_checkouts'), /permission denied/);
        await assert.rejects(db.query('SELECT public.timewarp_prepare_subscription_checkout($1::uuid,NULL,$2::jsonb,NULL)', [owner, JSON.stringify(requestFor())]), /permission denied/);
      } finally { await db.exec('RESET ROLE'); }
    }
    await db.exec('SET ROLE service_role');
    try { assert.ok((await prepare()).attempt_id); } finally { await db.exec('RESET ROLE'); }
  });
});
