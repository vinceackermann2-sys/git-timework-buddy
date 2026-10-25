"use strict";
// An agent's own Agent ID in its chats: its mail, phone, wallet, card,
// computer, vault and the apps its owner connected, as Agent ID's MCP server
// offers them (timewarp/supabase/functions/agent-id/mcp.ts).
//
// The chat gets two small tools rather than Agent ID's forty: one looks up
// what the agent can do (with each action's arguments), the other does it.
// GPT's code mode leaves even these for the model to find when a task needs
// them; other models are told about just these two (codex-config.cjs). Either
// way, chats that don't use Agent ID cost next to nothing more.
//
// A call acts as the chat's agent, with its own key (kept encrypted by
// agent-id.cjs, never shown to the model): its limits and asking first apply,
// as anywhere else it runs. Each agent keeps one MCP session per run of
// Timewarp, so Agent ID shows it's used in Timewarp, with the chat's model.
//
// Sending, paying and deleting wait for the user's OK on a card in the chat
// first (approvals.cjs), written from the action's own arguments. What Agent
// ID itself holds for the owner (asking first, payments above the approval
// amount) is answered on a card too, and decided with the owner's account:
// only the user's click on Timewarp's card does that, never the agent.
const { agentIdKind, agentIdCard, waitingCard, refusal } = require("./approvals.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });

const LOOKUP = {
  name: "agent_id_tools",
  description: "What you can do with your own Agent ID (your mail, phone, wallet, card, computer, vault and the apps your owner connected for you): each action with its arguments. Look before using agent_id.",
  inputSchema: { type: "object", properties: { query: { type: "string", description: "What you want to do, like \"send an email\"; leave out to see everything." } }, additionalProperties: false },
};
const RUN = {
  name: "agent_id",
  description: "Do one action with your own Agent ID, as agent_id_tools describes it.",
  inputSchema: { type: "object", properties: { action: { type: "string", description: "The action's name from agent_id_tools, like mail_send." }, arguments: { type: "object", description: "Its arguments.", additionalProperties: true } }, required: ["action"], additionalProperties: false },
};
const text = value => ({ contentItems: [{ type: "inputText", text: typeof value === "string" ? value : JSON.stringify(value) }], success: true });
// Where the user manages it, for when an action needs them (verifying, adding money, approving).
const PAGE_NOTE = "Your owner verifies their identity, adds money, sets limits and approves on your Agent ID page in Timewarp. Link it as [Agent ID](<timewarp://agent>), or a part of it, such as <timewarp://agent/wallet>.";

// The wallet card the chat draws from <wallet /> (widgets.jsx), offered when the agent reads its wallet.
const WALLET_NOTE = "To show the user the wallet, write <wallet /> on its own line in your reply: it shows the live balance with Add money and Withdraw. Don't repeat its numbers in text.";
// What the agent does next when money can't move: the user adds it (the wallet
// card), verifies (a card from app_action) or changes a limit (the agent's page).
const MONEY_NOTES = [
  [/\((?:insufficient|no_wallet)\)/, "Show the user the wallet with <wallet /> on its own line in your reply: only they can add money, with its Add money. Try again once they say it's done."],
  [/\(verification_required\)/, "Ask the user to verify their identity on a card: app_action with action verify_identity. Try again once it's done."],
  [/\(over_limit\)/, "The user sets the wallet's limits on your page: link it as [Wallet](<timewarp://agent/wallet>)."],
];
const usd = money => money && Number.isFinite(money.amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency || "USD" }).format(money.amount / 100) : null;
// Agent ID's answer as JSON, when it is (a tool's text).
const jsonOf = content => { for (const item of content) { if (item.type !== "text") continue; try { const value = JSON.parse(item.text); if (value && typeof value === "object") return value; } catch {} } return null; };

