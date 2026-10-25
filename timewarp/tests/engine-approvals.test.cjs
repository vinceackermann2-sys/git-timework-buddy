"use strict";
// Sending, paying and deleting wait for the user's OK on a card in the chat,
// whatever the model decided (app/main/approvals.cjs): in connected apps
// (the bridge's gate), in the agent's own Agent ID (agent-id-tools.cjs), in
// Timewarp's own tools (automations, the vault, app_action), and Codex isn't
// left to ask a second time about the same call.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const approvals = require("../app/main/approvals.cjs");
const { createModelBridge } = require("../app/main/model-bridge.cjs");
const { createAgentIdTools } = require("../app/main/agent-id-tools.cjs");
const { createAutomationTools } = require("../app/main/automation-tools.cjs");
const { createAppTools } = require("../app/main/app-tools.cjs");
const { openStore } = require("../app/main/store.cjs");
const { createHarness } = require("../app/main/harness.cjs");

test("a connected app's action is sending, paying or deleting by its name; reading and drafts never ask", () => {
  const kinds = Object.fromEntries([
    "GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "GMAIL_SEND_DRAFT", "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_FETCH_EMAILS", "GMAIL_LIST_DRAFTS", "GMAIL_MOVE_TO_TRASH",
    "SLACK_CHAT_POST_MESSAGE", "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", "TWITTER_POST_LOOKUP_BY_POST_ID", "LINKEDIN_CREATE_LINKED_IN_POST",
    "GOOGLEDRIVE_ADD_FILE_SHARING_PERMISSION", "STRIPE_CREATE_PAYMENT_INTENT", "GITHUB_DELETE_A_REPOSITORY", "NOTION_UPDATE_PAGE",
  ].map(slug => [slug, approvals.composioKind(slug)]));
  assert.deepEqual(kinds, {
    GMAIL_SEND_EMAIL: "send", GMAIL_REPLY_TO_THREAD: "send", GMAIL_SEND_DRAFT: "send", GMAIL_CREATE_EMAIL_DRAFT: null, GMAIL_FETCH_EMAILS: null, GMAIL_LIST_DRAFTS: null, GMAIL_MOVE_TO_TRASH: "delete",
    SLACK_CHAT_POST_MESSAGE: "send", SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: "send", TWITTER_POST_LOOKUP_BY_POST_ID: null, LINKEDIN_CREATE_LINKED_IN_POST: "send",
    GOOGLEDRIVE_ADD_FILE_SHARING_PERMISSION: "send", STRIPE_CREATE_PAYMENT_INTENT: "pay", GITHUB_DELETE_A_REPOSITORY: "delete", NOTION_UPDATE_PAGE: null,
  });
  // A calendar event sends invitations only when it has guests.
  assert.equal(approvals.composioKind("GOOGLECALENDAR_CREATE_EVENT", { attendees: ["ada@example.com"] }), "send");
  assert.equal(approvals.composioKind("GOOGLECALENDAR_CREATE_EVENT", {}), null);
  // Agent ID actions, and its connected apps by the action they run.
  assert.deepEqual(["mail_send", "sms_send", "call_place", "wallet_send", "card_reveal", "mail_trash", "contact_delete", "wallet_get", "mail_list", "vm_exec"].map(action => approvals.agentIdKind(action)),
    ["send", "send", "send", "pay", "pay", "delete", "delete", null, null, null]);
  assert.equal(approvals.agentIdKind("connector_run", { tool: "SLACK_CHAT_POST_MESSAGE", arguments: {} }), "send");
  assert.equal(approvals.agentIdKind("connector_run", { tool: "SLACK_LIST_CHANNELS", arguments: {} }), null);
});

