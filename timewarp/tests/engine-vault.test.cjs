"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore } = require("../app/main/store.cjs");
const { createVault, matchesSite, siteOf } = require("../app/main/vault.cjs");
const { createVaultTools, cardValue } = require("../app/main/vault-tools.cjs");

// Reversible stand-in for safeStorage, so tests can see what is stored.
const cipher = { available: () => true, encrypt: text => "enc:" + Buffer.from(text).toString("base64"), decrypt: value => Buffer.from(value.slice(4), "base64").toString() };

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let user = "user-1";
  return { store, vault: createVault({ store, cipher, userId: () => user }), switchUser: id => { user = id; } };
}

test("sites match on protocol, port and host (ignoring www.), as in the previous app", () => {
  assert.equal(siteOf("example.com"), "https://example.com");
  assert.equal(siteOf("http://localhost:3000/login"), "http://localhost:3000");
  assert.equal(siteOf("localhost:3000"), "http://localhost:3000");
  for (const other of ["ftp://example.com", "javascript:alert(1)", "file:///C:/x", "http://"]) assert.equal(siteOf(other), null, other);
  assert.ok(matchesSite("https://www.example.com", "https://example.com/login"));
  assert.ok(matchesSite("https://example.com", "https://www.example.com/login"));
  assert.ok(matchesSite("https://example.com", "https://EXAMPLE.com:443/"), "The default port is the same port");
  assert.ok(matchesSite("http://localhost:3000", "http://localhost:3000/app"));
  assert.ok(!matchesSite("https://wordpress.com", "https://evil.wordpress.com/"), "Not on a subdomain");
  assert.ok(!matchesSite("https://example.com", "https://accounts.example.com/"));
  assert.ok(!matchesSite("http://localhost:3000", "http://localhost:5173/"), "Not on another port");
  assert.ok(!matchesSite("https://example.com", "https://example.com:8443/"));
  assert.ok(!matchesSite("https://example.com", "https://example.com.evil.test/"));
  assert.ok(!matchesSite("https://example.com", "https://notexample.com/"));
  assert.ok(!matchesSite("https://example.com", "http://example.com/"));
});

test("notes and card details are sealed with the item; only what lists it stays readable", t => {
  const { store, vault } = setup(t);
  const login = vault.create({ kind: "password", site: "example.com", username: "ada", password: "pw-1", notes: "recovery: 1111-2222" });
  const card = vault.create({ kind: "card", number: "4242424242424242", expMonth: 8, expYear: 2029, cardholder: "Ada Lovelace", notes: "work card" });
  const raw = store.db.prepare("select * from vault_entries").all();
  const readable = JSON.stringify(raw.map(({ secret, ...rest }) => rest));
  for (const hidden of ["recovery", "work card", "Ada Lovelace", "2029"]) assert.ok(!readable.includes(hidden), hidden + " isn't stored readable");
  assert.deepEqual(JSON.parse(raw.find(item => item.id === card.id).metadata), { ownerId: "user-1", brand: "Visa", last4: "4242" });
  const listed = vault.list();
  assert.equal(listed.find(item => item.id === login.id).notes, "recovery: 1111-2222", "The user's own list shows them");
  assert.deepEqual(["expMonth", "expYear", "cardholder"].map(key => listed.find(item => item.id === card.id)[key]), [8, 2029, "Ada Lovelace"]);
  vault.update(card.id, { expYear: 2030 });
  assert.deepEqual([vault.secret(card.id).number, vault.secret(card.id).expYear, vault.secret(card.id).cardholder], ["4242424242424242", 2030, "Ada Lovelace"]);
});

