// Stripe webhook — the single writer of subscription state.
//
// Runs without a Supabase JWT (verify_jwt = false in config.toml): Stripe is the
// caller, and the Stripe-Signature header is what authenticates it. Never trust
// an unverified body here; a forged request would be a free upgrade for anyone
// who can guess the URL.
//
// Required secret: STRIPE_WEBHOOK_SECRET (whsec_...), from the endpoint you
// create at dashboard.stripe.com/webhooks pointing at this function.
//
// Subscribed events:
//   checkout.session.completed        — subscription, credit pack, or agent card setup
//   checkout.session.async_payment_succeeded — fulfillment after a delayed payment
//   customer.subscription.created     — belt-and-braces alongside checkout
//   customer.subscription.updated     — upgrades, downgrades, renewals, lapses
//   customer.subscription.deleted     — cancellation, back to free
//   payment_intent.succeeded          — auto-recharge charge settled
//   payment_intent.payment_failed     — auto-recharge charge declined
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import {
  isEntitledStatus,
  isPlanId,
  planFromPriceId,
  planFromProductId,
  type PlanId,
} from '../_shared/plans.ts';
import { getStripe, Stripe } from '../_shared/stripe.ts';
import { syncMonthlyPlanCredits } from '../_shared/timewarpPricing.ts';

type AdminClient = any;

// Stripe moved current_period_start/end onto the subscription item in the
// 2025-03-31 API version. Prefer the item, fall back to the legacy top-level
// field, so this keeps working either side of that change.
const periodBounds = (subscription: Stripe.Subscription) => {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const legacy = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  return {
    start: item?.current_period_start ?? legacy.current_period_start ?? null,
    end: item?.current_period_end ?? legacy.current_period_end ?? null,
  };
};

const toIso = (seconds: number | null): string | null =>
  seconds == null ? null : new Date(seconds * 1000).toISOString();

/** Which plan a subscription grants. Metadata is authoritative because we set it
 *  at checkout; the price and product lookups cover subscriptions created out of
 *  band (e.g. straight from the Stripe dashboard). */
const planForSubscription = (subscription: Stripe.Subscription): PlanId | null => {
  const pricedPlan=subscription.items?.data?.[0]?.price?.metadata?.plan;
  if(isPlanId(pricedPlan))return pricedPlan;
  const fromMetadata = subscription.metadata?.plan;
  if (isPlanId(fromMetadata)) return fromMetadata;

  const item = subscription.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;

  const fromPrice = planFromPriceId(price.id);
  if (fromPrice) return fromPrice;

  const productId = typeof price.product === 'string' ? price.product : price.product?.id;
  return planFromProductId(String(productId || ''));
};