test("calls, orders, funds, cancelling, removing and new messages count too; labels, reactions and drafts don't", () => {
  const kinds = Object.fromEntries([
    "TWILIO_MAKE_A_CALL", "SHOPIFY_CREATE_ORDER", "STRIPE_CREATE_PAYOUT", "COINBASE_WITHDRAW_FUNDS", "STRIPE_CANCEL_SUBSCRIPTION", "SLACK_REMOVE_A_USER_FROM_A_CHANNEL",
    "GMAIL_REMOVE_LABEL", "GMAIL_ADD_LABEL_TO_EMAIL", "GITHUB_CREATE_AN_ISSUE_COMMENT", "SLACK_ADD_REACTION_TO_AN_ITEM", "OUTLOOK_CREATE_DRAFT_MESSAGE", "GOOGLE_REVOKE_TOKEN", "ZOOM_LIST_CALLS",
  ].map(slug => [slug, approvals.composioKind(slug)]));
  assert.deepEqual(kinds, {
    TWILIO_MAKE_A_CALL: "send", SHOPIFY_CREATE_ORDER: "pay", STRIPE_CREATE_PAYOUT: "pay", COINBASE_WITHDRAW_FUNDS: "pay", STRIPE_CANCEL_SUBSCRIPTION: "delete", SLACK_REMOVE_A_USER_FROM_A_CHANNEL: "delete",
    GMAIL_REMOVE_LABEL: null, GMAIL_ADD_LABEL_TO_EMAIL: null, GITHUB_CREATE_AN_ISSUE_COMMENT: "send", SLACK_ADD_REACTION_TO_AN_ITEM: null, OUTLOOK_CREATE_DRAFT_MESSAGE: null, GOOGLE_REVOKE_TOKEN: "delete", ZOOM_LIST_CALLS: null,
  });
  assert.equal(approvals.agentIdKind("vault_request", { item: "k1", url: "https://api.github.com/user" }), "use");
});

test("in a web page, buttons that send, pay or delete ask; ordinary ones, headlines and searches don't", () => {
  const kinds = Object.fromEntries(["Place order", "Buy now", "Pay $12.50", "Confirm and pay", "Send", "Post", "Delete", "Cancel subscription", "Call now",
    "Add to cart", "Subscribe", "Next", "Sign in", "Posts", "Search", "Send feedback about this article and everything else we wrote today"].map(label => [label, approvals.pageActionKind("button", label)]));
  assert.deepEqual(kinds, {
    "Place order": "pay", "Buy now": "pay", "Pay $12.50": "pay", "Confirm and pay": "pay", Send: "send", Post: "send", Delete: "delete", "Cancel subscription": "delete", "Call now": "send",
    "Add to cart": null, Subscribe: null, Next: null, "Sign in": null, Posts: null, Search: null, "Send feedback about this article and everything else we wrote today": null,
  });
  assert.equal(approvals.pageActionKind("textbox", "Send"), null, "only buttons, links and menu items");
  // Enter: a message box with text sends; a search box or an empty box doesn't; a form says what its button does.
  assert.equal(approvals.enterKind({ role: "textbox", label: "Type a message", text: "On my way" }), "send");
  assert.equal(approvals.enterKind({ role: "textbox", label: "Type a message", text: "  " }), null);
  assert.equal(approvals.enterKind({ role: "searchbox", label: "Search messages", text: "invoice" }), null);
  assert.equal(approvals.enterKind({ role: "input", label: "Email", text: "a@b.c", submit: "Place order" }), "pay");
  assert.equal(approvals.enterKind({ role: "input", label: "Email", text: "a@b.c", submit: "Sign in" }), null);
  const card = approvals.pageCard({ kind: "pay", label: "Place order", host: "shop.example.com", title: "Checkout", image: "data:image/jpeg;base64,AAAA", agent: "Orbit" });
  assert.deepEqual([card.title, card.app, card.lines, card.action, card.image], ["Click “Place order”?", "shop.example.com", [{ label: "Page", value: "Checkout" }, { label: "Button", value: "Place order" }], "Place order", "data:image/jpeg;base64,AAAA"]);
  const message = approvals.pageCard({ kind: "send", label: "Type a message", host: "chat.example.com", text: "On my way", image: "javascript:alert(1)" });
  assert.deepEqual([message.title, message.body, message.action, message.image], ["Send this message?", "On my way", "Send", null]);
});