// request: agentIdApi; cache: { load, save } for the action list between runs.
// confirm(conversationId, card): the user's answer to a card in the chat.
function createAgentIdTools({ request, agentIds, cache = null, modelOf = () => null, confirm = null, version = "1.0.0", log = () => {} }) {
  let tools = [];
  try { tools = (cache?.load()?.tools || []).filter(tool => tool?.name); } catch {}
  const sessions = new Map();
  // Vault keys the user allowed in a chat: "<chat>\n<item>\n<site>".
  const keysAllowed = new Set();
  const hostOf = url => { try { return new URL(String(url)).host; } catch { return ""; } };

  // The actions as Agent ID describes them (open: they hold nothing of anyone's).
  async function refresh() {
    try {
      const value = await request("GET", "/v1/mcp/tools", { open: true });
      const next = (value.tools || []).filter(tool => /^[a-z0-9_]{1,64}$/.test(tool?.name || "") && tool.inputSchema);
      if (!next.length) return;
      tools = next;
      try { cache?.save({ tools }); } catch {}
    } catch (error) { log("Agent ID's tools could not be listed.", error.message); }
  }

  const send = (credentials, message, sessionId) => request("POST", "/mcp", {
    body: message, key: credentials.key,
    headers: sessionId ? { "Mcp-Session-Id": sessionId } : {}, withHeaders: true, timeout: 900000,
  });
  // Opened once per agent: Agent ID records Timewarp as an app this ID is used in.
  async function sessionFor(credentials) {
    const key = credentials.id + "\n" + credentials.key.slice(-8);
    if (sessions.has(key)) return sessions.get(key);
    const opening = send(credentials, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Timewarp", version } } })
      .then(({ headers }) => headers.get("mcp-session-id") || null)
      .catch(error => { sessions.delete(key); log("An Agent ID session could not be opened.", error.message); return null; });
    sessions.set(key, opening);
    return opening;
  }

  // The actions matching a query, most words matched first.
  function lookup(query) {
    const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    const scored = tools.map(tool => ({ tool, score: words.filter(word => `${tool.name} ${tool.description}`.toLowerCase().includes(word)).length }));
    const found = words.length ? scored.filter(item => item.score).sort((a, b) => b.score - a.score).map(item => item.tool) : tools;
    return {
      actions: (found.length ? found : tools).map(({ name, description, inputSchema }) => ({ name, description, arguments: inputSchema.properties || {}, required: inputSchema.required || [] })),
      owner: PAGE_NOTE,
    };
  }

  async function call(conversationId, params, agent) {
    if (!agent) throw fail(404, "This chat has no agent.");
    const credentials = await agentIds.credentials(agent.id);
    if (!credentials) throw fail(404, "You don't have an Agent ID yet. The user gets you one at the top of your page in Timewarp; link it as [Get Agent ID](<timewarp://agent>).");
    if (params.tool === LOOKUP.name) return text(lookup(params.arguments?.query));
    if (params.tool !== RUN.name) throw fail(404, "This Agent ID tool isn't available.");
    const action = String(params.arguments?.action || "");
    if (!tools.some(tool => tool.name === action)) throw fail(404, `There's no Agent ID action "${action}". Look with agent_id_tools.`);
    const args = params.arguments?.arguments && typeof params.arguments.arguments === "object" && !Array.isArray(params.arguments.arguments) ? params.arguments.arguments : {};
    // Sending, paying and deleting: the user's OK on a card first. A vault
    // key is asked about once per key and site in a chat.
    const kind = agentIdKind(action, args);
    const keyUse = kind === "use" ? `${conversationId}\n${args.item}\n${hostOf(args.url)}` : null;
    if (kind && !(keyUse && keysAllowed.has(keyUse))) {
      if (!confirm) throw fail(403, "This needs the user's OK, which can only be given in a Timewarp chat.");
      const answer = await confirm(conversationId, agentIdCard({ action, args, kind, agent: agent.name, extra: await detailsFor(agent, action, args) }));
      if (answer.decision !== "accept") return refusal(answer, kind);
      if (keyUse) keysAllowed.add(keyUse);
    }
    const sessionId = await sessionFor(credentials);
    const model = modelOf(conversationId, agent);
    const { value } = await send(credentials, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: action, arguments: { ...args, ...(model ? { model } : {}) } } }, sessionId);
    if (value.error) throw fail(400, value.error.message || "Agent ID could not do this.");
    const content = value.result?.content || [];
    // Held for the owner's yes: answered here, on a card (or by the card just answered).
    const answer = jsonOf(content);
    if (answer?.status === "needs_approval" && answer.approval && confirm) return decide(conversationId, agent, action, answer, !!kind);
    const items = content.map(item => ({ type: "inputText", text: item.type === "text" ? String(item.text ?? "") : JSON.stringify(item) }));
    if (action === "wallet_get" && !value.result?.isError) items.push({ type: "inputText", text: WALLET_NOTE });
    if (value.result?.isError) for (const [pattern, note] of MONEY_NOTES) if (items.some(item => pattern.test(item.text))) { items.push({ type: "inputText", text: note }); break; }
    return { contentItems: items, success: !value.result?.isError };
  }

  // What the card can say besides the action's own arguments: the wallet's
  // balance before a payment, and the email a bin move is about. Best effort.
  async function detailsFor(agent, action, args) {
    try {
      if (action === "wallet_send") return { balance: usd((await agentIds.call(agent.id, "wallet.get")).wallet?.balance) };
      if (action === "mail_trash" && args.id) { const mail = (await agentIds.call(agent.id, "mail.read", { id: args.id })).message || {}; return { mail: { from: mail.counterparty, subject: mail.subject } }; }
      if (action === "vault_request" && args.item) return { key: ((await agentIds.call(agent.id, "vault.get")).items || []).find(item => item.id === args.item)?.label || null };
    } catch {}
    return {};
  }

  // Something Agent ID holds for the owner: approved with the owner's account
  // once the user allowed it (on the card before it ran, or on one now), else denied.
  async function decide(conversationId, agent, action, waiting, allowed) {
    if (!allowed) {
      const answer = await confirm(conversationId, waitingCard({ action, waiting, agent: agent.name }));
      if (answer.decision !== "accept") {
        // A card closed with its reply (or unanswered) leaves the request waiting; a no denies it.
        if (answer.decision === "decline") await agentIds.call(agent.id, "approvals.decide", { id: waiting.approval, decision: "deny" }).catch(error => log("An Agent ID approval could not be denied.", error.message));
        return refusal(answer, agentIdKind(action) || "use");
      }
    }
    try {
      const done = await agentIds.call(agent.id, "approvals.decide", { id: waiting.approval, decision: "approve" });
      return text({ ...done, note: "The user allowed it on a card in Timewarp, so it ran." });
    } catch (error) {
      return { contentItems: [{ type: "inputText", text: `The user allowed it, but Agent ID didn't do it: ${error.message} ${PAGE_NOTE}` }], success: false };
    }
  }

  return {
    refresh, call,
    specs: () => [{ description: LOOKUP.description, tools: [LOOKUP, RUN] }],
    readOnly: new Set([LOOKUP.name]),
    // A new session after a sign-in change: the next account's agents are other agents.
    reset: () => { sessions.clear(); keysAllowed.clear(); },
  };
}

module.exports = { createAgentIdTools };
