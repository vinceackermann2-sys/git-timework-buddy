"use strict";
// What always waits for the user's OK on a card in the chat, whatever the
// model decided and even when the user asked for it: sending (email,
// messages, posts, invitations, texts, calls), paying (transfers, payments,
// handing over a card's number) and deleting. It covers the user's connected
// apps (Composio), the agent's own Agent ID and Timewarp's own tools.
// Timewarp writes each card from the call's own arguments, so what the user
// allows is exactly what runs; an agent's words only appear as its reason.
// The card is answered in Approval.jsx (harness.confirm, "timewarp/confirm").

// Words in a connected app's action name (GMAIL_SEND_EMAIL) for each kind.
const SEND = new Set(["SEND", "SENDS", "REPLY", "FORWARD", "POST", "PUBLISH", "TWEET", "RETWEET", "INVITE", "BROADCAST", "SHARE", "SHARING", "CALL", "DIAL"]);
const PAY = new Set(["PAY", "PAYMENT", "PAYMENTS", "CHARGE", "REFUND", "TRANSFER", "PAYOUT", "PURCHASE", "BUY", "CHECKOUT", "FUND", "FUNDS", "DEPOSIT", "WITHDRAW", "WITHDRAWAL", "TOPUP"]);
const DELETE = new Set(["DELETE", "TRASH", "DESTROY", "PURGE", "ERASE", "REVOKE", "UNSUBSCRIBE"]);
// Reading actions are never asked about, even when their name has such a word
// (TWITTER_POST_LOOKUP, GMAIL_LIST_DRAFTS…). Making a draft has none of them.
const READ = new Set(["GET", "LIST", "SEARCH", "FETCH", "FIND", "READ", "RETRIEVE", "LOOKUP", "COUNT", "DESCRIBE", "PREVIEW"]);
// Placing an order, cancelling something paid for, removing someone or
// something (but not a label or a reaction), and creating a message, a
// comment or a post (but not a draft).
const ORDERING = ["PLACE", "SUBMIT", "CREATE"], PAID = ["SUBSCRIPTION", "ORDER", "MEMBERSHIP", "PLAN", "ACCOUNT", "BOOKING", "RESERVATION"];
const ORGANIZING = ["LABEL", "LABELS", "TAG", "TAGS", "REACTION", "STAR", "FLAG", "FOLDER"];
const MESSAGES = ["MESSAGE", "MESSAGES", "SMS", "EMAIL", "MAIL", "COMMENT", "TWEET", "CALL"], MAKING = ["CREATE", "NEW", "ADD", "MAKE"];

// Names people know for an app's id in action names.
const APPS = {
  GMAIL: "Gmail", GOOGLECALENDAR: "Google Calendar", GOOGLEDRIVE: "Google Drive", GOOGLEDOCS: "Google Docs", GOOGLESHEETS: "Google Sheets",
  OUTLOOK: "Outlook", SLACK: "Slack", NOTION: "Notion", GITHUB: "GitHub", LINKEDIN: "LinkedIn", TWITTER: "X", DISCORD: "Discord",
  WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", MICROSOFT_TEAMS: "Microsoft Teams", HUBSPOT: "HubSpot", STRIPE: "Stripe", SHOPIFY: "Shopify",
  TWILIO: "Twilio", SENDGRID: "SendGrid", MAILCHIMP: "Mailchimp", DROPBOX: "Dropbox", TRELLO: "Trello", ASANA: "Asana", JIRA: "Jira", LINEAR: "Linear",
};
const titleCase = value => String(value).toLowerCase().replace(/(^|[\s_])([a-z])/g, (_, gap, letter) => (gap ? " " : "") + letter.toUpperCase());
function appOf(slug) {
  const name = String(slug || "");
  const known = Object.keys(APPS).filter(id => name.startsWith(id + "_")).sort((a, b) => b.length - a.length)[0];
  return known ? { app: APPS[known], action: name.slice(known.length + 1) } : { app: titleCase(name.split("_")[0] || "App"), action: name.split("_").slice(1).join("_") };
}

