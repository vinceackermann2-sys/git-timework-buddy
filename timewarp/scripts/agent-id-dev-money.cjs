"use strict";
// Simulated money providers for the local dev API (agent-id-dev.cjs): Privy
// wallets holding USDC on Base, and Bridge (verification of people and
// businesses, bank accounts, deposit details, SEPA pay-ins, payouts), all in
// memory. Nothing leaves this process. Bridge's verification page is
// /dev/bridge-kyc on the dev API: opening it approves the owner, as finishing
// Bridge's real page would. A SEPA pay-in arrives 20 seconds after it opens.
const crypto = require("node:crypto");

function simulatedMoney({ apiUrl }) {
  const wallets = new Map(), kyc = new Map(), payouts = new Map();
  let next = 0;
  const id = prefix => `${prefix}_dev${++next}`;
  const address = () => "0x" + crypto.randomBytes(20).toString("hex");
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function privy(method, path, body) {
    let m;
    if (method === "POST" && path === "/v1/wallets") {
      const wallet = { id: id("w"), address: address(), usdc: 0, received: [] };
      wallets.set(wallet.id, wallet);
      return reply({ id: wallet.id, address: wallet.address, chain_type: "ethereum" });
    }
    if ((m = /^\/v1\/wallets\/([^/]+)\/balance/.exec(path))) {
      const wallet = wallets.get(m[1]);
      return reply({ balances: [{ chain: "base", asset: "usdc", raw_value: String((wallet?.usdc || 0) * 10_000), raw_value_decimals: 6 }] });
    }
    if ((m = /^\/v1\/wallets\/([^/]+)\/transactions/.exec(path))) return reply({ transactions: wallets.get(m[1])?.received || [] });
    if (method === "POST" && (m = /^\/v1\/wallets\/([^/]+)\/transfer$/.exec(path))) {
      const wallet = wallets.get(m[1]);
      const cents = Math.round(Number(body.amount) * 100);
      if (!wallet || wallet.usdc < cents) return reply({ message: "Not enough USDC." }, 400);
      wallet.usdc -= cents;
      return reply({ id: id("act"), status: "pending" });
    }
    if ((m = /^\/v1\/wallets\/[^/]+\/actions\/([^/?]+)/.exec(path))) return reply({ id: m[1], status: "succeeded", steps: [{ transaction_hash: "0x" + crypto.randomBytes(32).toString("hex") }] });
    return null;
  }

  // Money arriving at a wallet: its balance, and a received transfer in its history.
  function fund(walletAddress, cents) {
    for (const wallet of wallets.values()) {
      if (wallet.address !== walletAddress) continue;
      wallet.usdc += cents;
      wallet.received.unshift({
        transaction_hash: "0x" + crypto.randomBytes(32).toString("hex"), status: "confirmed", created_at: Date.now(),
        details: { type: "transfer_received", sender: "0x" + "d3".repeat(20), asset: "usdc", raw_value: String(cents * 10_000), raw_value_decimals: 6 },
      });
    }
  }

  function bridge(method, path, body) {
    let m;
    if (method === "POST" && path === "/v0/kyc_links") {
      const link = { id: id("kyc"), customer_id: id("cus"), full_name: body.full_name, email: body.email, kyc_status: "not_started", tos_status: "pending" };
      link.kyc_link = `${apiUrl}/dev/bridge-kyc?id=${link.id}`;
      link.tos_link = link.kyc_link;
      kyc.set(link.id, link);
      return reply(link);
    }
    if ((m = /^\/v0\/kyc_links\/([^/]+)$/.exec(path))) return kyc.has(m[1]) ? reply(kyc.get(m[1])) : reply({ message: "Not found" }, 404);
    if ((m = /^\/v0\/customers\/([^/]+)$/.exec(path))) return reply({ id: m[1], status: "active", first_name: "Dev", last_name: "Person", residential_address: { country: "SWE" }, endorsements: [{ name: "base", status: "approved" }, { name: "sepa", status: "approved" }] });
    if (method === "POST" && /^\/v0\/customers\/[^/]+\/external_accounts$/.test(path)) {
      const number = body.iban?.account_number || body.account?.account_number || "0000";
      return reply({ id: id("ea"), last_4: number.slice(-4), bank_name: body.iban ? "Demo Bank (SEPA)" : "Demo Bank (ACH)", active: true });
    }
    if (method === "DELETE" && /^\/v0\/customers\/[^/]+\/external_accounts\//.test(path)) return reply({});
    if (method === "POST" && /^\/v0\/customers\/[^/]+\/virtual_accounts$/.test(path)) {
      const instructions = body.source.currency === "eur"
        ? { currency: "eur", payment_rails: ["sepa"], iban: "DE89370400440532013000", bic: "COBADEFFXXX", account_holder_name: "Bridge Building Sp. z.o.o. (demo)", bank_name: "Demo Bank", bank_address: "Demo Street 1, Berlin" }
        : { currency: "usd", payment_rails: ["ach_push", "wire"], bank_beneficiary_name: "Bridge Ventures Inc. (demo)", bank_name: "Demo Bank", bank_address: "1 Demo Ave, New York", bank_account_number: "900123456789", bank_routing_number: "101019644" };
      return reply({ id: id("va"), status: "activated", source_deposit_instructions: instructions });
    }
    if (method === "POST" && path === "/v0/transfers" && body.source?.payment_rail === "sepa") {
      // A pay-in: euros by SEPA, converted and sent to the wallet as USDC.
      const payin = { id: id("tr"), state: "awaiting_funds", at: Date.now(), amount: Number(body.amount), to: body.destination?.to_address };
      payouts.set(payin.id, payin);
      return reply({
        id: payin.id, state: payin.state,
        source_deposit_instructions: {
          payment_rail: "sepa", currency: "eur", amount: body.amount, deposit_message: `BRGDEV${String(next).padStart(6, "0")}`,
          iban: "DE89370400440532013000", bic: "COBADEFFXXX", account_holder_name: "Bridge Building Sp. z o.o. (demo)", bank_name: "Demo Bank", bank_address: "Demo Street 1, 10115 Berlin, DE",
        },
      });
    }
    if (method === "POST" && path === "/v0/transfers") {
      const payout = { id: id("tr"), state: "awaiting_funds", at: Date.now() };
      payouts.set(payout.id, payout);
      return reply({ id: payout.id, state: payout.state, source_deposit_instructions: { payment_rail: "base", currency: "usdc", amount: body.amount, to_address: "0x" + "b7".repeat(20) } });
    }
    if ((m = /^\/v0\/transfers\/([^/]+)$/.exec(path))) {
      const payout = payouts.get(m[1]);
      if (!payout) return reply({ message: "Not found" }, 404);
      if (method === "DELETE") payout.state = "canceled";
      // A pay-in's euros arrive after 20 seconds, as USDC at about 1.08 dollars each.
      else if (payout.to) {
        if (payout.state === "awaiting_funds" && Date.now() - payout.at > 20_000) {
          payout.state = "payment_processed";
          fund(payout.to, Math.round(payout.amount * 108));
        }
      }
      // A payout reaches the bank half a minute later.
      else if (payout.state === "awaiting_funds") payout.state = Date.now() - payout.at > 30_000 ? "payment_processed" : "payment_submitted";
      return reply({ id: payout.id, state: payout.state });
    }
    return null;
  }

  return {
    async fetch(url, init = {}) {
      const target = new URL(String(url)), method = init.method || "GET";
      const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
      const response = target.hostname === "api.privy.io" ? privy(method, target.pathname + target.search, body)
        : /bridge\.xyz$/.test(target.hostname) ? bridge(method, target.pathname, body) : null;
      if (response) return response;
      throw new Error(`No network in the dev API: ${method} ${url}`);
    },
    // The dev API's stand-in for Bridge's hosted verification page.
    kycPage(search) {
      const link = kyc.get(new URLSearchParams(search).get("id") || "");
      if (link) Object.assign(link, { kyc_status: "approved", tos_status: "approved" });
      return `<!doctype html><meta charset="utf-8"><title>Bridge (simulated)</title><body style="font:16px system-ui;margin:4rem auto;max-width:28rem;text-align:center"><h1>Verified with Bridge</h1><p>${link ? "This is the dev API's stand-in for Bridge. You're approved; close this tab." : "Unknown link."}</p></body>`;
    },
    fund,
  };
}

module.exports = { simulatedMoney };
