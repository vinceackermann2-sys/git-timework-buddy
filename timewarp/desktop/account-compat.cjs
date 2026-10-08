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
module.exports = { accountBalance, billingStatus, funding };