// The kind of a connected app's action: "send", "pay", "delete" or null.
// A calendar event with guests sends them invitations.
function composioKind(slug, args = {}) {
  const words = String(slug || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const has = list => list.some(word => words.includes(word));
  if (words.some(word => READ.has(word))) return null;
  if (words.some(word => PAY.has(word)) || (words.includes("ORDER") && has(ORDERING))) return "pay";
  if (words.some(word => DELETE.has(word)) || (words.includes("REMOVE") && !has(ORGANIZING)) || (words.includes("CANCEL") && has(PAID))) return "delete";
  if (words.some(word => SEND.has(word))) return "send";
  if (words.includes("DRAFT") || words.includes("DRAFTS") || has(ORGANIZING)) return null;
  if (has(MAKING) && has(MESSAGES)) return "send";
  if (words.includes("EVENT") && ["CREATE", "UPDATE", "PATCH"].some(word => words.includes(word)) && listOf(args.attendees).length) return "send";
  return null;
}

// The agent's own Agent ID actions (agent-id-tools.cjs), by kind. "use": a
// key from its vault, asked once per key and site in a chat.
const AGENT_ID = {
  mail_send: "send", sms_send: "send", call_place: "send",
  wallet_send: "pay", card_reveal: "pay",
  mail_trash: "delete", contact_delete: "delete", signing_key_remove: "delete",
  vault_request: "use",
};
const agentIdKind = (action, args = {}) => action === "connector_run" ? composioKind(args.tool, args.arguments || {}) : AGENT_ID[action] || null;

// A button or link in a web page whose click sends, pays or deletes, by the
// start of its label; a long label is content (a headline), not an action.
const PAGE_ACTIONS = [
  ["pay", /^(buy( it)?( now)?|pay( now|\s+\S+)?|purchase|place( your)? order|complete( your)? (purchase|order|payment|booking)|confirm( and pay| (your )?(order|purchase|payment|booking))|submit (order|payment)|order now|book now|reserve and pay|subscribe and pay|start (subscription|membership)|donate( now)?|add (funds|money)|top up|send money|transfer( money)?|withdraw)\b/],
  ["delete", /^(delete|permanently delete|empty (trash|bin)|close (my )?account|cancel (subscription|membership|plan|order|booking|reservation))\b/],
  ["send", /^(send|post|publish|tweet|reply all|send reply|share now|call|call now|start call|dial|invite)\b/],
];
function pageActionKind(role, name) {
  if (!["button", "link", "menuitem"].includes(role)) return null;
  const label = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!label || label.length > 40) return null;
  return PAGE_ACTIONS.find(([, pattern]) => pattern.test(label))?.[0] || null;
}
// Enter in a page's field: what its form's own submit button says, or, in a
// box for a message, a reply, a comment or a post with text in it, sending.
// Never a search box.
function enterKind({ role = "", label = "", text = "", submit = "" } = {}) {
  if (submit) return pageActionKind("button", submit);
  if (!String(text).trim() || /search/i.test(`${role} ${label}`)) return null;
  return /\b(message|reply|comment|chat|tweet|post|what'?s happening|write|compose|say something|send)\b/i.test(label) ? "send" : null;
}
// The card for a click or Enter in the built-in browser: the page's site and
// title, the button, the message, and what the page shows now.
function pageCard({ kind, label = "", host = "", title = "", text = "", image = null, agent = null }) {
  const message = kind === "send" && !!String(text).trim();
  return {
    kind, agent: agent || "Your agent", app: host || "A web page", account: null,
    title: message ? "Send this message?" : `Click “${clip(label, 40)}”?`,
    lines: [title ? { label: "Page", value: clip(title, 200) } : null, label && !message ? { label: "Button", value: clip(label, 60) } : null].filter(Boolean),
    body: message ? clip(text, 4000) : null, image: /^data:image\/(?:jpeg|png);base64,/.test(String(image || "")) ? image : null,
    action: message ? "Send" : clip(label, 28) || PRIMARY[kind], reason: null,
  };
}

// Whether Codex's question before an MCP tool runs (approvals set to ask) is
// about a call Timewarp asks the user about itself, with its own card: a
// connected app's or Agent ID action that sends, pays or deletes.
function asksItself(params = {}) {
  const meta = params._meta || {};
  if (meta.codex_approval_kind !== "mcp_tool_call") return false;
  const tool = /run tool "([^"]+)"/.exec(String(params.message || ""))?.[1];
  const args = meta.tool_params && typeof meta.tool_params === "object" ? meta.tool_params : {};
  if (params.serverName === "timewarp_composio" && tool === "composio_execute") return !!composioKind(args.toolSlug, args.arguments || {});
  if (params.serverName === "timewarp_agent_id" && tool === "agent_id") return !!agentIdKind(String(args.action || ""), args.arguments || {});
  return false;
}

// ---- What the card shows ----------------------------------------------------

const clip = (value, max) => { const text = String(value ?? "").trim(); return text.length > max ? text.slice(0, max - 1) + "…" : text; };
function listOf(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(listOf);
  if (typeof value === "object") return [value.email || value.address || value.name || value.id].filter(Boolean).map(String);
  return String(value).split(/\s*[,;]\s*/).filter(Boolean);
}
// A value as people read it: yes or no, and a date and time in the computer's own format.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const shown = value => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && DATE_TIME.test(value.trim()) && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return typeof value === "string" || typeof value === "number" ? clip(value, 300) : null;
};
// "message_body" → "Message body".
const labelOf = key => { const words = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase(); return words ? words[0].toUpperCase() + words.slice(1) : String(key); };
const plain = (text, html) => html || /<\/?(?:p|div|br|span|b|i|a|ul|li|table)\b/i.test(text) ? String(text).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n") : String(text);

