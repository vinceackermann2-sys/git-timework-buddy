"use strict";

// The desktop's inherited funding gate and credit display use different wire
// formats. Both are derived from the same real Timewarp account balance.
async function accountBalance(cloud) {
  const response = await cloud("/billing", {});
  const value = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(value?.error?.message || value?.error || "Timewarp credits are temporarily unavailable."), { status: response.status });
  if (!value || !Number.isFinite(value.included) || !Number.isFinite(value.purchased) || value.included < 0 || value.purchased < 0) {
    throw Object.assign(new Error("The cloud returned an invalid credit balance."), { status: 502 });
  }
  return { ...value, total: value.included + value.purchased };
}
function funding(balance) {
  return { canFundUsage: balance.total > 0, timewarpCredits: balance.total };
}
// The billing service's status reports the monthly included-credit allowance
// and period end that the Billing page meters; the sidebar uses the same values.
async function billingStatus(cloud) {
  const response = await cloud("/billing/service", { action: "status" });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw Object.assign(new Error("Plan usage is temporarily unavailable."), { status: response.status || 502 });
  return value;
}
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
module.exports = { accountBalance, billingStatus, funding, usage };
