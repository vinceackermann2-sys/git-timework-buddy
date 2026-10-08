// Billing control plane. Authenticated with the user's Supabase JWT; every
// action is scoped to the caller and to one workspace.
//
//   scopes   -> the workspaces this user could activate a plan in (+ their plans)
//   status   -> one scope's plan, budgets, and pooled usage
//   checkout -> Stripe Checkout URL for a first paid subscription on a scope
//   portal   -> Stripe billing portal URL (change card, cancel, invoices)
//
// A plan belongs to a workspace and its allowance is pooled across the members.
// "Personal" is a workspace too — solo, and the default — carried as
// workspaceId === null.
//
// Entitlement comes from Stripe through the webhook or the verified checkout
// return. A pending checkout attempt never grants a subscription or credits.
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { authenticateRequest, type AdminSupabaseClient } from '../_shared/auth.ts';
import {
  canManageBilling,
  getPlanBudget,
  getPlanPriceId,
  isEntitledStatus,
  isPlanId,
  PLAN_BUDGETS,
  type PlanId,
} from '../_shared/plans.ts';
import { AI_COST_MARKUP, CREDIT_PACKS, getCreditPack, USD_PER_CREDIT } from '../_shared/credits.ts';
import { monthlyPlanPrice, creditPackPrice, monthlyExtraCredits, MONTHLY_CREDIT_ADDONS, planSubscriptionExtras, syncMonthlyPlanCredits } from '../_shared/timewarpPricing.ts';
import { corsHeaders, getSiteUrl, getStripe, jsonResponse, type Stripe } from '../_shared/stripe.ts';
import { subscriptionCheckout } from '../_shared/subscriptionCheckout.ts';

interface SubscriptionRow {
  id: string;
  workspace_id: string | null;
  owner_user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  energy_monthly_extra_credits: number;
  energy_monthly_usd: number | null;
}

// Stripe moved current_period_start/end onto the subscription item in the
// 2025-03-31 API version. Read the item first and fall back to the legacy
// top-level field so this works either side of that change.
const periodEndSeconds = (subscription: Stripe.Subscription): number | null => {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return item?.current_period_end ?? legacy ?? null;
};

const periodStartSeconds = (subscription: Stripe.Subscription): number | null => {
  const item = subscription.items?.data?.[0] as { current_period_start?: number } | undefined;
  const legacy = (subscription as unknown as { current_period_start?: number }).current_period_start;
  return item?.current_period_start ?? legacy ?? null;
};

const toIso = (seconds: number | null): string | null =>
  seconds == null ? null : new Date(seconds * 1000).toISOString();

const usagePayload = (plan: PlanId, usage: Record<string, unknown> | null) => {
  const budget = getPlanBudget(plan);
  const reportedAllowance = Number(usage?.included_allowance_credits);
  const allowance = Math.max(
    0,
    Number.isFinite(reportedAllowance) ? reportedAllowance : budget.monthlyCredits,
  );
  const balance = Math.max(0, Math.min(allowance, Number(usage?.included_balance_credits) || 0));
  const used = Math.max(0, allowance - balance);
  const window = (label: string, usedCredits: number, limitCredits: number) => ({
    label,
    usedCredits,
    limitCredits,
    remainingCredits: Math.max(0, limitCredits - usedCredits),
    percentUsed: limitCredits > 0 ? Math.min(100, (usedCredits / limitCredits) * 100) : 0,
  });
  return {
    included: { allowance, used, balance },
    // Compatibility aliases for deployed clients. Both represent the same
    // billing-cycle included balance; neither is a separately enforced window.
    weekly: window('Included credits', used, allowance),
    monthly: window('Included credits', used, allowance),
    periodStart: usage?.period_start ?? null,
    periodEnd: usage?.period_end ?? null,
  };
};

/** Resolve a scope's subscription row. workspaceId null = the user's personal
 *  workspace, which is keyed by owner rather than by workspace. */
const loadSubscription = async (
  admin: AdminSupabaseClient,
  userId: string,
  workspaceId: string | null,
): Promise<SubscriptionRow | null> => {
  const query = admin
    .from('timewarp_subscriptions')
    .select('id, workspace_id, owner_user_id, stripe_customer_id, stripe_subscription_id, plan, subscription_status, cancel_at_period_end, current_period_end, energy_monthly_extra_credits, energy_monthly_usd');
  const { data, error } = workspaceId
    ? await query.eq('workspace_id', workspaceId).maybeSingle<SubscriptionRow>()
    : await query.is('workspace_id', null).eq('owner_user_id', userId).maybeSingle<SubscriptionRow>();
  if (error) throw new Error('Could not verify the current subscription. No billing changes were made.');
  return data ?? null;
};

