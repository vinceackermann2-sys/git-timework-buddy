/// <reference path="../_types/deno-shims.d.ts" />
// Credit packs + conversion math.
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
// USD_PER_CREDIT is the historical $0.125 unit. The desktop surface redeems
// credits at 2.5x provider cost instead (cloud/nativeBilling.ts and the energy
// settlement SQL), so there one credit covers $0.05 of provider cost.
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
// One-time packs give 12 credits per dollar at every size: a little below the
// plans' 14, because purchased credits never expire. At $0.05 of provider cost
// per credit, a fully used pack spends 60% of its price, which still leaves a
// margin after 25% VAT and card fees. Each pack's Stripe product and price are
// created on its first checkout and found again by lookup key
// (creditPackPrice in _shared/timewarpPricing.ts).
export interface CreditPack {
  credits: number;
  priceUsd: number;
  priceCents: number;
}

export const PACK_CREDITS_PER_USD = 12;
const PACK_PRICES_USD = [15, 30, 45, 60, 75, 100, 125];

export const CREDIT_PACKS: CreditPack[] = PACK_PRICES_USD.map((priceUsd) => ({
  credits: priceUsd * PACK_CREDITS_PER_USD,
  priceUsd,
  priceCents: priceUsd * 100,
}));

export const getCreditPack = (credits: unknown): CreditPack | null => {
  const size = Number(credits);
  return CREDIT_PACKS.find((pack) => pack.credits === size) ?? null;
};