test("the card is written from the call's own arguments: where, to whom, the text and the amount", () => {
  const email = approvals.composioCard({ slug: "GMAIL_SEND_EMAIL", kind: "send", agent: "Orbit", account: "me@gmail.com", reason: "  You asked me to\nsend it. ",
    args: { recipient_email: "ada@example.com", extra_recipients: ["bob@example.com"], cc: [], subject: "Timeline", body: "<p>Hi Ada,</p><p>Here it is.</p>", is_html: true, user_id: "me" } });
  assert.deepEqual(email, {
    kind: "send", title: "Send this email?", agent: "Orbit", app: "Gmail", account: "me@gmail.com",
    lines: [{ label: "To", value: "ada@example.com, bob@example.com" }, { label: "Subject", value: "Timeline" }], body: "Hi Ada,\nHere it is.", action: "Send", reason: "You asked me to send it.",
  });
  const post = approvals.composioCard({ slug: "SLACK_CHAT_POST_MESSAGE", kind: "send", args: { channel: "#launch", text: "We're live", as_user: true } });
  assert.deepEqual([post.title, post.app, post.lines, post.body, post.action], ["Post this?", "Slack", [{ label: "To", value: "#launch" }], "We're live", "Post"]);
  // Dates and yes/no read as people read them.
  const invite = approvals.composioCard({ slug: "GOOGLECALENDAR_CREATE_EVENT", kind: "send", args: { attendees: ["ada@example.com"], start_datetime: "2026-10-27T10:00", send_updates: true } });
  assert.deepEqual(invite.lines.slice(1).map(line => line.label + ": " + line.value), [`Start datetime: ${new Date("2026-10-27T10:00").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`, "Send updates: Yes"]);
  const trash = approvals.composioCard({ slug: "GMAIL_MOVE_TO_TRASH", kind: "delete", args: { message_id: "m1" } });
  assert.deepEqual([trash.title, trash.action, trash.lines], ["Move to trash?", "Delete", [{ label: "Message id", value: "m1" }]]);

  const pay = approvals.agentIdCard({ action: "wallet_send", kind: "pay", agent: "Orbit", args: { to: "nova", amount: "12.5", memo: "API credits" }, extra: { balance: "$40.00" } });
  assert.deepEqual([pay.title, pay.amount, pay.action, pay.lines], ["Send $12.50?", "$12.50", "Send $12.50", [{ label: "To", value: "nova" }, { label: "For", value: "API credits" }, { label: "Balance", value: "$40.00" }]]);
  const mail = approvals.agentIdCard({ action: "mail_send", kind: "send", args: { to: ["ada@example.com"], subject: "Hi", text: "Hello" } });
  assert.deepEqual([mail.title, mail.app, mail.lines, mail.body], ["Send this email?", "Agent ID", [{ label: "To", value: "ada@example.com" }, { label: "Subject", value: "Hi" }], "Hello"]);
  assert.equal(approvals.agentIdCard({ action: "sms_send", kind: "send", args: { to: "+14155550123", text: "On my way" } }).body, "On my way");
  assert.equal(approvals.agentIdCard({ action: "mail_trash", kind: "delete", args: { id: "m1" }, extra: { mail: { from: "news@example.com", subject: "Weekly" } } }).lines[1].value, "Weekly");
  // A no, a timeout and a closed card each say nothing happened.
  assert.match(approvals.refusal({ decision: "decline" }, "pay").contentItems[0].text, /didn't allow it: nothing was paid/);
  assert.match(approvals.refusal({ decision: "timeout" }, "send").contentItems[0].text, /didn't answer the card in time: nothing was sent/);
});

test("a connected app's send waits for the card; a no answers the agent and nothing reaches the app", async t => {
  const forwarded = [], cards = [];
  let answer = "decline";
  const integrations = { mcp: async (req, res) => { let body = ""; for await (const chunk of req) body += chunk; forwarded.push(JSON.parse(body)); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "done" }] } })); } };
  const toolServer = { resolve: () => ({ conversationId: "chat-1", agent: { id: "agent-1", name: "Orbit" } }) };
  const gate = async ({ conversationId, agent, arguments: args }) => {
    const kind = approvals.composioKind(args.toolSlug, args.arguments);
    if (!kind) return null;
    cards.push({ conversationId, ...approvals.composioCard({ slug: args.toolSlug, args: args.arguments, kind, agent: agent.name }) });
    return answer === "accept" ? null : require("../app/main/tool-server.cjs").mcpResult(approvals.refusal({ decision: answer }, kind));
  };
  const bridge = createModelBridge({ token: "t", port: 0, cloud: async () => Response.json({}), funding: { current: async () => ({}) }, chatgpt: {}, integrations, toolServer: () => toolServer, gate });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(() => bridge.close());
  const call = (toolSlug, args) => fetch(`http://127.0.0.1:${bridge.server.address().port}/mcp/composio`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "composio_execute", arguments: { connectedAccountId: "c1", toolSlug, arguments: args }, _meta: { threadId: "th" } } }) }).then(r => r.json());
  const refused = await call("GMAIL_SEND_EMAIL", { recipient_email: "ada@example.com", subject: "Hi", body: "Hello" });
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /didn't allow it: nothing was sent/);
  assert.equal(forwarded.length, 0, "a refused send never reaches the app");
  assert.equal(cards[0].conversationId, "chat-1");
  assert.equal(cards[0].title, "Send this email?");
  answer = "accept";
  await call("GMAIL_SEND_EMAIL", { recipient_email: "ada@example.com", subject: "Hi", body: "Hello" });
  await call("GMAIL_FETCH_EMAILS", { max_results: 5 });
  assert.equal(forwarded.length, 2);
  assert.equal(forwarded[0].params.arguments.assistantId, "agent-1", "the calling chat's agent acts, whatever id was given");
  assert.equal(cards.length, 2, "reading asks nothing");
});

