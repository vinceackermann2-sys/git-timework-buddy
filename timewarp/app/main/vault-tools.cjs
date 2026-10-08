"use strict";
// Vault tools for agents the user has given vault access. Agents see item
// names, sites, usernames and card endings, never the secret values: those
// are typed into the built-in browser for them. Cards and secrets need the
// user's permission each time; a sign-in on another site does too.
const { matchesSite } = require("./vault.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });
const ref = { type: "string", description: "Field reference from the latest browser snapshot, for example e12." };
const tab = { type: "string", description: "Optional browser tab id. Defaults to the active tab." };
const item = { type: "string", description: "Vault item id from the list tool." };
const TOOLS = [
  ["list", "List the vault items you may use: sign-ins (site and username), payment cards (brand, last four digits, expiry) and named secrets. Values are never shown.", { site: { type: "string", description: "Optional website to find sign-ins for." } }, []],
  ["fill_sign_in", "Fill a saved sign-in into the page in the built-in browser. Take a snapshot first and pass the username and password field references. The values are typed for you.", { item, username_ref: ref, password_ref: ref, tab }, ["item"]],
  ["fill_card", "Fill a saved payment card into a checkout form in the built-in browser. The user is asked to allow it each time. Pass the references of the fields the form has.", { item, number_ref: ref, expiry_ref: { ...ref, description: "Field for the expiry as MM/YY." }, exp_month_ref: ref, exp_year_ref: ref, cvc_ref: ref, name_ref: ref, tab }, ["item", "number_ref"]],
  ["fill_secret", "Fill a saved secret, such as an API key, into a field in the built-in browser. The user is asked to allow it each time.", { item, ref, tab }, ["item", "ref"]],
  ["save_sign_in", "Save a sign-in you created for the user, for example after signing up for a service, so it can be filled later.", { site: { type: "string" }, username: { type: "string" }, password: { type: "string" }, label: { type: "string" } }, ["site", "password"]],
];

function toolSpecs() {
  return [{
    type: "namespace", name: "timewarp_vault",
    description: "The user's Timewarp vault of saved sign-ins, payment cards and secrets. Use it to sign in or pay in the built-in browser without asking the user to type their details.",
    tools: TOOLS.map(([name, description, properties, required]) => ({ type: "function", name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
  }];
}

const host = url => { try { return new URL(url).hostname; } catch { return "this page"; } };
const describe = entry => entry.kind === "password" ? `${entry.id} | sign-in | ${entry.label} | ${entry.origin} | ${entry.username || "(no username)"}`
  : entry.kind === "card" ? `${entry.id} | card | ${entry.label} | ${entry.brand} ending ${entry.last4} | expires ${String(entry.expMonth).padStart(2, "0")}/${entry.expYear}`
    : `${entry.id} | secret | ${entry.label}`;

function createVaultTools({ vault, browserTools, ask }) {
  const text = value => ({ contentItems: [{ type: "inputText", text: String(value) }], success: true });
  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const name = params.tool, input = params.arguments || {};
      if (!agent?.vaultAccess) throw fail(403, `${agent?.name || "This agent"} doesn't have vault access. The user can turn it on in Customize → Vault.`);
      if (name === "list") {
        let entries = vault.list();
        if (input.site) entries = entries.filter(entry => entry.kind !== "password" || matchesSite(entry.origin, /^https?:/.test(input.site) ? input.site : "https://" + input.site));
        return text(entries.length ? entries.map(describe).join("\n") : "The vault has no matching items.");
      }
      if (name === "save_sign_in") {
        const saved = vault.create({ kind: "password", site: input.site, username: input.username, password: input.password, label: input.label }, { agentId: agent.id });
        return text(`Saved the sign-in for ${saved.origin} as ${saved.id}.`);
      }
      const entry = vault.secret(input.item);
      const page = browserTools.pageUrl(conversationId, input.tab);
      const fill = (fieldRef, value) => fieldRef && value ? browserTools.fillSecret(conversationId, { ref: fieldRef, tab: input.tab, value, agent }) : null;
      if (name === "fill_sign_in") {
        if (entry.kind !== "password") throw fail(400, "That item isn't a sign-in.");
        if (!input.username_ref && !input.password_ref) throw fail(400, "Pass the username or password field reference.");
        if (!matchesSite(entry.origin, page) && !await ask(`${agent.name} wants to use your ${host(entry.origin)} sign-in on ${host(page)}.`, "This site isn't the one the sign-in was saved for. Allow it only if you trust this page."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this sign-in here." }], success: false };
        await fill(input.username_ref, entry.username);
        await fill(input.password_ref, entry.password);
        return text(`Filled the ${host(entry.origin)} sign-in. Submit the form when ready.`);
      }
      if (name === "fill_card") {
        if (entry.kind !== "card") throw fail(400, "That item isn't a payment card.");
        if (!await ask(`${agent.name} wants to fill your ${entry.brand} ending ${entry.last4} on ${host(page)}.`, "Allow it only if you're expecting to pay on this site."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this card." }], success: false };
        const month = String(entry.expMonth).padStart(2, "0"), year = String(entry.expYear);
        await fill(input.number_ref, entry.number);
        await fill(input.expiry_ref, `${month}/${year.slice(-2)}`);
        await fill(input.exp_month_ref, month);
        await fill(input.exp_year_ref, year);
        await fill(input.cvc_ref, entry.cvc);
        await fill(input.name_ref, entry.cardholder);
        return text(`Filled the ${entry.brand} ending ${entry.last4}. Check the form and ask the user before placing an order.`);
      }
      if (name === "fill_secret") {
        if (entry.kind !== "secret") throw fail(400, "That item isn't a secret.");
        if (!await ask(`${agent.name} wants to fill your secret "${entry.label}" on ${host(page)}.`, "Allow it only if this page should receive it."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this secret." }], success: false };
        await fill(input.ref, entry.value);
        return text(`Filled "${entry.label}".`);
      }
      throw fail(404, "Unknown vault tool: " + name);
    },
  };
}

module.exports = { createVaultTools, toolSpecs };
