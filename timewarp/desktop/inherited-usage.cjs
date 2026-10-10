"use strict";
// Usage in the wire format of the inherited desktop interface (old pipeline
// only; the Timewarp engine shows credits through the billing screen).
const planNames = { pro: "Pro", max: "Max", ultra: "Ultra" };
function usage(balance, status = null) {
  // Timewarp's existing credit ledger uses USD 0.125 per credit; its AI
  // reservation service uses this same conversion. Paid plans meter their
  // monthly included credits only when the billing service reports them.
  const plans = [];
  const allowance = Number(status?.includedCredits?.allowance), left = Number(status?.includedCredits?.balance);
  if (planNames[balance.plan] && allowance > 0 && Number.isFinite(left)) {
    plans.push({ id: "timewarp-" + balance.plan, type: "energy", name: planNames[balance.plan], status: "available",
      limits: [{ id: "monthly", label: "Monthly credits", remainingPercent: Math.min(100, Math.max(0, left / allowance * 100)), resetsAt: typeof status.currentPeriodEnd === "string" ? status.currentPeriodEnd : null }] });
  }
  return { available: balance.total > 0, plans, credits: { availableMicroUsd: Math.floor(balance.total * 125000) } };
}
module.exports = { usage };