// An Agent ID that answers like the real one: actions run unless the owner asks first.
function agentIdFake({ held = [] } = {}) {
  const sent = [], decided = [];
  const request = async (method, route, options = {}) => {
    if (route === "/v1/mcp/tools") return { tools: ["mail_send", "wallet_send", "wallet_get", "contact_save"].map(name => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) };
    if (options.body?.method === "initialize") return { value: { result: {} }, headers: new Headers({ "mcp-session-id": "mcs" }) };
    sent.push(options.body.params);
    const name = options.body.params.name;
    const value = held.includes(name) ? { status: "needs_approval", approval: "apr_" + name, approveUrl: "https://example.com/approve", summary: { to: "ada@example.com", name: "Ada" }, message: "Waits for the owner" }
      : name === "wallet_get" ? { wallet: { balance: { amount: 4000, currency: "USD" } } } : { ok: name };
    return { value: { result: { content: [{ type: "text", text: JSON.stringify(value) }] } }, headers: new Headers() };
  };
  const agentIds = {
    credentials: async () => ({ id: "agt_1", key: "twa_key" }),
    call: async (agentId, op, input) => {
      if (op === "wallet.get") return { wallet: { balance: { amount: 4000, currency: "USD" } } };
      if (op === "approvals.decide") { decided.push(input); return input.decision === "approve" ? { decision: "approved", status: "completed", sent: true } : { status: "denied" }; }
      throw new Error("unexpected " + op);
    },
  };
  return { request, agentIds, sent, decided };
}

test("Agent ID mail and payments ask on a card first; a no sends nothing; a yes also approves what Agent ID holds", async () => {
  const fake = agentIdFake({ held: ["wallet_send", "contact_save"] }), cards = [];
  let answer = "decline";
  const tools = createAgentIdTools({ request: fake.request, agentIds: fake.agentIds, confirm: async (conversationId, card) => { cards.push(card); return { decision: answer }; } });
  await tools.refresh();
  const orbit = { id: "agent-1", name: "Orbit" };
  const run = (action, args = {}) => tools.call("chat-1", { tool: "agent_id", arguments: { action, arguments: args } }, orbit);

  const no = await run("mail_send", { to: "ada@example.com", subject: "Hi", text: "Hello" });
  assert.equal(no.success, false);
  assert.match(no.contentItems[0].text, /nothing was sent/);
  assert.equal(fake.sent.length, 0, "nothing reached Agent ID");
  assert.equal(cards[0].title, "Send this email?");

  answer = "accept";
  const paid = await run("wallet_send", { to: "nova", amount: "12.50" });
  assert.deepEqual([cards[1].title, cards[1].lines.at(-1)], ["Send $12.50?", { label: "Balance", value: "$40.00" }], "the card shows the balance before paying");
  // Above the approval amount Agent ID holds it: the user's yes on the card approves it, with no second card.
  assert.deepEqual(fake.decided, [{ id: "apr_wallet_send", decision: "approve" }]);
  assert.equal(cards.length, 2);
  assert.match(paid.contentItems[0].text, /allowed it on a card in Timewarp/);

  // Something held that had no card before it ran gets one; a no denies it.
  answer = "decline";
  const contact = await run("contact_save", { name: "Ada", email: "ada@example.com" });
  assert.equal(cards[2].title, "Save this contact?");
  assert.deepEqual(fake.decided.at(-1), { id: "apr_contact_save", decision: "deny" });
  assert.equal(contact.success, false);

  // Reading the wallet asks nothing and offers the wallet card.
  const wallet = await run("wallet_get");
  assert.equal(cards.length, 3);
  assert.match(wallet.contentItems.at(-1).text, /<wallet \/>/);
});

