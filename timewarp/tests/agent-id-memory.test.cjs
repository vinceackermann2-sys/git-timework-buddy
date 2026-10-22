"use strict";
// An agent's memory (encrypted, searchable, the owner's to see and change) and
// the owner choosing which of the agent's actions wait for their yes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startLocal, loadModule } = require("../scripts/agent-id-local.cjs");

const DATA_KEY = crypto.randomBytes(32).toString("base64");

async function setup(t, env = { AGENT_ID_DATA_KEY: DATA_KEY }) {
  const local = await startLocal({ env });
  t.after(() => local.close());
  const ok = async (method, url, init) => {
    const response = await local.call(method, url, init);
    assert.ok(response.status < 300, `${method} ${url} → ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  const user = async () => { const u = await local.user(); await ok("POST", "/v1/account/terms", { token: u.session, body: { version: terms } }); return u; };
  const agent = async (owner, name) => { const created = await ok("POST", "/v1/agents", { token: owner.session, body: { name } }); return { ...created.agent, key: created.secret }; };
  return { local, ok, user, agent };
}

test("memory: kept encrypted, found by what it's about, never a secret, and the owner's to change", async t => {
  const { local, ok, user, agent } = await setup(t);
  const alice = await user(), bob = await user();
  const bot = await agent(alice, "Bot"), other = await agent(alice, "Other");

  const saved = await ok("POST", "/v1/me/memories", { token: bot.key, body: { text: "Alice wants invoices as PDF, sent on the 1st of each month.", topic: "Invoices" } });
  assert.match(saved.memory.id, /^mem_[a-z0-9]{24}$/);
  assert.deepEqual([saved.memory.source, saved.memory.topic], ["agent", "Invoices"]);
  await ok("POST", "/v1/me/memories", { token: bot.key, body: { text: "The Acme project's staging site is staging.acme.test." } });
  await ok("POST", "/v1/me/memories", { token: bot.key, body: { text: "Bob from Nordic Parts answers fastest by phone." } });
  const again = await ok("POST", "/v1/me/memories", { token: bot.key, body: { text: "alice wants invoices as PDF,   sent on the 1st of each month." } });
  assert.deepEqual([again.memory.id, again.note], [saved.memory.id, "Already remembered."]);

  // Nothing readable in the database.
  const stored = JSON.stringify((await local.db.query("select * from agent_id_memories")).rows);
  for (const word of ["invoices", "Invoices", "staging.acme", "Nordic"]) assert.ok(!stored.includes(word), `${word} isn't stored in the clear.`);

  // Secrets are refused, and pointed to the vault.
  // Made-up keys, put together here so none appears whole in the code.
  for (const text of [`The Stripe key is ${"sk_" + "live_"}abcdefghijklmnopqrstuv`, "password: hunter2-long", `token ${"gh" + "p_"}abcdefghijklmnopqrstuvwxyz0123456789`]) {
    const refused = await local.call("POST", "/v1/me/memories", { token: bot.key, body: { text } });
    assert.deepEqual([refused.status, refused.body.error.code], [400, "secret_in_memory"], text);
    assert.match(refused.body.error.message, /vault/);
  }

  // Found by what it's about.
  const found = await ok("GET", "/v1/me/memories/search?query=invoice%20pdf", { token: bot.key });
  assert.equal(found.memories[0].id, saved.memory.id);
  assert.match((await ok("GET", "/v1/me/memories/search?query=acme%20staging", { token: bot.key })).memories[0].text, /staging\.acme\.test/);
  assert.equal((await ok("GET", "/v1/me/memories/search?query=bananas", { token: bot.key })).note, "Nothing remembered about that.");

  // Brought in from other apps: duplicates and secrets left out.
  const imported = await ok("POST", "/v1/me/memories/import", { token: bot.key, body: { items: [
    { text: "Prefers short answers without headings.", topic: "Style", from: "claude-code" },
    { text: "Alice wants invoices as PDF, sent on the 1st of each month.", from: "codex" },
    { text: `OPENAI key: ${"sk-" + "proj-"}abcdefghijklmnopqrstuvwxyz`, from: "cursor" },
  ] } });
  assert.deepEqual(imported, { added: 1, duplicates: 1, skipped: 1 });
  const listed = (await ok("GET", "/v1/me/memories", { token: bot.key })).memories;
  assert.equal(listed.length, 4);
  assert.deepEqual(listed.find(m => m.topic === "Style").from, "claude-code");

  // Through MCP: the app and model it was saved with are kept.
  const rpc = (body, session) => local.call("POST", "/mcp", { token: bot.key, headers: session ? { "mcp-session-id": session } : {}, body: { jsonrpc: "2.0", ...body } });
  const init = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "codex", version: "1" } } });
  assert.match(init.body.result.instructions, /memory_search/);
  const session = init.headers.get("mcp-session-id");
  await rpc({ id: 2, method: "tools/call", params: { name: "whoami", arguments: { model: "gpt-6" } } }, session);
  const viaMcp = await rpc({ id: 3, method: "tools/call", params: { name: "memory_save", arguments: { text: "Ships orders from the Malmö warehouse." } } }, session);
  const memory = JSON.parse(viaMcp.body.result.content[0].text).memory;
  assert.deepEqual([memory.from, memory.model], ["codex", "gpt-6"]);
  const searched = await rpc({ id: 4, method: "tools/call", params: { name: "memory_search", arguments: { query: "warehouse" } } }, session);
  assert.equal(JSON.parse(searched.body.result.content[0].text).memories[0].id, memory.id);

  // Each agent has its own; the owner sees, edits and deletes them; nobody else can.
  assert.equal((await ok("GET", "/v1/me/memories", { token: other.key })).memories.length, 0);
  assert.equal((await local.call("DELETE", `/v1/me/memories/${saved.memory.id}`, { token: other.key })).status, 404);
  const owners = (await ok("GET", `/v1/agents/${bot.id}/memories`, { token: alice.session })).memories;
  assert.equal(owners.length, 5);
  assert.equal((await local.call("GET", `/v1/agents/${bot.id}/memories`, { token: bob.session })).status, 404);
  const edited = await ok("PATCH", `/v1/agents/${bot.id}/memories/${saved.memory.id}`, { token: alice.session, body: { text: "Alice wants invoices as PDF on the 5th." } });
  assert.equal(edited.memory.text, "Alice wants invoices as PDF on the 5th.");
  assert.equal((await ok("GET", "/v1/me/memories/search?query=5th", { token: bot.key })).memories[0].id, saved.memory.id);
  const added = await ok("POST", `/v1/agents/${bot.id}/memories`, { token: alice.session, body: { text: "Never book flights before 9am." } });
  assert.equal(added.memory.source, "owner");
  await ok("DELETE", `/v1/agents/${bot.id}/memories/${added.memory.id}`, { token: alice.session });
  await ok("DELETE", `/v1/me/memories/${memory.id}`, { token: bot.key });
  assert.equal((await ok("GET", "/v1/me/memories", { token: bot.key })).memories.length, 4);

  // Bound to its agent: copied to another, it can't be read.
  await local.db.query("insert into agent_id_memories (id, agent_id, owner_user_id, sealed, digest, source) select 'mem_' || repeat('c', 24), $1, owner_user_id, sealed, digest, source from agent_id_memories where id = $2", [other.id, saved.memory.id]);
  const copied = (await ok("GET", "/v1/me/memories", { token: other.key })).memories[0];
  assert.equal(copied.text, null);
  assert.match(copied.note, /can't be read/);

  // The audit says what happened, never what was remembered.
  const log = JSON.stringify((await ok("GET", "/v1/audit", { token: alice.session })).entries);
  assert.ok(log.includes("memory.save") && log.includes("memory.import") && !log.includes("invoices"));
  await ok("DELETE", `/v1/agents/${bot.id}/memories`, { token: alice.session });
  assert.equal((await ok("GET", "/v1/me/memories", { token: bot.key })).memories.length, 0);
});

