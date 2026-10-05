/// <reference path="../_types/deno-shims.d.ts" />
// Credit packs + conversion math, and the auto-recharge engine.
//
// Credits are the single customer-facing usage unit. Included plan credits are
// consumed first; when they are exhausted, calls draw from the workspace's
// pooled purchased-credit balance. Both are pooled per workspace.
//
// Conversion
// ----------
// Every credit redeems the SAME fixed dollar amount of marked-up AI charge:
//
//   credits = (apiCostUsd × AI_COST_MARKUP) / USD_PER_CREDIT
//
// USD_PER_CREDIT is pinned to the best-value pack (1000 credits / $125 =
// $0.125), so the bulk discount on the packs is real: a 50-pack credit costs
// $0.30 but buys the same AI as a 1000-pack credit. Margin is therefore ≥33%
// on every pack and rises as the packs get smaller.
//
// Worked example (matches the spec): a call costing $0.004 raw →
// 0.004 × 1.33 = $0.00532 → / 0.125 = 0.04256 credits.

export const USD_PER_CREDIT = 0.125;

// 33% *markup* (cost × 1.33), the standard reading of "33% on top of cost".
// If this should ever become a true 33% *margin* (profit as a share of the
// selling price), change this single constant to 1 / (1 - 0.33) ≈ 1.4925.
export const AI_COST_MARKUP = 1.33;
const edgeEnv = (name: string): string => typeof Deno !== 'undefined' ? Deno.env.get(name) || '' : '';

export const creditsForApiCost = (apiCostUsd: number): number => {
  const cost = Number(apiCostUsd);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return (cost * AI_COST_MARKUP) / USD_PER_CREDIT;
};

// --- Packs ------------------------------------------------------------------
// Live products on the TimeWarpDev Stripe account. Price ids can be overridden
// per pack via STRIPE_PRICE_CREDITS_<N> for a test-mode deploy.
export interface CreditPack {
  credits: number;
  priceUsd: number;
  priceCents: number;
  priceId: string;
  productId: string;
}

const PACK_DEFAULTS: Array<[number, number, string, string]> = [
  [50, 15, 'price_1TuBtaGKbzbe9CQLtUqb2mxe', 'prod_UtztRuR6AgJXZJ'],
  [100, 30, 'price_1TuBtuGKbzbe9CQLB94hLCFS', 'prod_Utztbj6dcjm1mz'],
  [200, 45, 'price_1TuBuhGKbzbe9CQLHyVtD3vS', 'prod_Utzu2buvQKAeVw'],
  [300, 60, 'price_1TuBv5GKbzbe9CQLZna5AzWL', 'prod_Utzu9pMukK9zTx'],
  [500, 75, 'price_1TuBvcGKbzbe9CQLtxpUteui', 'prod_UtzvOHLiRETi6r'],
  [750, 100, 'price_1TuBvwGKbzbe9CQLvsYGOXj9', 'prod_Utzv9aHPkSyV77'],
  [1000, 125, 'price_1TuBx9GKbzbe9CQLtYgLHBbq', 'prod_UtzxBo4A6oh0ha'],
];

export const CREDIT_PACKS: CreditPack[] = PACK_DEFAULTS.map(([credits, priceUsd, priceId, productId]) => ({
  credits,
  priceUsd,
  priceCents: Math.round(priceUsd * 100),
  priceId: edgeEnv(`STRIPE_PRICE_CREDITS_${credits}`) || priceId,
  productId,
}));

export const getCreditPack = (credits: unknown): CreditPack | null => {
  const size = Number(credits);
  return CREDIT_PACKS.find((pack) => pack.credits === size) ?? null;
};

// --- Auto-recharge ----------------------------------------------------------
// The atomic usage settlement in Postgres spends credits. This module handles
// the external Stripe top-up after that transaction reports that the resulting
// balance crossed the configured threshold.
//
// The recharge is deliberately raw REST rather than the Stripe SDK: this runs
// inside ai-proxy, and importing the SDK there would tax the cold start of
// every AI call for a path that fires rarely.
//
// Concurrency: timewarp_claim_credit_recharge hands the recharge to exactly one
// caller (row-locked claim with a 10-minute in-flight window and a 1-hour
// backoff after a card failure). There is intentionally no spend cap beyond
// that — the operator chose uncapped recharging — so the claim lock is about
// preventing N simultaneous charges, not limiting total spend.

const STRIPE_API = 'https://api.stripe.com/v1';

const stripeHeaders = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/x-www-form-urlencoded',
});

interface ClaimResult {
  claimed?: boolean;
  pack_credits?: number;
  recharge_user_id?: string;
}

/** Start a top-up after the atomic usage settlement reports that the resulting
 * balance crossed the configured threshold. Claiming remains serialized in
 * Postgres so concurrent calls cannot create duplicate Stripe charges. */