const resolveUserId = async (
  admin: AdminClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<string | null> => {
  const fromMetadata = subscription.metadata?.supabase_user_id;
  if (fromMetadata) return fromMetadata;

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return null;

  const { data } = await admin
    .from('timewarp_billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (data?.user_id) return data.user_id;

  // Last resort: the customer we created carries the id in its own metadata.
  const customer = await stripe.customers.retrieve(customerId).catch(() => null);
  if (customer && !customer.deleted) {
    const id = (customer as Stripe.Customer).metadata?.supabase_user_id;
    if (id) return id;
  }
  return null;
};

/** Which scope this subscription grants. Stripe metadata cannot hold null, so
 *  the personal workspace is written as an empty string and read back as null. */
const workspaceIdForSubscription = (subscription: Stripe.Subscription): string | null => {
  const raw = subscription.metadata?.workspace_id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

const stripeObjectId = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id || '';

const applyAgentCardSetup = async (
  admin: AdminClient,
  stripe: Stripe,
  checkoutSessionId: string,
) => {
  // Re-read every object from Stripe rather than trusting metadata or card data
  // copied into the webhook payload.
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const userId = session.metadata?.supabase_user_id || '';
  const agentId = session.metadata?.agent_id || '';
  if (session.mode !== 'setup'
    || session.status !== 'complete'
    || session.metadata?.kind !== 'timewarp_agent_card_wallet_setup'
    || !userId
    || !agentId
    || session.client_reference_id !== userId) {
    console.warn('[stripe-webhook] Invalid agent card setup session; ignoring.');
    return;
  }

  const { data: walletCustomer, error: customerError } = await admin
    .from('timewarp_agent_payment_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (customerError) throw new Error(`Failed to verify the agent wallet customer: ${customerError.message}`);
  const expectedCustomer = typeof walletCustomer?.stripe_customer_id === 'string'
    ? walletCustomer.stripe_customer_id : '';
  if (!expectedCustomer || stripeObjectId(session.customer) !== expectedCustomer) {
    console.warn('[stripe-webhook] Agent card setup customer mismatch; ignoring.');
    return;
  }

  const setupIntentId = stripeObjectId(session.setup_intent);
  if (!setupIntentId) throw new Error('Completed agent card setup has no SetupIntent.');
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.status !== 'succeeded'
    || stripeObjectId(setupIntent.customer) !== expectedCustomer
    || setupIntent.metadata?.kind !== 'timewarp_agent_card_wallet_setup'
    || setupIntent.metadata?.supabase_user_id !== userId
    || setupIntent.metadata?.agent_id !== agentId) {
    console.warn('[stripe-webhook] Agent card SetupIntent ownership mismatch; ignoring.');
    return;
  }

  const paymentMethodId = stripeObjectId(setupIntent.payment_method);
  if (!paymentMethodId) throw new Error('Completed agent card setup has no payment method.');
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (stripeObjectId(paymentMethod.customer) !== expectedCustomer) {
    console.warn('[stripe-webhook] Agent card payment method customer mismatch; ignoring.');
    return;
  }

  const brand = paymentMethod.type === 'card' ? String(paymentMethod.card?.brand || '').toLowerCase() : '';
  if (!paymentMethod.card || !['visa', 'mastercard'].includes(brand)) {
    await stripe.paymentMethods.detach(paymentMethod.id).catch(() => undefined);
    console.warn('[stripe-webhook] Unsupported agent wallet card was detached.');
    return;
  }

  const { data: stored, error: storeError } = await admin.rpc('timewarp_store_agent_card', {
    p_user_id: userId,
    p_agent_id: agentId,
    p_stripe_payment_method_id: paymentMethod.id,
    p_brand: brand,
    p_last4: paymentMethod.card.last4,
    p_exp_month: paymentMethod.card.exp_month,
    p_exp_year: paymentMethod.card.exp_year,
  });
  if (storeError) throw new Error(`Failed to save the agent wallet card: ${storeError.message}`);
  const result = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
  if (result.ok !== true) {
    await stripe.paymentMethods.detach(paymentMethod.id).catch(() => undefined);
    throw new Error('Failed to save the agent wallet card.');
  }

  const oldPaymentMethodId = typeof result.old_payment_method_id === 'string'
    ? result.old_payment_method_id : '';
  if (oldPaymentMethodId && oldPaymentMethodId !== paymentMethod.id) {
    await stripe.paymentMethods.detach(oldPaymentMethodId).catch(() => undefined);
  }
  console.log('[stripe-webhook] Agent wallet card connected.');
};

const applySubscription = async (
  admin: AdminClient,
  stripe: Stripe,
  subscriptionId: string,
) => {
  // Always re-read from Stripe rather than trusting the event payload. Webhook
  // deliveries can arrive out of order (an `updated` after a `deleted`), and
  // re-reading means whatever we write is Stripe's current truth, so the final
  // state converges no matter the delivery order.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(admin, stripe, subscription);
  if (!userId) {
    console.warn(`[stripe-webhook] No TimeWarp user for subscription ${subscriptionId}; ignoring.`);
    return;
  }

  const entitled = isEntitledStatus(subscription.status);
  const plan = planForSubscription(subscription);
  const workspaceId = workspaceIdForSubscription(subscription);
  const { start, end } = periodBounds(subscription);

  // A lapsed or cancelled subscription falls back to free rather than keeping a
  // paid plan nobody is paying for.
  const effectivePlan: PlanId = entitled && plan ? plan : 'free';
  if (entitled && !plan) {
    console.warn(`[stripe-webhook] Subscription ${subscriptionId} is ${subscription.status} but maps to no known plan; defaulting to free.`);
  }

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  // Written through a SQL function rather than PostgREST .upsert(): uniqueness
  // per scope is enforced by partial indexes, which ON CONFLICT can only target
  // when given the index predicate — something PostgREST cannot express.
  const { error } = await admin.rpc('timewarp_upsert_subscription', {
    p_workspace_id: workspaceId,
    p_owner_user_id: userId,
    p_stripe_customer_id: customerId ?? null,
    p_stripe_subscription_id: subscription.id,
    p_plan: effectivePlan,
    p_subscription_status: subscription.status,
    p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    p_current_period_end: toIso(end),
    // Align the pooled monthly window with the billing period so the allowance
    // resets exactly when the workspace is charged. null means "leave it": a
    // scope dropping to free keeps its anchor rather than getting a fresh month.
    p_plan_anchor_at: effectivePlan !== 'free' ? toIso(start) : null,
  });
  if (error) throw new Error(`Failed to store subscription for ${userId}: ${error.message}`);
  await syncMonthlyPlanCredits(admin,subscription,effectivePlan,userId,workspaceId);

  console.log(
    `[stripe-webhook] ${workspaceId ? `workspace ${workspaceId}` : `personal ${userId}`} -> ${effectivePlan} (${subscription.status})`,
  );
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('Stripe-Signature') || '';
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured.');
    return new Response('Webhook is not configured', { status: 500 });
  }
  if (!signature) {
    return new Response('Missing Stripe-Signature', { status: 400 });
  }

  const payload = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    // constructEventAsync + SubtleCryptoProvider: Deno has no Node crypto, so
    // the synchronous constructEvent cannot verify the HMAC here.
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'signature verification failed';
    console.warn(`[stripe-webhook] Rejected unverified request: ${message}`);
    return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials are not configured.');
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Merchant metadata must never grant platform subscriptions or credits.
    if (event.account) return new Response('Use the Connect webhook endpoint', { status: 400 });
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Completion alone can precede a delayed payment. Card-wallet setup
        // creates no purchased entitlement; every purchase must be paid first.
        if (session.metadata?.kind !== 'timewarp_agent_card_wallet_setup'
            && !['paid','no_payment_required'].includes(session.payment_status)) break;

        // A credit-pack purchase (mode: payment). The session metadata written
        // by stripe-billing is the purchase record; the ledger's unique
        // stripe_ref makes redelivered events grant nothing.
        if (session.metadata?.kind === 'credits') {
          const credits = Number(session.metadata.pack_credits) || 0;
          const buyerId = session.metadata.supabase_user_id || session.client_reference_id || '';
          const creditWorkspace = session.metadata.workspace_id?.trim() || null;
          if (credits > 0 && buyerId) {
            const { error: grantError } = await admin.rpc('timewarp_grant_credits', {
              p_workspace_id: creditWorkspace,
              p_owner_user_id: buyerId,
              p_credits: credits,
              p_kind: 'purchase',
              p_stripe_ref: session.id,
              p_user_id: buyerId,
            });
            if (grantError) throw new Error(`Failed to grant credits: ${grantError.message}`);
            console.log(`[stripe-webhook] Granted ${credits} credits to ${creditWorkspace ?? `personal ${buyerId}`}.`);
          } else {
            console.warn('[stripe-webhook] Credit checkout without credits/user metadata; ignoring.');
          }
          break;
        }

        if (session.metadata?.kind === 'timewarp_agent_card_wallet_setup') {
          await applyAgentCardSetup(admin, stripe, session.id);
          break;
        }

        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
        if (!subscriptionId) {
          console.log('[stripe-webhook] checkout.session.completed without a subscription; ignoring.');
          break;
        }
        // The session knows the user even when the subscription's own metadata
        // is missing, so backfill the customer link before syncing.
        const userId = session.client_reference_id || session.metadata?.supabase_user_id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (userId && customerId) {
          await admin
            .from('timewarp_billing_customers')
            .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' });
        }
        await applySubscription(admin, stripe, subscriptionId);

        // A credit pack bundled into the plan checkout (the pricing page's
        // in-card picker) rides on the same session; grant it alongside the
        // subscription. Idempotent via the session id, like every grant.
        const bundledCredits = Number(session.metadata?.pack_credits) || 0;
        if (bundledCredits > 0 && userId) {
          const bundleWorkspace = session.metadata?.workspace_id?.trim() || null;
          const { error: bundleError } = await admin.rpc('timewarp_grant_credits', {
            p_workspace_id: bundleWorkspace,
            p_owner_user_id: userId,
            p_credits: bundledCredits,
            p_kind: 'purchase',
            p_stripe_ref: session.id,
            p_user_id: userId,
          });
          if (bundleError) throw new Error(`Failed to grant bundled credits: ${bundleError.message}`);
          console.log(`[stripe-webhook] Granted ${bundledCredits} bundled credits to ${bundleWorkspace ?? `personal ${userId}`}.`);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await applySubscription(admin, stripe, subscription.id);
        break;
      }

      // Auto-recharge outcomes. Only PaymentIntents created by the recharge
      // engine carry kind: 'credit-recharge'; checkout-purchase PaymentIntents
      // have no such metadata and fall through untouched (their grant happens
      // on checkout.session.completed).
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata?.kind !== 'credit-recharge') break;
        const credits = Number(intent.metadata.pack_credits) || 0;
        const ownerId = intent.metadata.supabase_user_id || '';
        const creditWorkspace = intent.metadata.workspace_id?.trim() || null;
        if (credits > 0 && ownerId) {
          // The engine already granted on synchronous success; the unique
          // stripe_ref makes this second grant a no-op. It exists for charges
          // that settle only after the engine's request timed out.
          const { error: grantError } = await admin.rpc('timewarp_grant_credits', {
            p_workspace_id: creditWorkspace,
            p_owner_user_id: ownerId,
            p_credits: credits,
            p_kind: 'recharge',
            p_stripe_ref: intent.id,
            p_user_id: ownerId,
          });
          if (grantError) throw new Error(`Failed to grant recharge credits: ${grantError.message}`);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata?.kind !== 'credit-recharge') break;
        const ownerId = intent.metadata.supabase_user_id || '';
        const creditWorkspace = intent.metadata.workspace_id?.trim() || null;
        if (ownerId) {
          await admin.rpc('timewarp_credit_recharge_failed', {
            p_workspace_id: creditWorkspace,
            p_owner_user_id: ownerId,
            p_stripe_ref: intent.id,
          });
          console.warn(`[stripe-webhook] Auto-recharge failed for ${creditWorkspace ?? `personal ${ownerId}`}; backing off.`);
        }
        break;
      }

      default:
        // Unsubscribed event types still return 200 so Stripe stops retrying.
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook handling failed.';
    // 500 so Stripe retries with backoff rather than dropping the event.
    console.error(`[stripe-webhook] ${event.type} failed: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