test("memory needs its key where it's real", async t => {
  const { memory } = { memory: loadModule("memory.ts") };
  assert.ok(memory.looksSecret("-----BEGIN OPENSSH PRIVATE KEY-----"));
  assert.ok(!memory.looksSecret("The wallet is 0x" + "a".repeat(40) + " on Base."), "A wallet address isn't a secret.");
  assert.deepEqual(memory.rank([{ text: "Lunch is at noon", topic: null }, { text: "Invoices go out monthly", topic: "billing" }], "billing invoices"), [1]);
  const { local, user, agent } = await setup(t, { AGENT_ID_ALLOW_TEST: "false" });
  const owner = await user();
  const bot = await agent(owner, "Bot");
  const off = await local.call("POST", "/v1/me/memories", { token: bot.key, body: { text: "Something to remember." } });
  assert.deepEqual([off.status, off.body.error.code], [503, "memory_off"]);
});

test("asking first: the owner chooses what waits for them, and it runs as asked once approved", async t => {
  const { local, ok, user, agent } = await setup(t);
  const alice = await user();
  const bot = await agent(alice, "Bot"), friend = await agent(alice, "Friend");
  const give = (a, kind) => ok("POST", `/v1/agents/${a.id}/resources`, { token: alice.session, body: { kind } });
  await local.settle();
  for (const a of [bot, friend]) { await give(a, "mail"); await give(a, "phone"); }
  await local.settle();
  const botView = await ok("GET", `/v1/agents/${bot.id}`, { token: alice.session });
  const friendView = await ok("GET", `/v1/agents/${friend.id}`, { token: alice.session });
  const friendMail = friendView.agent.resources.mail.address;
  // Test numbers and test mail don't ask unless the owner says so.
  assert.deepEqual(botView.agent.askFirst, { mail: false, sms: false, call: false, contacts: false, vault: false });
  const direct = await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: friendMail, subject: "Hi", text: "Straight through." } });
  assert.equal(direct.message.status, "delivered");

  // The owner turns asking on; turning it off again takes the website.
  const ownerKey = (await ok("POST", "/v1/keys", { token: alice.session, body: { name: "cli" } })).secret;
  const on = await ok("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { askFirst: { mail: true, contacts: true, sms: true } } });
  assert.deepEqual(on.agent.askFirst, { mail: true, sms: true, call: false, contacts: true, vault: false });
  const offByKey = await local.call("PATCH", `/v1/agents/${bot.id}`, { token: ownerKey, body: { askFirst: { mail: false } } });
  assert.deepEqual([offByKey.status, offByKey.body.error.code], [403, "session_required"]);
  assert.equal((await local.call("PATCH", `/v1/agents/${bot.id}`, { token: alice.session, body: { askFirst: { nonsense: true } } })).status, 400);

  // Mail waits: nothing goes until the owner approves, then exactly that goes, once.
  const asked = await ok("POST", "/v1/me/mail", { token: bot.key, body: { to: friendMail, subject: "Quote for 500 units", text: "Please send your best price." } });
  assert.equal(asked.status, "needs_approval");
  assert.deepEqual([asked.summary.subject, asked.summary.to], ["Quote for 500 units", [friendMail]]);
  assert.match(asked.approveUrl, /\/agent-id\/approvals\?id=/);
  const inbox = async () => (await ok("GET", "/v1/me/mail?folder=inbox", { token: friend.key })).messages.map(m => m.subject);
  assert.ok(!(await inbox()).includes("Quote for 500 units"), "Not sent yet.");
  const pending = (await ok("GET", "/v1/approvals", { token: alice.session })).approvals.find(a => a.id === asked.approval);
  assert.deepEqual([pending.kind, pending.request.kind, pending.request.summary.subject], ["action", "mail", "Quote for 500 units"]);
  assert.equal((await local.call("POST", `/v1/approvals/${asked.approval}`, { token: bot.key, body: { decision: "approve" } })).status, 403, "Never by the agent.");
  const approved = await ok("POST", `/v1/approvals/${asked.approval}`, { token: alice.session, body: { decision: "approve" } });
  assert.deepEqual([approved.status, approved.message.status], ["completed", "delivered"]);
  assert.ok((await inbox()).includes("Quote for 500 units"));
  assert.equal((await local.call("POST", `/v1/approvals/${asked.approval}`, { token: alice.session, body: { decision: "approve" } })).status, 409, "Only once.");
  const status = await ok("GET", `/v1/me/approvals/${asked.approval}`, { token: bot.key });
  assert.deepEqual([status.approval.status, status.approval.kind], ["completed", "mail"]);

  // A text waits; the agent can take it back.
  const text = await ok("POST", "/v1/me/sms", { token: bot.key, body: { to: friendView.agent.resources.phone.address, text: "Running late" } });
  assert.equal(text.status, "needs_approval", JSON.stringify(text));
  assert.equal((await ok("POST", `/v1/me/approvals/${text.approval}/withdraw`, { token: bot.key })).approval.status, "denied");

  // A contact waits; declined, nothing changes.
  const contact = await ok("POST", "/v1/me/contacts", { token: bot.key, body: { name: "Nordic Parts", email: "orders@nordic.example" } });
  assert.deepEqual([contact.status, contact.summary.change, contact.summary.name], ["needs_approval", "add", "Nordic Parts"]);
  await ok("POST", `/v1/approvals/${contact.approval}`, { token: alice.session, body: { decision: "deny" } });
  assert.equal((await ok("GET", "/v1/me/contacts", { token: bot.key })).contacts.length, 0);
  assert.equal((await ok("GET", `/v1/me/approvals/${contact.approval}`, { token: bot.key })).approval.status, "denied");

  // Through MCP the agent hears it waits, and why.
  const rpc = body => local.call("POST", "/mcp", { token: bot.key, body: { jsonrpc: "2.0", ...body } });
  const viaMcp = JSON.parse((await rpc({ id: 1, method: "tools/call", params: { name: "mail_send", arguments: { to: friendMail, subject: "Via MCP", text: "Hello" } } })).body.result.content[0].text);
  assert.equal(viaMcp.status, "needs_approval");
  assert.match(viaMcp.message, /asked to approve this first/);

  // Unless the owner chose, texts and calls to real numbers ask first.
  const { asksFirst } = loadModule("shared.ts");
  assert.equal(asksFirst({ ask_first: {} }, "sms", "live"), true);
  assert.equal(asksFirst({ ask_first: {} }, "call", "test"), false);
  assert.equal(asksFirst({ ask_first: { call: false } }, "call", "live"), false);
  assert.equal(asksFirst({ ask_first: {} }, "mail", "live"), false);
});