test("an item changed in the database fails its integrity check instead of filling elsewhere", t => {
  const { store, vault } = setup(t);
  const login = vault.create({ kind: "password", site: "bank.example", username: "ada", password: "pw-bank" });
  const other = vault.create({ kind: "password", site: "mail.example", username: "ada", password: "pw-mail" });
  assert.equal(vault.signInsFor("https://bank.example/login").length, 1);
  store.db.prepare("update vault_entries set origin = ? where id = ?").run("https://evil.test", login.id);
  assert.throws(() => vault.secret(login.id), /integrity check/);
  assert.deepEqual(vault.signInsFor("https://evil.test/"), [], "Not offered on the site it was moved to");
  assert.equal(vault.list().find(item => item.id === login.id).damaged, true);
  // A secret copied from another item doesn't open either.
  const { secret } = store.db.prepare("select secret from vault_entries where id = ?").get(other.id);
  store.db.prepare("update vault_entries set origin = ?, secret = ? where id = ?").run("https://bank.example", secret, login.id);
  assert.throws(() => vault.secret(login.id), /integrity check/);
  assert.throws(() => vault.update(login.id, { label: "Bank" }), /integrity check/);
  assert.deepEqual(vault.remove(login.id), { removed: true }, "It can still be removed");
});

test("items saved before sealing are sealed when the vault opens, keeping their values", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-"));
  const store = openStore(path.join(root, "timewarp.sqlite"));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const at = new Date().toISOString(), insert = store.db.prepare("insert into vault_entries(id, kind, label, origin, username, metadata, secret, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)");
  insert.run("old-1", "password", "Mail", "https://mail.example", "ada", JSON.stringify({ ownerId: "user-1", notes: "codes: 1234" }), cipher.encrypt(JSON.stringify({ password: "pw" })), at, at);
  insert.run("old-2", "card", "Visa •••• 4242", null, null, JSON.stringify({ ownerId: "user-1", notes: "", brand: "Visa", last4: "4242", expMonth: 4, expYear: 2031, cardholder: "Ada" }), cipher.encrypt(JSON.stringify({ number: "4242424242424242" })), at, at);
  const vault = createVault({ store, cipher, userId: () => "user-1" });
  const rows = store.db.prepare("select * from vault_entries order by id").all();
  assert.ok(rows.every(item => item.secret.startsWith("sealed:v2:")));
  assert.deepEqual(rows.map(item => JSON.parse(item.metadata)), [{ ownerId: "user-1" }, { ownerId: "user-1", brand: "Visa", last4: "4242" }]);
  assert.deepEqual([vault.secret("old-1").password, vault.secret("old-1").notes], ["pw", "codes: 1234"]);
  assert.deepEqual([vault.secret("old-2").number, vault.secret("old-2").expMonth, vault.secret("old-2").expYear, vault.secret("old-2").cardholder], ["4242424242424242", 4, 2031, "Ada"]);
});

test("sign-ins for plain-http sites (routers, storage boxes, intranets) are kept and fill over http only", t => {
  const { vault } = setup(t);
  assert.equal(siteOf("http://192.168.1.1/login.html"), "http://192.168.1.1");
  assert.equal(siteOf("http://nas.local:5000"), "http://nas.local:5000");
  const router = vault.create({ kind: "password", site: "http://192.168.1.1/login.html", username: "admin", password: "router-pass" });
  assert.equal(router.origin, "http://192.168.1.1");
  assert.deepEqual(vault.signInsFor("http://192.168.1.1/status").map(item => item.id), [router.id]);
  assert.deepEqual(vault.signInsFor("https://192.168.1.1/"), [], "Never on another protocol");
  vault.create({ kind: "password", site: "intranet.example", username: "ada", password: "secure-pass" });
  assert.deepEqual(vault.signInsFor("http://intranet.example/").map(item => item.origin), [], "An https sign-in doesn't fill over http");
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
  const fields = [];
  const browserTools = { pageUrl: () => page, fillSecret: async (_conversation, { ref, value, field }) => { typed.push([ref, value]); fields.push(field); return page; } };
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
  // The number is looked for anywhere on the page; the expiry only in its field.
  assert.deepEqual(fields.slice(-2), [undefined, "detail"]);
  assert.match(cardFilled.contentItems[0].text, /type the security code/);
  assert.equal(asked.length, 3);

  const saved = await call("save_sign_in", { site: "new.example", username: "ada", password: "generated-1" });
  assert.match(saved.contentItems[0].text, /Saved the sign-in for https:\/\/new\.example/);
  assert.equal(vault.list().find(item => item.origin === "https://new.example").createdByAgent, "agent-1");
});

