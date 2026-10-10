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
  ["fill_sign_in", "Fill a saved sign-in into the page in the built-in browser. Take a snapshot first and pass the username and password field references; the password goes only into a password field. The values are typed for you.", { item, username_ref: ref, password_ref: ref, tab }, ["item"]],
  ["fill_card", "Fill a saved payment card into a checkout form in the built-in browser. The user is asked to allow it each time. Pass the references of the fields the form has. Security codes are never stored: ask the user to type it.", { item, number_ref: ref, expiry_ref: { ...ref, description: "Field for the expiry as MM/YY." }, exp_month_ref: ref, exp_year_ref: ref, name_ref: ref, tab }, ["item", "number_ref"]],
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

// A card's details as a field wants them: the matching option of a list, or
// text in the format the field's length and hints ask for (a two-digit year
// where only two characters fit). { option } or { text }, or null when a list
// has no matching option. kind: number, expiry, month, year or name.
const FIELD_NAMES = { number: "card number", expiry: "expiry date", month: "expiry month", year: "expiry year", name: "name on card" };
const digitsOf = value => String(value ?? "").replace(/\D/g, "");
const monthNames = month => {
  const names = [];
  for (const locale of ["en", undefined]) for (const style of ["long", "short"]) {
    try { names.push(new Intl.DateTimeFormat(locale, { month: style }).format(new Date(2000, month - 1, 1)).toLowerCase().replace(/\.$/, "")); } catch {}
  }
  return names;
};
function cardValue(kind, field, card) {
  const mm = String(card.expMonth).padStart(2, "0"), yyyy = String(card.expYear), yy = yyyy.slice(-2);
  if (kind === "number") return { text: card.number };
  if (kind === "name") return { text: card.cardholder };
  if (field?.tag === "select") {
    const options = field.options || [];
    // The number a value or text starts with: "08", "8 - August", "2029".
    const lead = value => { const match = /^\s*(\d{1,4})(?!\d)/.exec(String(value ?? "")); return match ? Number(match[1]) : NaN; };
    const either = test => options.find(option => test(option.value)) || options.find(option => test(option.text));
    let option;
    if (kind === "month") {
      const names = monthNames(card.expMonth);
      option = either(value => lead(value) === card.expMonth) || options.find(option => names.some(name => option.text.toLowerCase().startsWith(name)));
    } else if (kind === "year") option = either(value => lead(value) === card.expYear) || either(value => /^\s*\d{2}\s*$/.test(value) && lead(value) === card.expYear % 100);
    else option = either(value => [mm + yy, mm + yyyy].includes(digitsOf(value)));
    return option ? { option: option.value } : null;
  }
  const hint = `${field?.placeholder || ""} ${field?.label || ""}`.toLowerCase();
  const fourDigits = /yyyy|aaaa|jjjj/.test(hint), twoDigits = !fourDigits && /(^|[^a-z])(yy|aa|jj)([^a-z]|$)/.test(hint);
  const fits = text => !(field?.maxLength > 0) || text.length <= field.maxLength;
  if (kind === "month") return { text: mm };
  if (kind === "year") return { text: twoDigits || !fits(yyyy) ? yy : yyyy };
  if (field?.type === "month") return { text: `${yyyy}-${mm}` };
  const formats = fourDigits ? [`${mm}/${yyyy}`, mm + yyyy, `${mm}/${yy}`, mm + yy] : [`${mm}/${yy}`, mm + yy, `${mm}/${yyyy}`];
  return { text: formats.find(fits) || mm + yy };
}
// Whether a field shows the detail it was given (read back after filling).
function showsCardValue(kind, field, value, card) {
  if (value.option !== undefined) return field.value === value.option;
  const shown = digitsOf(field.value);
  if (kind === "number") return shown === card.number;
  if (kind === "name") return String(field.value).replace(/\s+/g, " ").trim().toLowerCase() === String(card.cardholder).replace(/\s+/g, " ").trim().toLowerCase();
  if (kind === "month") return Number(shown) === card.expMonth;
  if (kind === "year") return Number(shown) === card.expYear || (shown.length === 2 && Number(shown) === card.expYear % 100);
  const mm = String(card.expMonth).padStart(2, "0"), yyyy = String(card.expYear);
  return [mm + yyyy.slice(-2), mm + yyyy, yyyy + mm].includes(shown);
}

const host = url => { try { return new URL(url).hostname || "an embedded page"; } catch { return "this page"; } };
const describe = entry => entry.kind === "password" ? `${entry.id} | sign-in | ${entry.label} | ${entry.origin} | ${entry.username || "(no username)"}`
  : entry.kind === "card" ? `${entry.id} | card | ${entry.label} | ${entry.brand} ending ${entry.last4} | expires ${String(entry.expMonth).padStart(2, "0")}/${entry.expYear}`
    : `${entry.id} | secret | ${entry.label}`;

