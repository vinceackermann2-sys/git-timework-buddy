// @ts-nocheck
// A second guard at the cloud boundary complements the device-only vault.
// This detects common structured secrets and payment data, not every possible
// encoding of a secret. Never automatically upload vaults, browser profiles,
// screenshots, arbitrary directories, or device tool output.
const secretKeys = /^(?:pan|card_?number|cvv|cvc|security_?code|pin|password|private_?key|seed_?phrase|recovery_?phrase|access_?token|refresh_?token|authorization|cookie|encrypted_?secret)$/i;
function luhn(digits) {
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let n = Number(digits[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}
function sensitiveText(value) {
  if (typeof value !== "string") return false;
  if (/\b(?:cvv|cvc|security\s*code|pin)\s*[:=]\s*\d{3,6}\b/i.test(value)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|sk_test_|sk-proj-)[a-zA-Z0-9]{12}/.test(value)) return true;
  return (value.match(/(?<![A-Za-z0-9-])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9-])/g) || [])
    .some((candidate) => { const digits = candidate.replace(/\D/g, ""); return digits.length >= 13 && digits.length <= 19 && !/^0+$/.test(digits) && luhn(digits); });
}
function assertCloudSafe(value) {
  const walk = (v, depth = 0) => {
    if (depth > 40) throw Object.assign(new Error("Input is too deeply nested."), { status: 400 });
    if (sensitiveText(v)) throw Object.assign(new Error("Payment details or secrets must stay on this device. Remove them before sending to the cloud."), { status: 400 });
    if (!v || typeof v !== "object") return;
    for (const [key, child] of Object.entries(v)) {
      if (secretKeys.test(key) && child != null && child !== "") throw Object.assign(new Error("Payment details or secrets must stay on this device."), { status: 400 });
      walk(child, depth + 1);
    }
  };
  walk(value);
  return value;
}
export { assertCloudSafe, sensitiveText, luhn };
