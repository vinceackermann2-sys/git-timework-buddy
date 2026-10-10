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
// Card numbers start with an issuer's digits: Visa 4, Mastercard 51–55 and
// 22–27, Amex, Diners and JCB 30 and 34–39, Maestro 50 and 56–59, Discover,
// UnionPay and others 6, UnionPay 81.
const CARD_PREFIX = /^(?:4|5|2[2-7]|3[04-9]|6|81)/;
// How people write one: all digits together, or groups of four with one
// separator (the last group shorter), or Amex and Diners as 4-6-5 or 4-6-4.
function cardShaped(candidate) {
  const separators = new Set(candidate.match(/[ -]/g) || []);
  if (separators.size > 1) return false;
  const groups = candidate.split(/[ -]/).map((group) => group.length);
  if (groups.length === 1) return true;
  const last = groups.at(-1);
  if (groups.slice(0, -1).every((length) => length === 4) && last >= 1 && last <= 4) return true;
  return groups.length === 3 && groups[0] === 4 && groups[1] === 6 && (groups[2] === 5 || groups[2] === 4);
}
function sensitiveText(value) {
  if (typeof value !== "string") return false;
  if (/\b(?:cvv|cvc|security\s*code|pin)\s*[:=]\s*\d{3,6}\b/i.test(value)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|sk_test_|sk-proj-)[a-zA-Z0-9]{12}/.test(value)) return true;
  // Dates, timestamps, phone numbers and ids aren't card numbers even when
  // their digits happen to pass the checksum.
  return (value.match(/(?<![A-Za-z0-9-])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9-])/g) || [])
    .some((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && cardShaped(candidate) && luhn(digits);
    });
}
function assertCloudSafe(value) {
  // `names`: the keys are a JSON schema's property names (a tool's "password"
  // parameter), not values; what's under them is still checked.
  const walk = (v, depth = 0, names = false) => {
    if (depth > 40) throw Object.assign(new Error("Input is too deeply nested."), { status: 400 });
    if (sensitiveText(v)) throw Object.assign(new Error("Payment details or secrets must stay on this device. Remove them before sending to the cloud."), { status: 400 });
    if (!v || typeof v !== "object") return;
    for (const [key, child] of Object.entries(v)) {
      if (!names && secretKeys.test(key) && child != null && child !== "") throw Object.assign(new Error("Payment details or secrets must stay on this device."), { status: 400 });
      walk(child, depth + 1, key === "properties" && v.type === "object");
    }
  };
  walk(value);
  return value;
}
export { assertCloudSafe, sensitiveText, luhn };