test("card details go in as each field takes them: list options, two- or four-digit years", () => {
  const card = { number: "4242424242424242", expMonth: 8, expYear: 2029, cardholder: "Ada" };
  const list = options => ({ tag: "select", options: options.map(([value, text]) => ({ value, text })) });
  assert.deepEqual(cardValue("month", list([["", "Month"], ["7", "07"], ["8", "08"], ["9", "09"]]), card), { option: "8" });
  assert.deepEqual(cardValue("month", list([["jul", "July"], ["aug", "August"]]), card), { option: "aug" });
  assert.deepEqual(cardValue("month", list([["10", "10 - October"], ["08", "08 - August"]]), card), { option: "08" });
  assert.deepEqual(cardValue("year", list([["28", "2028"], ["29", "2029"]]), card), { option: "29" });
  assert.deepEqual(cardValue("year", list([["", "YY"], ["29", "29"]]), card), { option: "29" });
  assert.equal(cardValue("year", list([["2030", "2030"]]), card), null);
  assert.deepEqual(cardValue("year", { tag: "input", maxLength: 2 }, card), { text: "29" });
  assert.deepEqual(cardValue("year", { tag: "input", maxLength: -1, placeholder: "YY" }, card), { text: "29" });
  assert.deepEqual(cardValue("year", { tag: "input", maxLength: -1, placeholder: "Year" }, card), { text: "2029" });
  assert.deepEqual(cardValue("expiry", null, card), { text: "08/29" });
  assert.deepEqual(cardValue("expiry", { tag: "input", maxLength: 4 }, card), { text: "0829" });
  assert.deepEqual(cardValue("expiry", { tag: "input", maxLength: -1, placeholder: "MM/YYYY" }, card), { text: "08/2029" });
  assert.deepEqual(cardValue("expiry", { tag: "input", type: "month" }, card), { text: "2029-08" });
});

test("a card fill reads its fields back and reports what didn't go in, without the values", async t => {
  const { vault, store } = setup(t);
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Nova", workspace: os.tmpdir() });
  const card = vault.create({ kind: "card", number: "4242424242424242", expMonth: 8, expYear: 2029, cardholder: "Ada Lovelace" });
  const months = [{ value: "", text: "Month" }, ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), text: String(index + 1).padStart(2, "0") }))];
  // A checkout form as the page reports it; inputs keep only what fits.
  const page = {
    n: { tag: "input", type: "text", maxLength: 19, value: "" }, m: { tag: "select", options: months, value: "" },
    y: { tag: "input", type: "text", maxLength: 2, value: "" }, name: { tag: "input", type: "text", maxLength: -1, value: "" },
    ys: { tag: "select", options: [{ value: "", text: "Year" }, { value: "2028", text: "2028" }], value: "" },
  };
  const browserTools = {
    pageUrl: () => "https://shop.example/pay",
    inspectField: async (_conversation, { ref }) => ({ ...page[ref] }),
    fillSecret: async (_conversation, { ref, value, choose }) => {
      const field = page[ref];
      if (choose) { if (!field.options.some(option => option.value === value)) throw Object.assign(new Error("That option isn't in the list."), { status: 400 }); field.value = value; }
      else field.value = field.maxLength > 0 ? String(value).slice(0, field.maxLength) : String(value);
    },
  };
  const tools = createVaultTools({ vault, browserTools, ask: async () => true });
  const call = args => tools.call("chat-1", { tool: "fill_card", arguments: { item: card.id, ...args } }, { ...store.agents.get("agent-1"), vaultAccess: true });
  const filled = await call({ number_ref: "n", exp_month_ref: "m", exp_year_ref: "y", name_ref: "name" });
  assert.equal(filled.success, true);
  assert.deepEqual([page.n.value, page.m.value, page.y.value, page.name.value], ["4242424242424242", "8", "29", "Ada Lovelace"]);
  page.n.maxLength = 12;
  const partly = await call({ number_ref: "n", exp_year_ref: "ys" });
  assert.equal(partly.success, false);
  assert.match(partly.contentItems[0].text, /except the card number \(the field doesn't show it as given\) and the expiry year \(its list has no matching option\)/);
  assert.ok(!partly.contentItems[0].text.includes("424242"));
});

