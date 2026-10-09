"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createVault, matchesSite, siteOf } = require("../app/main/vault.cjs");
const { createVaultTools } = require("../app/main/vault-tools.cjs");

// Reversible stand-in for safeStorage, so tests can see what is stored.
const cipher = { available: () => true, encrypt: text => "enc:" + Buffer.from(text).toString("base64"), decrypt: value => Buffer.from(value.slice(4), "base64").toString() };

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let user = "user-1";
  return { store, vault: createVault({ store, cipher, userId: () => user }), switchUser: id => { user = id; } };
}

test("sites match their own host and subdomains only", () => {
  assert.equal(siteOf("example.com"), "https://example.com");
  assert.equal(siteOf("http://example.com"), null);
  assert.equal(siteOf("http://localhost:3000/login"), "http://localhost:3000");
  assert.equal(siteOf("localhost:3000"), "http://localhost:3000");
  assert.ok(matchesSite("https://www.example.com", "https://example.com/login"));
  assert.ok(matchesSite("https://example.com", "https://accounts.example.com/"));
  assert.ok(!matchesSite("https://example.com", "https://example.com.evil.test/"));
  assert.ok(!matchesSite("https://example.com", "https://notexample.com/"));
  assert.ok(!matchesSite("https://example.com", "http://example.com/"));
});

test("items are encrypted, listed without values and scoped to their account", t => {
  const { store, vault, switchUser } = setup(t);
  const login = vault.create({ kind: "password", site: "example.com", username: "ada@example.com", password: "correct horse" });
  const card = vault.create({ kind: "card", number: "4242 4242 4242 4242", cvc: "123", expMonth: 8, expYear: 2029, cardholder: "Ada Lovelace" });
  assert.equal(card.label, "Visa •••• 4242");
  const stored = store.db.prepare("select secret from vault_entries").all().map(row => row.secret).join(" ");
  assert.ok(!stored.includes("correct horse") && !stored.includes("4242424242424242"), "Values are stored encrypted");
  assert.ok(!JSON.stringify(vault.list()).includes("correct horse"));
  assert.equal(vault.secret(login.id).password, "correct horse");
  assert.equal(vault.secret(card.id).number, "4242424242424242");
  assert.throws(() => vault.create({ kind: "card", number: "4242 4242 4242 4241", expMonth: 1, expYear: 2030 }), /card number/);
  vault.update(login.id, { username: "ada@work.example" });
  assert.equal(vault.secret(login.id).password, "correct horse", "Editing other fields keeps the password");
  switchUser("user-2");
  assert.deepEqual(vault.list(), []);
  assert.throws(() => vault.secret(login.id), /no longer exists/);
});

test("vault tools fill values without returning them and ask before cards", async t => {
  const { vault, store } = setup(t);
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Nova", workspace: os.tmpdir() });
  const login = vault.create({ kind: "password", site: "example.com", username: "ada", password: "s3cret-pass" });
  const card = vault.create({ kind: "card", number: "4242424242424242", cvc: "123", expMonth: 8, expYear: 2029 });
  let page = "https://example.com/login", allow = false;
  const typed = [], asked = [];
  const browserTools = { pageUrl: () => page, fillSecret: async (_conversation, { ref, value }) => { typed.push([ref, value]); return page; } };
  const tools = createVaultTools({ vault, browserTools, ask: async message => { asked.push(message); return allow; } });
  const call = (tool, args, agent = { ...store.agents.get("agent-1"), vaultAccess: true }) => tools.call("chat-1", { tool, arguments: args }, agent);

  await assert.rejects(call("list", {}, store.agents.get("agent-1")), /doesn't have vault access/);
  const listed = await call("list", {});
  assert.ok(!JSON.stringify(listed).includes("s3cret-pass") && !JSON.stringify(listed).includes("4242424242424242"));

  const filled = await call("fill_sign_in", { item: login.id, username_ref: "e1", password_ref: "e2" });
  assert.deepEqual(typed, [["e1", "ada"], ["e2", "s3cret-pass"]]);
  assert.ok(!JSON.stringify(filled).includes("s3cret-pass"));
  assert.deepEqual(asked, [], "A sign-in on its own site needs no prompt");

  page = "https://elsewhere.test/";
  const refused = await call("fill_sign_in", { item: login.id, password_ref: "e2" });
  assert.equal(refused.success, false);
  assert.equal(asked.length, 1);

  const declined = await call("fill_card", { item: card.id, number_ref: "e5" });
  assert.equal(declined.success, false);
  allow = true;
  const cardFilled = await call("fill_card", { item: card.id, number_ref: "e5", expiry_ref: "e6" });
  assert.deepEqual(typed.slice(-2), [["e5", "4242424242424242"], ["e6", "08/29"]]);
  assert.match(cardFilled.contentItems[0].text, /type the security code/);
  assert.equal(asked.length, 3);

  const saved = await call("save_sign_in", { site: "new.example", username: "ada", password: "generated-1" });
  assert.match(saved.contentItems[0].text, /Saved the sign-in for https:\/\/new\.example/);
  assert.equal(vault.list().find(item => item.origin === "https://new.example").createdByAgent, "agent-1");
});
