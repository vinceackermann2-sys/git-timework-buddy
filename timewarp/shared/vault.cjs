"use strict";
function sanitizeCard(metadata, secret) {
  if (metadata?.kind !== "credit-card") return secret;
  const card = JSON.parse(secret);
  for (const key of ["cvc", "cvv", "securityCode", "pin"]) delete card[key];
  return JSON.stringify(card);
}
module.exports = { sanitizeCard };