/** The caller's role in a scope, or null if they are not an active member.
 *  A personal workspace has exactly one member: its owner. */
const roleForScope = async (
  admin: AdminSupabaseClient,
  userId: string,
  workspaceId: string | null,
): Promise<string | null> => {
  if (!workspaceId) return 'owner';
  const { data, error } = await admin.rpc('timewarp_workspace_role_for', {
    p_user_id: userId,
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`Could not verify workspace membership: ${error.message}`);
  return typeof data === 'string' && data ? data : null;
};

/** Reuse the caller's Stripe customer, minting one only the first time. Stored
 *  immediately so an abandoned checkout cannot orphan a customer that a later
 *  attempt would duplicate. One customer per paying user, many subscriptions —
 *  a user can pay for several workspaces. */
const ensureCustomer = async (
  admin: AdminSupabaseClient,
  stripe: Stripe,
  userId: string,
  email: string | undefined,
): Promise<string> => {
  const { data: existing, error: lookupError } = await admin
    .from('timewarp_billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (lookupError) throw new Error('Could not verify the billing customer. No checkout was started.');
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  const customerKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { supabase_user_id: userId },
  }, { idempotencyKey: 'timewarp-billing-customer-' + customerKey });
  const { error: storeError } = await admin
    .from('timewarp_billing_customers')
    .upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: 'user_id' });
  if (storeError) throw new Error('Could not save the billing customer. No checkout was started.');
  return customer.id;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server is not configured.' }, 500);
    }

    const admin = createClient<any, 'public'>(supabaseUrl, serviceRoleKey);
    const auth = await authenticateRequest(req, admin);
    if (!auth.user) {
      return jsonResponse({ error: auth.message }, 401);
    }
    const user = auth.user;

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      plan?: string;
      workspaceId?: string | null;
      surface?: string;
      packCredits?: number;
      monthlyExtraCredits?: number;
      enabled?: boolean;
      threshold?: number;
      sessionId?: string;
    };
    const action = String(body.action || 'status');
    const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : null;

    // Where Stripe sends the browser back to. Deliberately a closed set rather
    // than a caller-supplied URL: Stripe will redirect to whatever we put in
    // success_url, so accepting one from the client would hand anyone an
    // open redirect off our own domain.
    const returnPath = (status: string, extra = '') =>
      body.surface === 'web'
        ? `/account?status=${status}${extra}`
        : `/billing-return.html?status=${status}${extra}`;

    // --- scopes -------------------------------------------------------------
    // Everywhere this user could put a plan: their personal workspace, plus
    // every workspace they are an active member of. canManage marks the ones
    // they may actually pay for.
    if (action === 'scopes') {
      const { data: memberships } = await admin
        .from('timewarp_workspace_members')
        .select('workspace_id, role, timewarp_workspaces(id, name)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      const rows = ((memberships || []) as unknown as Array<{
        workspace_id: string;
        role: string;
        timewarp_workspaces: { id: string; name: string } | null;
      }>).filter((row) => row.timewarp_workspaces);

      // Two queries, not one per workspace: this list only needs each scope's
      // plan name, so calling the full usage rollup per membership would be an
      // N+1 for data the picker never shows.
      const { data: personalSub } = await admin
        .from('timewarp_subscriptions')
        .select('plan')
        .is('workspace_id', null)
        .eq('owner_user_id', user.id)
        .maybeSingle<{ plan: string }>();

      const workspaceIds = rows.map((row) => row.workspace_id);
      const { data: workspaceSubs } = workspaceIds.length
        ? await admin
          .from('timewarp_subscriptions')
          .select('workspace_id, plan')
          .in('workspace_id', workspaceIds)
        : { data: [] as Array<{ workspace_id: string; plan: string }> };

      const planByWorkspace = new Map(
        (workspaceSubs || []).map((sub) => [sub.workspace_id, sub.plan]),
      );

      const scopes = [
        {
          workspaceId: null as string | null,
          name: 'Personal',
          role: 'owner',
          canManage: true,
          isPersonal: true,
          plan: isPlanId(personalSub?.plan) ? personalSub.plan : ('free' as PlanId),
        },
        ...rows.map((row) => {
          const plan = planByWorkspace.get(row.workspace_id);
          return {
            workspaceId: row.workspace_id as string | null,
            name: row.timewarp_workspaces!.name,
            role: row.role,
            canManage: canManageBilling(row.role),
            isPersonal: false,
            plan: isPlanId(plan) ? plan : ('free' as PlanId),
          };
        }),
      ];

      return jsonResponse({ scopes });
    }

    // Stripe webhooks remain the normal writer of billing state, but the
    // authenticated return leg also reconciles the exact Checkout Session the
    // user just completed. This closes the gap where a delayed/misconfigured
    // webhook leaves someone charged while the app still shows the Free allowance.
    // Every value below is re-read from Stripe and every grant is idempotent.
    if (action === 'sync-checkout' || action === 'cancel-checkout') {
      const sessionId = String(body.sessionId || '');
      if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
        return jsonResponse({ error: 'Choose a valid Checkout Session.' }, 400);
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription'],
      });
      const sessionUserId = session.metadata?.supabase_user_id || session.client_reference_id || '';
      if (sessionUserId !== user.id) {
        return jsonResponse({ error: 'This checkout does not belong to your account.' }, 403);
      }
      if(action==='cancel-checkout'){
        if(session.status==='open')await stripe.checkout.sessions.expire(session.id);
        return jsonResponse({ok:true});
      }
      if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) {
        return jsonResponse({ error: 'This checkout has not completed payment.' }, 409);
      }

      const purchasedWorkspaceId = session.metadata?.workspace_id?.trim() || null;
      const purchasedRole = await roleForScope(admin, user.id, purchasedWorkspaceId);
      if (!purchasedRole || !canManageBilling(purchasedRole)) {
        return jsonResponse({ error: 'You can no longer manage the workspace used for this checkout.' }, 403);
      }

      const purchasedCredits = Number(session.metadata?.pack_credits) || 0;
      const validPack = purchasedCredits > 0 ? getCreditPack(purchasedCredits) : null;
      let syncedPlan: PlanId | null = null;

      if (session.metadata?.kind !== 'credits') {
        const sessionSubscription = session.subscription;
        const stripeSubscription = typeof sessionSubscription === 'string'
          ? await stripe.subscriptions.retrieve(sessionSubscription)
          : sessionSubscription;
        if (!stripeSubscription || !('status' in stripeSubscription)) {
          return jsonResponse({ error: 'The completed checkout has no subscription.' }, 409);
        }

        const metadataPlan = stripeSubscription.items?.data?.[0]?.price?.metadata?.plan || stripeSubscription.metadata?.plan || session.metadata?.plan;
        if (!isPlanId(metadataPlan)) {
          return jsonResponse({ error: 'The completed checkout has no valid plan.' }, 409);
        }
        syncedPlan = isEntitledStatus(stripeSubscription.status) ? metadataPlan : 'free';
        const customerId = typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : stripeSubscription.customer?.id;
        const { error: subscriptionError } = await admin.rpc('timewarp_upsert_subscription', {
          p_workspace_id: purchasedWorkspaceId,
          p_owner_user_id: user.id,
          p_stripe_customer_id: customerId ?? null,
          p_stripe_subscription_id: stripeSubscription.id,
          p_plan: syncedPlan,
          p_subscription_status: stripeSubscription.status,
          p_cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
          p_current_period_end: toIso(periodEndSeconds(stripeSubscription)),
          p_plan_anchor_at: syncedPlan !== 'free' ? toIso(periodStartSeconds(stripeSubscription)) : null,
        });
        if (subscriptionError) {
          throw new Error(`Could not activate the purchased plan: ${subscriptionError.message}`);
        }
        await syncMonthlyPlanCredits(admin,stripeSubscription,syncedPlan,user.id,purchasedWorkspaceId);
      }

      if (validPack) {
        const { error: creditsError } = await admin.rpc('timewarp_grant_credits', {
          p_workspace_id: purchasedWorkspaceId,
          p_owner_user_id: user.id,
          p_credits: validPack.credits,
          p_kind: 'purchase',
          p_stripe_ref: session.id,
          p_user_id: user.id,
        });
        if (creditsError) throw new Error(`Could not add the purchased credits: ${creditsError.message}`);
      }

      return jsonResponse({
        ok: true,
        workspaceId: purchasedWorkspaceId,
        plan: syncedPlan,
        credits: validPack?.credits ?? 0,
      });
    }

    // Every remaining action targets one scope, so establish membership once.
    const role = await roleForScope(admin, user.id, workspaceId);
    if (!role) {
      return jsonResponse({ error: 'You are not a member of this workspace.' }, 403);
    }

    const subscription = await loadSubscription(admin, user.id, workspaceId);
    const currentPlan: PlanId = isPlanId(subscription?.plan) ? subscription.plan : 'free';

    // --- status -------------------------------------------------------------
    if (action === 'status') {
      const { data: usage, error: usageError } = await admin.rpc('timewarp_ai_usage', {
        p_user_id: user.id,
        p_workspace_id: workspaceId,
      });
      if (usageError) throw new Error(`Could not load AI credit balances: ${usageError.message}`);
      const usageRow = usage as Record<string, unknown> | null;
      const periodStart = typeof usageRow?.period_start === 'string' ? usageRow.period_start : null;
      const personalEnergy = body.surface === 'energy' && workspaceId === null;
      // These reads are independent once AI usage has established the billing
      // period. Avoid adding each database round trip to the page's load time.
      const [cloudResult, creditResult, customerResult] = await Promise.all([
        admin.rpc('timewarp_cloud_credit_usage', {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
        }),
        admin.rpc('timewarp_credit_usage_summary', {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
          p_period_start: periodStart,
        }),
        personalEnergy ? admin.from('timewarp_billing_customers').select('stripe_customer_id')
          .eq('user_id', user.id).maybeSingle<{ stripe_customer_id: string }>() : null,
      ]);
      const { data: cloudUsageData, error: cloudUsageError } = cloudResult;
      if (cloudUsageError) throw new Error(`Could not load Cloud Credit balances: ${cloudUsageError.message}`);
      const cloudUsage = (cloudUsageData && typeof cloudUsageData === 'object'
        ? cloudUsageData
        : {}) as Record<string, unknown>;
      const { data: creditUsageData, error: creditUsageError } = creditResult;
      if (creditUsageError) throw new Error(`Could not load purchased-credit usage: ${creditUsageError.message}`);
      const creditUsage = (creditUsageData && typeof creditUsageData === 'object'
        ? creditUsageData
        : {}) as Record<string, unknown>;
      if (customerResult?.error) throw new Error(`Could not load billing customer: ${customerResult.error.message}`);
      const hasPersonalCustomer = Boolean(customerResult?.data?.stripe_customer_id);
      return jsonResponse({
        plan: currentPlan,
        workspaceId,
        role,
        canManage: canManageBilling(role),
        isPersonal: workspaceId === null,
        subscriptionStatus: subscription?.subscription_status || null,
        cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
        currentPeriodEnd: subscription?.current_period_end || null,
        hasSubscription: Boolean(subscription?.stripe_subscription_id),
        monthlyCreditAddons: MONTHLY_CREDIT_ADDONS,
        monthlyExtraCredits: currentPlan==='free'?0:Number(subscription?.energy_monthly_extra_credits)||0,
        monthlyUsd: subscription?.energy_monthly_usd ?? null,
        // Only the person paying may open the Stripe portal — it exposes their
        // card and invoices, which a co-admin has no business seeing.
        canOpenPortal: personalEnergy ? hasPersonalCustomer : Boolean(subscription?.stripe_subscription_id) && subscription?.owner_user_id === user.id,
        budgets: Object.fromEntries(Object.entries(PLAN_BUDGETS).map(([id, budget]) => [
          id,
          // Kept only for deployed clients that still initialize a local meter.
          { ...budget, weeklyCredits: budget.monthlyCredits },
        ])),
        usage: usagePayload(currentPlan, usageRow),
        includedCredits: {
          allowance: Math.max(0, Number(usageRow?.included_allowance_credits) || 0),
          balance: Math.max(0, Number(usageRow?.included_balance_credits) || 0),
        },
        cloudCredits: {
          allowance: Math.max(0, Number(cloudUsage.cloud_allowance_credits) || 0),
          used: Math.max(0, Number(cloudUsage.cloud_used_credits) || 0),
          balance: Math.max(0, Number(cloudUsage.cloud_balance_credits) || 0),
        },
        usageBreakdown: {
          aiCreditsUsed: Math.max(0, Number(cloudUsage.ai_usage_credits_spent) || 0),
          cloudComputeCreditsUsed: Math.max(0, Number(cloudUsage.cloud_compute_credits_spent) || 0),
        },
        purchasedCredits: {
          balance: Number(usageRow?.purchased_balance_credits) || 0,
        },
        credits: {
          // Legacy alias used by deployed billing surfaces.
          balance: Number(usageRow?.purchased_balance_credits) || 0,
          usedThisPeriod: Math.max(0, Number(creditUsage.usedThisPeriod) || 0),
          lastUsedAt: typeof creditUsage.lastUsedAt === 'string' ? creditUsage.lastUsedAt : null,
          usdPerCredit: USD_PER_CREDIT,
          markup: AI_COST_MARKUP,
          packs: CREDIT_PACKS.map((pack) => ({ credits: pack.credits, usd: pack.priceUsd })),
          autoRecharge: {
            enabled: Boolean(usageRow?.auto_recharge_enabled),
            packCredits: Number(usageRow?.auto_recharge_pack_credits) || null,
            // Whether the caller is the one whose card gets charged; the UI
            // shows "paid by someone else" to everyone else.
            isPayer: usageRow?.auto_recharge_user_id === user.id,
            failures: Number(usageRow?.recharge_failures) || 0,
          },
        },
      });
    }

    const stripe = getStripe();
    const siteUrl = getSiteUrl();

    // --- portal -------------------------------------------------------------
    if (action === 'portal') {
      const { data: customer } = await admin
        .from('timewarp_billing_customers')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle<{ stripe_customer_id: string }>();
      if (!customer?.stripe_customer_id) {
        return jsonResponse({ error: 'Make a purchase to create your billing account first.' }, 400);
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: `${siteUrl}${returnPath('portal')}`,
      });
      return jsonResponse({ url: session.url });
    }

    // --- buy extra credits --------------------------------------------------
    if (action === 'buy-credits') {
      if (!canManageBilling(role)) {
        return jsonResponse({ error: 'Only workspace owners and admins can buy credits for it.' }, 403);
      }
      const configuredPack = getCreditPack(body.packCredits);
      const pack = configuredPack && body.surface === 'energy' ? {...configuredPack, priceId: await creditPackPrice(stripe,configuredPack)} : configuredPack;
      if (!pack) {
        return jsonResponse({ error: 'Choose a valid credit pack.' }, 400);
      }

      const customerId = await ensureCustomer(admin, stripe, user.id, user.email);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(body.surface === 'energy' ? { payment_method_types: ['card' as const] } : {}),
        customer: customerId,
        line_items: [{ price: pack.priceId, quantity: 1 }],
        client_reference_id: user.id,
        // kind marks this apart from subscription checkouts; the webhook grants
        // from these fields, so this metadata IS the purchase record.
        metadata: {
          kind: 'credits',
          pack_credits: String(pack.credits),
          workspace_id: workspaceId ?? '',
          supabase_user_id: user.id,
        },
        // Saving the card is what makes auto-recharge possible later: the
        // off-session PaymentIntent charges this stored payment method.
        payment_intent_data: { setup_future_usage: 'off_session' },
        allow_promotion_codes: body.surface !== 'energy',
        success_url: `${siteUrl}${returnPath('success', `&credits=${pack.credits}&session_id={CHECKOUT_SESSION_ID}`)}`,
        cancel_url: `${siteUrl}${returnPath('cancelled')}`,
      });

      return jsonResponse({ url: session.url, sessionId: session.id, amountTotal: session.amount_total, currency: session.currency });
    }

    // --- auto-recharge settings ---------------------------------------------
    if (action === 'auto-recharge') {
      if (!canManageBilling(role)) {
        return jsonResponse({ error: 'Only workspace owners and admins can change auto-recharge.' }, 403);
      }
      const enabled = body.enabled === true;
      const pack = enabled ? getCreditPack(body.packCredits) : null;
      if (enabled && !pack) {
        return jsonResponse({ error: 'Choose which credit pack to recharge with.' }, 400);
      }

      if (enabled) {
        // Enabling commits the caller's saved card to future off-session
        // charges, so verify there is one now rather than failing silently at
        // 2am when the balance runs out.
        const { data: customerRow } = await admin
          .from('timewarp_billing_customers')
          .select('stripe_customer_id')
          .eq('user_id', user.id)
          .maybeSingle<{ stripe_customer_id: string }>();
        const cards = customerRow?.stripe_customer_id
          ? await stripe.paymentMethods.list({ customer: customerRow.stripe_customer_id, type: 'card', limit: 1 }).catch(() => null)
          : null;
        if (!cards?.data?.length) {
          return jsonResponse({
            error: 'No saved card yet. Buy a credit pack or subscribe first — that stores your card, then auto-recharge can use it.',
          }, 400);
        }
      }

      const { error: setError } = await admin.rpc('timewarp_set_credit_recharge', {
        p_workspace_id: workspaceId,
        p_owner_user_id: user.id,
        p_user_id: user.id,
        p_enabled: enabled,
        p_pack_credits: pack?.credits ?? null,
        p_threshold: Number(body.threshold) || 0,
      });
      if (setError) {
        return jsonResponse({ error: `Could not save auto-recharge: ${setError.message}` }, 500);
      }
      return jsonResponse({ ok: true, enabled, packCredits: pack?.credits ?? null });
    }

    // --- checkout / plan change --------------------------------------------
    if (action === 'checkout') {
      if (!canManageBilling(role)) {
        return jsonResponse({ error: 'Only workspace owners and admins can change the plan.' }, 403);
      }
      if (!isPlanId(body.plan) || body.plan === 'free') {
        return jsonResponse({ error: 'Choose a paid plan to check out.' }, 400);
      }
      const targetPlan: PlanId = body.plan;
      let extraCredits=0;
      try{extraCredits=monthlyExtraCredits(body.monthlyExtraCredits);}catch{return jsonResponse({error:'Choose a valid monthly credit addition.'},400);}
      if(extraCredits&&(body.surface!=='energy'||workspaceId))return jsonResponse({error:'Monthly credit additions are available on personal desktop plans.'},400);
      const priceId = body.surface === 'energy' ? await monthlyPlanPrice(stripe,targetPlan,getPlanPriceId(targetPlan),extraCredits) : getPlanPriceId(targetPlan);
      if (!priceId) {
        return jsonResponse({ error: `No Stripe price is configured for the ${targetPlan} plan.` }, 500);
      }

      // Optional credit pack bundled with the plan (the pricing page's in-card
      // picker). An unknown pack is refused rather than silently dropped —
      // dropping it would charge less than the price the user just agreed to.
      const configuredBundle = body.packCredits ? getCreditPack(body.packCredits) : null;
      const bundledPack = configuredBundle && body.surface === 'energy' ? {...configuredBundle, priceId: await creditPackPrice(stripe,configuredBundle)} : configuredBundle;
      if (body.packCredits && !bundledPack) {
        return jsonResponse({ error: 'Choose a valid credit pack.' }, 400);
      }

      const customerId = await ensureCustomer(admin, stripe, user.id, user.email);

      // Payment-mode session for just the pack — used when the plan part needs
      // no checkout (already on the plan, or swapped in place below).
      const createCreditsOnlySession = async (pack: NonNullable<typeof bundledPack>) =>
        stripe.checkout.sessions.create({
          mode: 'payment',
          ...(body.surface === 'energy' ? { payment_method_types: ['card' as const] } : {}),
          customer: customerId,
          line_items: [{ price: pack.priceId, quantity: 1 }],
          client_reference_id: user.id,
          metadata: {
            kind: 'credits',
            pack_credits: String(pack.credits),
            workspace_id: workspaceId ?? '',
            supabase_user_id: user.id,
          },
          payment_intent_data: { setup_future_usage: 'off_session' },
          allow_promotion_codes: body.surface !== 'energy',
          success_url: `${siteUrl}${returnPath('success', `&credits=${pack.credits}&session_id={CHECKOUT_SESSION_ID}`)}`,
          cancel_url: `${siteUrl}${returnPath('cancelled')}`,
        });

      // An existing live subscription must be *modified*, never re-checked-out:
      // a second Checkout Session would create a second subscription on the same
      // workspace and bill twice. Swap the price on the existing item and let
      // Stripe prorate.
      if (subscription?.stripe_subscription_id) {
        const existing = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

        if (existing && existing.status !== 'canceled' && existing.status !== 'incomplete_expired') {
          if (subscription.owner_user_id !== user.id) {
            return jsonResponse({
              error: 'This workspace\'s plan is paid for by another member. Ask them to change it.',
            }, 403);
          }
          const existingExtra=body.surface==='energy'&&!workspaceId?planSubscriptionExtras(existing,existing.items.data[0]?.price.metadata?.plan||existing.metadata.plan||currentPlan):0;
          if (currentPlan === targetPlan && existingExtra===extraCredits && !existing.cancel_at_period_end) {
            // Already on the plan: the only thing left to buy is the credits.
            if (bundledPack) {
              const creditsSession = await createCreditsOnlySession(bundledPack);
              return jsonResponse({ url: creditsSession.url, sessionId: creditsSession.id });
            }
            return jsonResponse({ error: `This workspace is already on ${targetPlan}.` }, 400);
          }
          const item = existing.items.data[0];
          // Payment failure leaves the original subscription and allowance intact.
          const updated = await stripe.subscriptions.update(existing.id, {
            items: [{ id: item.id, price: priceId, quantity:1 }],
            proration_behavior: body.surface==='energy'?'always_invoice':'create_prorations',
            ...(body.surface==='energy'?{payment_behavior:'error_if_incomplete' as const}:{}),
            cancel_at_period_end: false,
            metadata: {
              ...existing.metadata,
              plan: targetPlan,
              supabase_user_id: user.id,
              workspace_id: workspaceId ?? '',
            },
          });
          // In-place swaps cannot carry a one-time item, so bundled credits
          // become a follow-up payment checkout the client opens right away.
          if (bundledPack) {
            const creditsSession = await createCreditsOnlySession(bundledPack);
            return jsonResponse({
              updated: true,
              plan: targetPlan,
              currentPeriodEnd: toIso(periodEndSeconds(updated)),
              url: creditsSession.url,
              sessionId: creditsSession.id,
            });
          }
          // The webhook is still the writer of record; this only tells the
          // client to refresh rather than open a browser.
          return jsonResponse({
            updated: true,
            plan: targetPlan,
            currentPeriodEnd: toIso(periodEndSeconds(updated)),
          });
        }
      }

      const session = await subscriptionCheckout(admin, stripe, user.id, workspaceId, {
        mode: 'subscription',
        ...(body.surface === 'energy' ? { payment_method_types: ['card' as const] } : {}),
        customer: customerId,
        // Subscription mode accepts one-time prices alongside the recurring
        // one; Stripe bills the pack on the first invoice. One session, one
        // payment for plan + credits.
        line_items: [
          { price: priceId, quantity: 1 },
          ...(bundledPack ? [{ price: bundledPack.priceId, quantity: 1 }] : []),
        ],
        client_reference_id: user.id,
        // Both metadata blocks matter: the session's is read by
        // checkout.session.completed, the subscription's by every later
        // customer.subscription.* event. workspace_id is how the webhook knows
        // which scope to grant — an empty string means the personal workspace,
        // since Stripe metadata cannot hold null. pack_credits is what makes
        // the webhook grant the bundled credits alongside the plan.
        metadata: {
          supabase_user_id: user.id,
          plan: targetPlan,
          workspace_id: workspaceId ?? '',
          ...(bundledPack ? { pack_credits: String(bundledPack.credits) } : {}),
        },
        subscription_data: {
          metadata: { supabase_user_id: user.id, plan: targetPlan, workspace_id: workspaceId ?? '' },
        },
        allow_promotion_codes: body.surface !== 'energy',
        success_url: `${siteUrl}${returnPath('success', `&plan=${targetPlan}${bundledPack ? `&credits=${bundledPack.credits}` : ''}&session_id={CHECKOUT_SESSION_ID}`)}`,
        cancel_url: `${siteUrl}${returnPath('cancelled')}`,
      });

      return jsonResponse({ url: session.url, sessionId: session.id, amountTotal: session.amount_total, currency: session.currency });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Billing request failed.';
    console.error('[stripe-billing]', message);
    const status = error && typeof error === 'object' && 'status' in error && [409,503].includes(Number(error.status)) ? Number(error.status) : 500;
    return jsonResponse({ error: message }, status);
  }
});