test("a vault key asks once per key and site in a chat; money that can't move says what the user does", async () => {
  const sent = [], cards = [];
  const request = async (method, route, options = {}) => {
    if (route === "/v1/mcp/tools") return { tools: ["vault_request", "wallet_send"].map(name => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) };
    if (options.body?.method === "initialize") return { value: { result: {} }, headers: new Headers() };
    sent.push(options.body.params.name);
    const failed = options.body.params.name === "wallet_send";
    return { value: { result: { ...(failed ? { isError: true } : {}), content: [{ type: "text", text: failed ? "The wallet doesn't have enough money for this. (insufficient)" : "{\"status\":200}" }] } }, headers: new Headers() };
  };
  const agentIds = { credentials: async () => ({ id: "agt_1", key: "twa_key" }), call: async (agentId, op) => op === "vault.get" ? { items: [{ id: "k1", label: "GitHub token" }] } : { wallet: { balance: { amount: 100, currency: "USD" } } } };
  const tools = createAgentIdTools({ request, agentIds, confirm: async (conversationId, card) => { cards.push({ conversationId, ...card }); return { decision: "accept" }; } });
  await tools.refresh();
  const orbit = { id: "agent-1", name: "Orbit" };
  const run = (chat, action, args) => tools.call(chat, { tool: "agent_id", arguments: { action, arguments: args } }, orbit);
  await run("chat-1", "vault_request", { item: "k1", url: "https://api.github.com/user" });
  await run("chat-1", "vault_request", { item: "k1", url: "https://api.github.com/repos" });
  await run("chat-1", "vault_request", { item: "k1", url: "https://uploads.github.com/x", method: "post" });
  await run("chat-2", "vault_request", { item: "k1", url: "https://api.github.com/user" });
  assert.deepEqual(cards.map(card => [card.conversationId, card.title, card.lines[0].value]), [
    ["chat-1", "Use your key with api.github.com?", "GitHub token"], ["chat-1", "Use your key with uploads.github.com?", "GitHub token"], ["chat-2", "Use your key with api.github.com?", "GitHub token"],
  ]);
  const short = await run("chat-1", "wallet_send", { to: "nova", amount: "50" });
  assert.equal(short.success, false);
  assert.match(short.contentItems.at(-1).text, /<wallet \/>.*only they can add money/);
});

