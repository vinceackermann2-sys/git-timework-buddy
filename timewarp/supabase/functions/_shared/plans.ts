/// <reference path="../_types/deno-shims.d.ts" />
// Canonical plan + AI budget definitions for every edge function.
//
// This file is the authority for what a user is allowed to spend. The desktop
// client keeps its own copy of the *marketing* copy in src/lib/plans.ts (names,
// prices, feature bullets), but it never decides limits — it reads live usage
// and budgets from billing-status, and ai-proxy enforces them here. Keeping the
// gate server-side matters: the app's local usage ledger is a plain JSON file in
// the user's data directory, so anything enforced only on the client can be
// reset by deleting a file.

export type PlanId = 'free' | 'pro' | 'max' | 'ultra';

export const PLAN_IDS: readonly PlanId[] = ['free', 'pro', 'max', 'ultra'];

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);

// A plan belongs to a workspace and its allowance is pooled across that
// workspace's members. "Personal" is a workspace too — a solo one, and the
// default on signup — carried as workspaceId === null.
//
// Roles allowed to buy or change a workspace's plan. A 'lead' can spend the
// workspace's allowance but cannot commit it to a bill.
export const BILLING_ROLES = new Set(['owner', 'admin']);

export const canManageBilling = (role: unknown): boolean =>
  typeof role === 'string' && BILLING_ROLES.has(role);

// Every plan unlocks the whole app. Usage volume is the only differentiator and
// is customer-facing only as credits. Provider cost remains an internal input
// to the canonical credit conversion in _shared/credits.ts.
//
// Monthly budgets are set from unit economics, not from a headline multiplier:
// Prices include 25% VAT. The included-credit allowances below are customer
// facing; provider cost is calculated from the canonical credit conversion.
//
// Every paid plan gives the same 14 credits per dollar, so one credit redeems
// $0.05 of provider cost and a fully used plan spends 70% of its price. That
// still leaves a margin after 25% VAT and card fees. Pro is no longer sold;
// existing Pro subscribers keep it at the same rate until they switch.
export const PLAN_CREDITS_PER_USD = 14;
const MONTHLY_BUDGET_CREDITS: Record<PlanId, number> = {
  free: 0,
  pro: 20 * PLAN_CREDITS_PER_USD,
  max: 50 * PLAN_CREDITS_PER_USD,
  ultra: 100 * PLAN_CREDITS_PER_USD,
};

/** Plans a customer can newly choose. Retired plans keep working for their
 *  existing subscribers but cannot be checked out again. */
export const OFFERED_PLAN_IDS: readonly PlanId[] = ['free', 'max', 'ultra'];

export const isOfferedPlan = (value: unknown): value is PlanId =>
  typeof value === 'string' && (OFFERED_PLAN_IDS as readonly string[]).includes(value);

export interface PlanBudget {
  id: PlanId;
  /** Included credits; refilled on the subscriber's billing anniversary. */
  monthlyCredits: number;
  /** Compute-only Cloud Credits; Free receives these instead of usage credits. */
  monthlyCloudCredits: number;
  /** Usage relative to Free, for display only. Free is 1x by definition. */
  multiplier: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const buildBudget = (id: PlanId): PlanBudget => {
  const monthlyCredits = MONTHLY_BUDGET_CREDITS[id];
  return {
    id,
    monthlyCredits,
    monthlyCloudCredits: id === 'free' ? 10 : 0,
    // Paid multipliers retain the historical $2 unit used by pricing copy.
    multiplier: id === 'free' ? 1 : round2(monthlyCredits / 21.28),
  };
};

export const PLAN_BUDGETS: Record<PlanId, PlanBudget> = {
  free: buildBudget('free'),
  pro: buildBudget('pro'),
  max: buildBudget('max'),
  ultra: buildBudget('ultra'),
};

export const getPlanBudget = (plan: unknown): PlanBudget =>
  PLAN_BUDGETS[isPlanId(plan) ? plan : 'free'];

// --- Stripe wiring ---------------------------------------------------------
// Price IDs live in env so test-mode and live-mode deploys can differ. The
// defaults are the live Pro and Ultra prices. Max must be configured with the
// new $50 Stripe price through STRIPE_PRICE_MAX before deployment.
//
// Free has no Stripe price: users default to it, so there is nothing to check
// out. Cancelling any paid plan simply falls back to free.
export const getPlanPriceId = (plan: PlanId): string => {
  switch (plan) {
    case 'pro':
      return Deno.env.get('STRIPE_PRICE_PRO') || 'price_1Tu8WtGKbzbe9CQL9E4vyVSx';
    case 'max':
      return Deno.env.get('STRIPE_PRICE_MAX') || '';
    case 'ultra':
      return Deno.env.get('STRIPE_PRICE_ULTRA') || 'price_1Tu8ciGKbzbe9CQLcY5zU98r';
    default:
      return '';
  }
};

// Products on the TimeWarpDev account. Stripe recommends resolving entitlement
// from the product rather than the price, because a product survives repricing
// while a price id does not — if Pro ever gets a new price, this mapping still
// holds and only getPlanPriceId above needs touching.
export const getPlanProductId = (plan: PlanId): string => {
  switch (plan) {
    case 'pro':
      return Deno.env.get('STRIPE_PRODUCT_PRO') || 'prod_UtwPsJHr72L1Gb';
    case 'max':
      return Deno.env.get('STRIPE_PRODUCT_MAX') || '';
    case 'ultra':
      return Deno.env.get('STRIPE_PRODUCT_ULTRA') || 'prod_UtwVbQkn7Mow3U';
    default:
      return '';
  }
};

/** Reverse lookups used by the webhook when a subscription carries no plan
 *  metadata (e.g. one created straight from the Stripe dashboard). */
export const planFromPriceId = (priceId: string): PlanId | null => {
  if (!priceId) return null;
  for (const plan of PLAN_IDS) {
    if (plan !== 'free' && getPlanPriceId(plan) === priceId) return plan;
  }
  return null;
};

export const planFromProductId = (productId: string): PlanId | null => {
  if (!productId) return null;
  for (const plan of PLAN_IDS) {
    if (plan !== 'free' && getPlanProductId(plan) === productId) return plan;
  }
  return null;
};

/** Stripe subscription statuses that should still grant the paid plan. Anything
 *  else (canceled, unpaid, incomplete_expired, paused) falls back to free. */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export const isEntitledStatus = (status: unknown): boolean =>
  typeof status === 'string' && ENTITLED_STATUSES.has(status);

// Credit packs and the cost→credit conversion live in _shared/credits.ts.