const TO = /^(to|to_?emails?|to_?recipients?|recipients?|recipient_?emails?|extra_recipients|send_?to|attendees|channel|channel_?(?:id|name)|chat_?id|phone|phone_?number|number|email)$/i;
const CC = /^cc(?:_?emails?)?$/i, BCC = /^bcc(?:_?emails?)?$/i;
const SUBJECT = /^(subject|title|summary|name)$/i;
const BODY = /^(body|message_body|html_body|text|message|content|markdown|comment|status|caption|post|say|note|description)$/i;
// Arguments that only steer the action, never worth a line.
const QUIET = /^(user_?id|is_?html|format|mime_?type|assistant_?id|connected_?account_?id|thread_?ts|attachment|attachments|parse|link_names|unfurl_.*|as_user|model)$/i;

// The lines and text a card shows for an action's arguments: who it goes to,
// its subject, its text, then the other plain values (at most a few).
function previewOf(args = {}) {
  const lines = [], used = new Set();
  const take = (label, pattern, list = false) => {
    const keys = Object.keys(args).filter(key => !used.has(key) && pattern.test(key));
    const values = keys.flatMap(key => list ? listOf(args[key]) : [shown(args[key])].filter(Boolean));
    keys.forEach(key => used.add(key));
    if (values.length) lines.push({ label, value: clip(values.join(", "), 600) });
  };
  take("To", TO, true); take("Cc", CC, true); take("Bcc", BCC, true);
  const subject = Object.keys(args).find(key => SUBJECT.test(key) && shown(args[key]));
  if (subject) { lines.push({ label: labelOf(subject), value: shown(args[subject]) }); used.add(subject); }
  const bodyKey = Object.keys(args).find(key => !used.has(key) && BODY.test(key) && typeof args[key] === "string" && args[key].trim());
  if (bodyKey) used.add(bodyKey);
  const rest = Object.keys(args).filter(key => !used.has(key) && !QUIET.test(key) && shown(args[key]) !== null && shown(args[key]) !== "").slice(0, 6);
  for (const key of rest) lines.push({ label: labelOf(key), value: shown(args[key]) });
  return { lines, body: bodyKey ? clip(plain(args[bodyKey], args.is_html === true), 4000) : null };
}

const PRIMARY = { send: "Send", pay: "Pay", delete: "Delete" };
const reasonOf = value => clip(String(value || "").replace(/\s+/g, " "), 300) || null;
function titleFor(kind, action, { amount = null } = {}) {
  const words = titleCase(String(action || "").replace(/_/g, " ")).toLowerCase();
  if (kind === "pay") return amount ? `Pay ${amount}?` : `${words[0]?.toUpperCase() || "P"}${words.slice(1) || "ay"}?`;
  if (/\b(email|mail)\b/.test(words) && kind === "send") return /\breply\b/.test(words) ? "Send this reply?" : /\bforward\b/.test(words) ? "Forward this email?" : "Send this email?";
  if (kind === "send" && /\bpost\b|\bpublish\b|\btweet\b/.test(words)) return "Post this?";
  if (kind === "send" && /\binvite\b|\bevent\b/.test(words)) return "Send these invitations?";
  if (kind === "send" && /\bshar(e|ing)\b/.test(words)) return "Share this?";
  if (kind === "send") return "Send this message?";
  return words ? `${words[0].toUpperCase()}${words.slice(1)}?` : "Delete this?";
}

// A card for a connected app's action. account: how the user knows the
// account it acts as (its email), when Timewarp knows it.
function composioCard({ slug, args = {}, kind, agent = null, account = null, reason = null }) {
  const { app, action } = appOf(slug);
  const { lines, body } = previewOf(args);
  return {
    kind, title: titleFor(kind, action), agent: agent || "Your agent", app, account: account || null,
    lines, body, action: kind === "send" && /\bpost\b|\bpublish\b|\btweet\b/i.test(action.replace(/_/g, " ")) ? "Post" : PRIMARY[kind], reason: reasonOf(reason),
  };
}

