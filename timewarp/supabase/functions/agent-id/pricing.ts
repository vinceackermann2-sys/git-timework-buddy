// Machine time is charged like AI usage on the desktop surface: provider cost
// × 2.5, at 0.125 USD per credit. These must equal cloud/nativeBilling.ts
// (a test checks), since the same ledger settles both.
export const AI_COST_MARKUP = 2.5;
export const USD_PER_CREDIT = 0.125;

// What a machine costs Timewarp: Sweden Central retail rates (2026-08-23),
// overridable by secrets (providers/vm.ts).
export const VCPU_USD_PER_SECOND = 0.000024, MEMORY_GIB_USD_PER_SECOND = 0.000003;

// Agent ID has no subscription: mail and wallets are free, every account gets
// free machine hours, and what's beyond is paid in Timewarp credits. Credits
// come in the same packs as in the Timewarp app (_shared/credits.ts, 12 per
// dollar; a test checks they match), sold through the same Stripe prices, and
// the Stripe webhook adds them once paid.
export const FREE_COMPUTE_HOURS = 5;
export const PACK_CREDITS_PER_USD = 12;
export const CREDIT_PACKS = [15, 30, 45, 60, 75, 100, 125].map(priceUsd => ({ credits: priceUsd * PACK_CREDITS_PER_USD, priceUsd, priceCents: priceUsd * 100 }));
