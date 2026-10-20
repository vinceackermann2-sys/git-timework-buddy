// Machine time is charged like AI usage on the desktop surface: provider cost
// × 2.5, at 0.125 USD per credit. These must equal cloud/nativeBilling.ts
// (a test checks), since the same ledger settles both.
export const AI_COST_MARKUP = 2.5;
export const USD_PER_CREDIT = 0.125;
