"use strict";
// Makes the two secrets Agent ID needs before its first deploy:
//   AGENT_ID_SIGNING_KEY     the P-256 private key passports are signed with
//   AGENT_ID_WEBHOOK_SECRET  signs phone webhook URLs and pairwise owner refs
// Prints them as `supabase secrets set` arguments. Nothing is written to disk.
//
// To rotate the signing key later: move the current key's public half
// (`--public-of '<private JWK>'`) into AGENT_ID_PREVIOUS_PUBLIC_KEYS (a JSON
// array), set the new private key, and drop the old one once every passport
// it signed has expired (5 minutes by default).
const crypto = require("node:crypto");

(async () => {
  const at = process.argv.indexOf("--public-of");
  if (at > 0) {
    const { kty, crv, x, y, kid } = JSON.parse(process.argv[at + 1]);
    console.log(JSON.stringify({ kty, crv, x, y, kid }));
    return;
  }
  const pair = await crypto.webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = `agent-id-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
  const signing = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, kid });
  const webhook = crypto.randomBytes(32).toString("base64url");
  // --write <path>: append both to a file for `supabase secrets set
  // --env-file`, without printing them.
  const envAt = process.argv.indexOf("--write");
  if (envAt > 0) {
    require("node:fs").appendFileSync(process.argv[envAt + 1], `AGENT_ID_SIGNING_KEY='${signing}'\nAGENT_ID_WEBHOOK_SECRET=${webhook}\n`, { mode: 0o600 });
    console.log(`Wrote the passport signing key (${kid}) and the webhook secret.`);
    return;
  }
  console.log("Keep these private. Set them with the Supabase CLI:");
  console.log(`  supabase secrets set --project-ref <ref> AGENT_ID_SIGNING_KEY='${signing}' AGENT_ID_WEBHOOK_SECRET='${webhook}'`);
})().catch(error => { console.error(error); process.exit(1); });