export async function maybeRechargeSettledCredits(
  admin: any,
  userId: string,
  workspaceId: string | null,
  belowThreshold: boolean,
): Promise<void> {
  if (!belowThreshold) return;
  try {
    const { data: claimData } = await admin.rpc('timewarp_claim_credit_recharge', {
      p_workspace_id: workspaceId,
      p_owner_user_id: userId,
    });
    const claim = (claimData && typeof claimData === 'object' ? claimData : {}) as ClaimResult;
    if (claim.claimed && claim.pack_credits && claim.recharge_user_id) {
      await fireAutoRecharge(admin, workspaceId, userId, claim.pack_credits, claim.recharge_user_id);
    }
  } catch (error) {
    console.warn('[credits] automatic recharge failed:', error instanceof Error ? error.message : error);
  }
}

const markRechargeFailed = async (
  admin: any,
  workspaceId: string | null,
  ownerUserId: string,
  reason: string,
  stripeRef: string | null = null,
) => {
  console.warn(`[credits] auto-recharge failed (${reason}); backing off.`);
  try {
    await admin.rpc('timewarp_credit_recharge_failed', {
      p_workspace_id: workspaceId,
      p_owner_user_id: ownerUserId,
      p_stripe_ref: stripeRef,
    });
  } catch (error) {
    console.warn('[credits] could not record recharge failure:', error instanceof Error ? error.message : error);
  }
};

async function fireAutoRecharge(
  admin: any,
  workspaceId: string | null,
  ownerUserId: string,
  packCredits: number,
  rechargeUserId: string,
): Promise<void> {
  const key = edgeEnv('STRIPE_SECRET_KEY');
  const pack = getCreditPack(packCredits);
  if (!key || !pack) {
    await markRechargeFailed(admin, workspaceId, ownerUserId, key ? 'unknown pack' : 'no Stripe key');
    return;
  }

  // The card charged is the configurer's saved card (saved by Checkout with
  // setup_future_usage when they last bought something).
  const { data: customerRow } = await admin
    .from('timewarp_billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', rechargeUserId)
    .maybeSingle();
  const customerId = customerRow?.stripe_customer_id;
  if (!customerId) {
    await markRechargeFailed(admin, workspaceId, ownerUserId, 'no Stripe customer for recharge user');
    return;
  }

  try {
    // Default payment method first, most recently attached card as fallback.
    let paymentMethod = '';
    const customerRes = await fetch(`${STRIPE_API}/customers/${customerId}`, { headers: stripeHeaders(key) });
    if (customerRes.ok) {
      const customer = await customerRes.json();
      paymentMethod = String(customer?.invoice_settings?.default_payment_method || '');
    }
    if (!paymentMethod) {
      const listRes = await fetch(
        `${STRIPE_API}/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`,
        { headers: stripeHeaders(key) },
      );
      if (listRes.ok) {
        const list = await listRes.json();
        paymentMethod = String(list?.data?.[0]?.id || '');
      }
    }
    if (!paymentMethod) {
      await markRechargeFailed(admin, workspaceId, ownerUserId, 'no saved card');
      return;
    }

    const body = new URLSearchParams({
      amount: String(pack.priceCents),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethod,
      off_session: 'true',
      confirm: 'true',
      description: `TimeWarp auto-recharge: ${pack.credits} credits`,
      'metadata[kind]': 'credit-recharge',
      'metadata[workspace_id]': workspaceId ?? '',
      'metadata[supabase_user_id]': ownerUserId,
      'metadata[pack_credits]': String(pack.credits),
    });
    const piRes = await fetch(`${STRIPE_API}/payment_intents`, {
      method: 'POST',
      headers: stripeHeaders(key),
      body,
    });
    const pi = await piRes.json().catch(() => ({}));

    if (!piRes.ok) {
      const stripeError = (pi as { error?: { message?: string; payment_intent?: string | { id?: string } } })?.error;
      const message = stripeError?.message || `HTTP ${piRes.status}`;
      const paymentIntent = stripeError?.payment_intent;
      const stripeRef = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;
      await markRechargeFailed(admin, workspaceId, ownerUserId, message, stripeRef);
      return;
    }

    // Grant immediately when the charge already settled so the very next call
    // has credits; the webhook grants too, and the ledger's unique stripe_ref
    // makes the second grant a no-op.
    if ((pi as { status?: string }).status === 'succeeded') {
      await admin.rpc('timewarp_grant_credits', {
        p_workspace_id: workspaceId,
        p_owner_user_id: ownerUserId,
        p_credits: pack.credits,
        p_kind: 'recharge',
        p_stripe_ref: (pi as { id?: string }).id ?? null,
        p_user_id: rechargeUserId,
      });
      console.log(`[credits] auto-recharge succeeded: +${pack.credits} credits.`);
    }
    // Non-terminal statuses (requires_action etc.): the webhook resolves them —
    // succeeded grants, payment_failed records the failure and backs off.
  } catch (error) {
    await markRechargeFailed(admin, workspaceId, ownerUserId, error instanceof Error ? error.message : 'network error');
  }
}