test("without a chat to ask in, Agent ID sending is refused", async () => {
  const fake = agentIdFake();
  const tools = createAgentIdTools({ request: fake.request, agentIds: fake.agentIds });
  await tools.refresh();
  await assert.rejects(tools.call("chat-1", { tool: "agent_id", arguments: { action: "mail_send", arguments: { to: "a@example.com" } } }, { id: "agent-1", name: "Orbit" }), /user's OK/);
  assert.equal(fake.sent.length, 0);
});

test("deleting an automation asks on a card; a no keeps it", async () => {
  const removed = [], cards = [];
  let answer = "decline";
  const item = { id: "auto-1", agentId: "agent-1", name: "Morning inbox", schedule: { kind: "weekdays", time: "08:30" }, instructions: "x" };
  const tools = createAutomationTools({ automations: { get: () => item, remove: id => removed.push(id) }, confirm: async (conversationId, card) => { cards.push(card); return { decision: answer }; } });
  const agent = { id: "agent-1", name: "Orbit" };
  const kept = await tools.call("chat-1", { tool: "delete", arguments: { id: "auto-1" } }, agent);
  assert.equal(kept.success, false);
  assert.deepEqual(removed, []);
  assert.deepEqual([cards[0].kind, cards[0].title, cards[0].lines], ["delete", "Delete this automation?", [{ label: "Name", value: "Morning inbox" }, { label: "When", value: "Weekdays at 08:30" }]]);
  answer = "accept";
  await tools.call("chat-1", { tool: "delete", arguments: { id: "auto-1" } }, agent);
  assert.deepEqual(removed, ["auto-1"]);
});

test("app_action does what the screens do: tool servers and Agent ID with cards, new agents without", async () => {
  const cards = [], servers = [{ name: "docs", transport: "http", url: "https://docs.example.com/mcp", enabled: true, tools: 3 }], added = [], removed = [], made = [];
  let answer = "accept";
  const mcp = {
    list: async () => servers,
    add: async (input, options) => { added.push({ input, options }); servers.push({ name: input.name, transport: input.transport, url: input.url || null, command: input.command || null, args: input.args || [], tools: 2, enabled: true }); return servers; },
    remove: async name => { removed.push(name); },
  };
  const agentIds = {
    get: async () => ({ linked: false }),
    create: async id => { made.push(id); return { id: "agt_1", handle: "orbit", resources: { mail: { address: "orbit@agents.example.com" }, wallet: { status: "active" } } }; },
    verify: async () => ({ status: "pending", opened: true }),
  };
  const tools = createAppTools({ store: {}, userId: () => "user-1", confirm: async (conversationId, card) => { cards.push(card); return { decision: answer }; },
    mcp: () => mcp, agents: { create: input => ({ id: "agent-9", ...input }) }, agentIds });
  const agent = { id: "agent-1", name: "Orbit" };
  const act = async args => { const result = await tools.call("chat-1", { tool: "app_action", arguments: args }, agent); try { return { ...result, value: JSON.parse(result.contentItems[0].text) }; } catch { return result; } };

  assert.deepEqual((await act({ action: "tool_servers" })).value, [{ name: "docs", transport: "http", enabled: true, tools: 3 }]);
  const add = await act({ action: "add_tool_server", name: "Notes", command: "npx", args: ["notes-mcp"], reason: "For your notes" });
  assert.deepEqual([cards[0].title, cards[0].lines, cards[0].reason, cards[0].agent], ["Add this tool server?", [{ label: "Name", value: "notes" }, { label: "Command", value: "npx notes-mcp" }], "For your notes", "Orbit"]);
  assert.deepEqual(added[0].options, { confirmed: true }, "the card is the program's confirmation");
  assert.equal(add.value.added, "notes");
  answer = "decline";
  const keep = await act({ action: "remove_tool_server", name: "docs" });
  assert.equal(keep.success, false);
  assert.deepEqual(removed, []);
  assert.equal(cards[1].kind, "delete");
  answer = "accept";
  const id = await act({ action: "get_agent_id" });
  assert.deepEqual([cards[2].title, made, id.value.mail], ["Get an Agent ID for Orbit?", ["agent-1"], "orbit@agents.example.com"]);
  assert.equal((await act({ action: "verify_identity" })).value.status, "pending");
  assert.deepEqual((await act({ action: "new_agent", name: "Scout", instructions: "Research" })).value.agent, { id: "agent-9", name: "Scout" });
  assert.equal(cards.length, 4, "a new agent needs no card");
});

test("Codex doesn't ask a second time about a call Timewarp's own card asks about", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-approvals-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Orbit", workspace: path.join(root, "orbit") });
  const client = new EventEmitter(), answered = [], lines = [];
  let turns = 0;
  client.request = async method => method === "thread/start" ? { thread: { id: "thread-1" } } : method === "turn/start" ? { turn: { id: "turn-" + ++turns } } : {};
  client.respond = (id, response) => answered.push({ id, response });
  client.respondError = () => {};
  const harness = createHarness({ store, client, userId: () => "user-1", modelSettings: () => ({ name: "m" }), instructionsFor: () => "",
    record: (level, message, facts) => lines.push({ message, ...facts }),
    answerFor: (method, params) => method === "mcpServer/elicitation/request" && approvals.asksItself(params) ? { action: "accept", content: null, _meta: null } : null });
  const chat = harness.conversations.create({ agentId: "agent-1" });
  await harness.send(chat.id, { text: "Go" });
  const threadId = harness.conversations.get(chat.id).codexThreadId;
  const ask = (id, serverName, tool, toolParams) => client.emit("request", { id, method: "mcpServer/elicitation/request", params: { threadId, serverName, mode: "form", message: `Allow the ${serverName} MCP server to run tool "${tool}"?`, requestedSchema: { type: "object", properties: {} }, _meta: { codex_approval_kind: "mcp_tool_call", persist: ["session", "always"], tool_params: toolParams } } });
  ask(1, "timewarp_composio", "composio_execute", { toolSlug: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "a@example.com" } });
  ask(2, "timewarp_agent_id", "agent_id", { action: "wallet_send", arguments: { to: "nova", amount: "5" } });
  ask(3, "timewarp_composio", "composio_execute", { toolSlug: "NOTION_UPDATE_PAGE", arguments: {} });
  ask(4, "mailer", "send_mail", { to: "a@example.com" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(answered.map(item => item.id), [1, 2], "Timewarp's card asks about these");
  assert.deepEqual(harness.pendingApprovals().map(item => item.id), [3, 4], "the rest the user answers on Codex's question");
  assert.equal(lines.filter(line => line.message === "Request answered by Timewarp: its own card asks").length, 2);
});