function createVaultTools({ vault, browserTools, ask }) {
  const text = value => ({ contentItems: [{ type: "inputText", text: String(value) }], success: true });
  return {
    specs: toolSpecs,
    async call(conversationId, params, agent) {
      const name = params.tool, input = params.arguments || {};
      if (!agent?.vaultAccess) throw fail(403, `${agent?.name || "This agent"} doesn't have vault access. The user can turn it on in Settings → Vault.`);
      if (name === "list") {
        // Items that fail their integrity check aren't offered.
        let entries = vault.list().filter(entry => !entry.damaged);
        if (input.site) entries = entries.filter(entry => entry.kind !== "password" || matchesSite(entry.origin, /^https?:/.test(input.site) ? input.site : "https://" + input.site));
        return text(entries.length ? entries.map(describe).join("\n") : "The vault has no matching items.");
      }
      if (name === "save_sign_in") {
        const saved = vault.create({ kind: "password", site: input.site, username: input.username, password: input.password, label: input.label }, { agentId: agent.id });
        return text(`Saved the sign-in for ${saved.origin} as ${saved.id}.`);
      }
      if (typeof input.item !== "string" || !input.item.trim()) throw fail(400, "Pass the id of a vault item from the list tool.");
      const entry = vault.secret(input.item.trim());
      // A worker fills the page in its own tab, where its snapshot came from.
      const tabId = input.tab || browserTools.defaultTab?.(conversationId, params);
      const page = browserTools.pageUrl(conversationId, tabId);
      const fill = (fieldRef, value, field) => fieldRef && value ? browserTools.fillSecret(conversationId, { ref: fieldRef, tab: tabId, value, agent, field }) : null;
      // A field can be in a frame from another site (a payment form, a sign-in box):
      // a sign-in fills only where both the page and the frame are its site, and
      // the user is told which site's frame a card or secret goes to.
      const framesOf = refs => refs.filter(Boolean).map(ref => browserTools.fieldUrl ? browserTools.fieldUrl(conversationId, { ref, tab: tabId }) : page);
      const where = urls => { const others = [...new Set(urls.map(host))].filter(name => name !== host(page)); return host(page) + (others.length ? ` (in a form from ${others.join(", ")})` : ""); };
      if (name === "fill_sign_in") {
        if (entry.kind !== "password") throw fail(400, "That item isn't a sign-in.");
        if (!input.username_ref && !input.password_ref) throw fail(400, "Pass the username or password field reference.");
        const fields = framesOf([input.username_ref, input.password_ref]);
        if (![page, ...fields].every(url => matchesSite(entry.origin, url)) && !await ask(`${agent.name} wants to use your ${host(entry.origin)} sign-in on ${where(fields)}.`, "This site isn't the one the sign-in was saved for. Allow it only if you trust this page."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this sign-in here." }], success: false };
        await fill(input.username_ref, entry.username, "username");
        await fill(input.password_ref, entry.password, "password");
        return text(`Filled the ${host(entry.origin)} sign-in. Submit the form when ready.`);
      }
      if (name === "fill_card") {
        if (entry.kind !== "card") throw fail(400, "That item isn't a payment card.");
        if (!await ask(`${agent.name} wants to fill your ${entry.brand} ending ${entry.last4} on ${where(framesOf([input.number_ref, input.expiry_ref, input.exp_month_ref, input.exp_year_ref, input.name_ref]))}.`, "Allow it only if you're expecting to pay on this site."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this card." }], success: false };
        // Each field gets the details in the form it takes (a list's option, a
        // two- or four-digit year) and is read back: what didn't go in is reported.
        const inspect = ref => browserTools.inspectField ? browserTools.inspectField(conversationId, { ref, tab: tabId }).catch(() => null) : Promise.resolve(null);
        const steps = [["number", input.number_ref], ["expiry", input.expiry_ref], ["month", input.exp_month_ref], ["year", input.exp_year_ref], ["name", input.name_ref]]
          .filter(([kind, ref]) => ref && (kind !== "name" || entry.cardholder));
        const missed = [];
        for (const [kind, ref] of steps) {
          const field = await inspect(ref), value = cardValue(kind, field, entry);
          if (!value) { missed.push(`the ${FIELD_NAMES[kind]} (its list has no matching option)`); continue; }
          // The expiry and name are hidden in their fields too, but aren't
          // looked for elsewhere on the page, where they'd match ordinary text.
          try { await browserTools.fillSecret(conversationId, { ref, tab: tabId, value: value.option ?? value.text, agent, ...(kind === "number" ? {} : { field: "detail" }), ...(value.option !== undefined ? { choose: true } : {}) }); }
          catch (error) { if (error.status !== 400) throw error; missed.push(`the ${FIELD_NAMES[kind]} (${error.message.replace(/\.$/, "")})`); continue; }
          const shown = field ? await inspect(ref) : null;
          if (shown && !showsCardValue(kind, shown, value, entry)) missed.push(`the ${FIELD_NAMES[kind]} (the field doesn't show it as given)`);
        }
        const after = "Ask the user to type the security code themselves, check the form, and ask the user before placing an order.";
        if (missed.length) return { contentItems: [{ type: "inputText", text: `Filled the ${entry.brand} ending ${entry.last4}, except ${missed.join(" and ")}. Set ${missed.length > 1 ? "those" : "that"} yourself (the list tool shows the expiry) or ask the user to. ${after}` }], success: false };
        return text(`Filled the ${entry.brand} ending ${entry.last4}. ${after}`);
      }
      if (name === "fill_secret") {
        if (entry.kind !== "secret") throw fail(400, "That item isn't a secret.");
        if (!await ask(`${agent.name} wants to fill your secret "${entry.label}" on ${where(framesOf([input.ref]))}.`, "Allow it only if this page should receive it."))
          return { contentItems: [{ type: "inputText", text: "The user didn't allow using this secret." }], success: false };
        await fill(input.ref, entry.value);
        return text(`Filled "${entry.label}".`);
      }
      throw fail(404, "Unknown vault tool: " + name);
    },
  };
}

module.exports = { createVaultTools, toolSpecs, cardValue };