test("a field in a frame from another site needs the user's say for a sign-in, and the prompt names that site", async t => {
  const { vault, store } = setup(t);
  store.agents.create({ id: "agent-1", ownerId: "user-1", name: "Nova", workspace: os.tmpdir() });
  const login = vault.create({ kind: "password", site: "example.com", username: "ada", password: "s3cret-pass" });
  const card = vault.create({ kind: "card", number: "4242424242424242", expMonth: 8, expYear: 2029 });
  // e1 and e2 are on the page; e9 is in a frame another site put on it.
  const frames = { e1: "https://example.com/login", e2: "https://example.com/login", e9: "https://widgets.other.test/form" };
  const typed = [], asked = [];
  let allow = false;
  const browserTools = { pageUrl: () => "https://example.com/login", fieldUrl: (_conversation, { ref }) => frames[ref], fillSecret: async (_conversation, { ref, value }) => { typed.push([ref, value]); } };
  const tools = createVaultTools({ vault, browserTools, ask: async message => { asked.push(message); return allow; } });
  const call = (tool, args) => tools.call("chat-1", { tool, arguments: args }, { ...store.agents.get("agent-1"), vaultAccess: true });
  await call("fill_sign_in", { item: login.id, username_ref: "e1", password_ref: "e2" });
  assert.deepEqual(asked, [], "Page and fields on the sign-in's site");
  const refused = await call("fill_sign_in", { item: login.id, username_ref: "e1", password_ref: "e9" });
  assert.equal(refused.success, false);
  assert.deepEqual(asked, ["Nova wants to use your example.com sign-in on example.com (in a form from widgets.other.test)."]);
  assert.ok(!typed.some(([ref]) => ref === "e9"), "Nothing typed into the other site's frame");
  allow = true;
  await call("fill_card", { item: card.id, number_ref: "e9" });
  assert.match(asked.at(-1), /ending 4242 on example\.com \(in a form from widgets\.other\.test\)\.$/);
  assert.deepEqual(typed.at(-1), ["e9", "4242424242424242"]);
});

test("the toolbar fill skips new-password, code and search fields, and stops if the page moved", () => {
  const { JSDOM } = require("jsdom");
  const { fillSignIn } = require("../app/main/methods.cjs");
  const fill = (html, origin = "https://example.com") => {
    const dom = new JSDOM(html, { url: "https://example.com/login", runScripts: "outside-only" });
    // jsdom lays nothing out: every field counts as shown.
    dom.window.Element.prototype.getClientRects = () => [{}];
    const filled = dom.window.eval(`(${fillSignIn})("ada@example.com", "pw-1", ${JSON.stringify(origin)})`);
    const values = Object.fromEntries([...dom.window.document.querySelectorAll("input")].map(input => [input.name, input.value]));
    return { filled, values };
  };
  assert.deepEqual(fill(`<input name="q" type="search"><form><input name="otp" autocomplete="one-time-code"><input name="email" type="email"><input name="password" type="password"></form>`),
    { filled: true, values: { q: "", otp: "", email: "ada@example.com", password: "pw-1" } });
  assert.deepEqual(fill(`<form><input name="user"><input name="new" type="password" autocomplete="new-password"></form>`),
    { filled: false, values: { user: "", new: "" } }, "A sign-up or change-password form gets nothing");
  assert.deepEqual(fill(`<form><input name="user"><input name="current" type="password" autocomplete="current-password"><input name="next" type="password" autocomplete="new-password"></form>`).values,
    { user: "ada@example.com", current: "pw-1", next: "" });
  assert.deepEqual(fill(`<input name="q">`), { filled: false, values: { q: "" } }, "Without a password field, only a username-like field");
  assert.deepEqual(fill(`<input name="login" type="email">`).values, { login: "ada@example.com" });
  assert.equal(fill(`<form><input name="u"><input name="p" type="password"></form>`, "https://other.example").filled, false);
});