// "12.5" US dollars → "$12.50"; null when it isn't an amount.
const dollars = value => { const amount = Number(String(value ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : null; };

// A card for one of the agent's own Agent ID actions. extra: what Timewarp
// looked up for it (the wallet's balance, the email it moves to the bin).
function agentIdCard({ action, args = {}, kind, agent = null, extra = {} }) {
  const who = agent || "Your agent";
  if (action === "connector_run") return composioCard({ slug: args.tool, args: args.arguments || {}, kind, agent, reason: args.reason });
  const base = { kind, agent: who, app: "Agent ID", account: extra.account || null, reason: reasonOf(args.reason) };
  switch (action) {
    case "mail_send": {
      const { lines, body } = previewOf({ to: args.to, cc: args.cc, bcc: args.bcc, subject: args.subject, body: args.text ?? args.body, ...(args.reply_to ? { in_reply_to: extra.replyingTo || args.reply_to } : {}) });
      return { ...base, title: args.reply_to ? "Send this reply?" : "Send this email?", lines, body, action: "Send" };
    }
    case "sms_send": return { ...base, title: "Send this text?", lines: [{ label: "To", value: clip(args.to, 60) }], body: clip(args.text, 2000), action: "Send" };
    case "call_place": return { ...base, title: "Make this call?", lines: [{ label: "To", value: clip(args.to, 60) }], body: clip(args.say, 2000), action: "Call" };
    case "wallet_send": {
      const amount = dollars(args.amount);
      return {
        ...base, title: amount ? `Send ${amount}?` : "Send money?", amount,
        lines: [{ label: "To", value: clip(args.to, 120) }, ...(args.memo ? [{ label: "For", value: clip(args.memo, 200) }] : []), ...(extra.balance ? [{ label: "Balance", value: extra.balance }] : [])],
        body: null, action: amount ? `Send ${amount}` : "Send",
      };
    }
    case "card_reveal": return { ...base, title: "Let your agent use the card?", lines: [], body: "It gets the card's number, expiry and security code to pay at a checkout. Each use is recorded.", action: "Allow" };
    case "mail_trash": return { ...base, title: "Move this email to the bin?", lines: extra.mail ? [{ label: "From", value: clip(extra.mail.from, 200) }, { label: "Subject", value: clip(extra.mail.subject, 300) }].filter(line => line.value) : [{ label: "Email", value: clip(args.id, 80) }], body: null, action: "Move to bin" };
    case "contact_delete": return { ...base, title: "Delete this contact?", lines: [{ label: extra.contact ? "Contact" : "Id", value: clip(extra.contact || args.id, 200) }], body: null, action: "Delete" };
    case "signing_key_remove": return { ...base, title: "Remove this signing key?", lines: [{ label: "Key", value: clip(args.id, 80) }], body: "Commits it signed stop being accepted.", action: "Remove" };
    case "vault_request": {
      let host = "";
      try { host = new URL(String(args.url)).host; } catch {}
      return {
        ...base, title: host ? `Use your key with ${host}?` : "Use a key from your vault?",
        lines: [{ label: "Key", value: clip(extra.key || args.item, 120) }, { label: "Request", value: `${String(args.method || "GET").toUpperCase()} ${clip(args.url, 200)}` }],
        body: "Agent ID adds the key on the agent's computer: the agent never sees it. Allowed for this site for the rest of this chat.", action: "Use key",
      };
    }
    default: return { ...base, title: titleFor(kind, action), ...previewOf(args), action: PRIMARY[kind] };
  }
}

// A card for something Agent ID holds for the owner's yes (it asks first for
// that kind of action, or a payment is above the approval amount) when no card
// was shown before it ran: built from what Agent ID kept of the request.
const WAITING = { contact_save: ["Save this contact?", "Save"], contact_delete: ["Delete this contact?", "Delete"] };
function waitingCard({ action, waiting = {}, agent = null }) {
  const kind = AGENT_ID[action] || "use";
  const [title, button] = WAITING[action] || ["Allow this?", "Allow"];
  const { lines, body } = previewOf(waiting.summary || {});
  return { kind, title, agent: agent || "Your agent", app: "Agent ID", lines, body, action: button };
}

// What an agent hears when the card wasn't allowed.
const UNDONE = { send: "nothing was sent", pay: "nothing was paid", delete: "nothing was deleted" };
function refusal(answer, kind = "send") {
  const what = UNDONE[kind] || "nothing was done";
  const why = answer?.decision === "timeout" ? "The user didn't answer the card in time" : answer?.decision === "cancel" ? "The card was closed when this reply stopped" : "The user didn't allow it";
  return { contentItems: [{ type: "inputText", text: `${why}: ${what}. Don't try another way; ask the user if it's still wanted.` }], success: false };
}

module.exports = { composioKind, agentIdKind, pageActionKind, enterKind, asksItself, composioCard, agentIdCard, pageCard, waitingCard, previewOf, appOf, dollars, refusal, AGENT_ID };
