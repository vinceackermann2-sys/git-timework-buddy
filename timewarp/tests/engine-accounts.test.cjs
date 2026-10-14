"use strict";
// Accounts on one computer keep their own data, and an account's agents,
// memory, instructions, skills, settings and connected-app access follow it
// to its other computers (accounts.cjs, account-sync.cjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { openStore } = require("../app/main/store.cjs");
const { createAgents } = require("../app/main/agents.cjs");
const { createAccounts, ACCOUNT_SETTINGS, SYNCED_SETTINGS } = require("../app/main/accounts.cjs");
const sync = require("../app/main/account-sync.cjs");
const { fixtureCloudStore } = require("../app/main/fixture.cjs");
const { createMcp } = require("../app/main/mcp.cjs");

const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000b2";
const read = file => fs.readFileSync(file, "utf8");
// Windows stamps file times from a clock that may move only every 15.6 ms, so
// an edit right after sync wrote a file can keep the same times. A person's
// edit comes later than that.
const laterEdit = () => new Promise(resolve => setTimeout(resolve, 20));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A computer: its own profile (database and runtime folder), wired as main.cjs
// wires it, with connected-app access kept in memory.
function computer(t, cloudStore = fixtureCloudStore(null)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timewarp-accounts-"));
  const runtimeDir = path.join(root, "runtime");
  const store = openStore(path.join(root, "timewarp.sqlite"));
  let user = null, privacy = false;
  const accounts = createAccounts({ store, runtimeDir });
  const signedIn = () => { if (user) accounts.claim(user); return user; };
  store.settings.scopeTo(signedIn, ACCOUNT_SETTINGS);
  store.browserProfiles.scopeTo(signedIn, () => accounts.legacyOwner());
  const agents = createAgents({ store, root: path.join(runtimeDir, "agents"), userId: () => user });
  const access = {};
  const integrations = {
    accessMap: account => ({ ...(access[account] || {}) }),
    restoreAccess: (account, agentId, items) => { access[account] ||= {}; if (items === undefined) delete access[account][agentId]; else access[account][agentId] = items; },
  };
  const folders = account => accounts.paths(account);
  const logs = [];
  const engine = sync.createAccountSync({
    store, userId: () => user, intervalMs: 1e9, paused: () => privacy, log: message => logs.push(message),
    cloud: async (account, route, input) => { assert.equal(route, "/account-data"); assert.equal(account, user, "Sent for the signed-in account"); return structuredClone(cloudStore.accountData(account, structuredClone(input))); },
    adapters: {
      setting: sync.settingsItems({ settings: store.settings, keys: SYNCED_SETTINGS }),
      agent: sync.agentItems({ store, agents }),
      "connector-access": sync.connectorAccess({ integrations, store }),
      instructions: sync.singleFile({ key: "AGENTS.md", file: account => path.join(folders(account).codexHome, "AGENTS.md") }),
      memory: sync.textFiles({ root: account => folders(account).memoriesRoot }),
      skill: sync.skillFolders({ root: account => path.join(folders(account).codexHome, "skills") }),
    },
  });
  t.after(async () => { engine.stop(); await agents.settled(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    store, accounts, agents, access, logs, runtimeDir, sync: () => engine.sync(),
    signIn(id) { user = id; }, set privacy(value) { privacy = value; },
    memory: (...parts) => path.join(folders(user).memoriesRoot, ...parts),
    codex: (...parts) => path.join(folders(user).codexHome, ...parts),
  };
}

test("the account with the most chats here keeps the computer's earlier data; another gets its own", t => {
  const device = computer(t);
  const { store, runtimeDir } = device;
  // Before accounts had their own: one Codex home, one memory folder, one set
  // of settings and browser profiles, used by every account.
  write(path.join(runtimeDir, "codex", "AGENTS.md"), "Earlier instructions\n");
  write(path.join(runtimeDir, "entities", "memories", "user.md"), "# User\n\nLikes tea.\n");
  store.settings.set("appearance", { scheme: "dark" });
  store.settings.set("memory", { mode: "read" });
  store.browserProfiles.create({ id: "work", label: "Work" });
  for (const [owner, count] of [[A, 2], [B, 1]]) {
    const agent = store.agents.create({ ownerId: owner, name: "Orbit", workspace: "/w/" + owner });
    for (let index = 0; index < count; index++) store.conversations.create({ ownerId: owner, agentId: agent.id });
  }

  // B signs in first, but A has the most chats: the earlier data is A's.
  device.signIn(B);
  assert.equal(device.accounts.paths(B).codexHome, path.join(runtimeDir, "accounts", B, "codex"));
  assert.equal(device.accounts.legacyOwner(), A);
  assert.equal(device.accounts.paths(A).codexHome, path.join(runtimeDir, "codex"));
  assert.equal(device.accounts.paths(A).memoriesRoot, path.join(runtimeDir, "entities", "memories"));
  assert.equal(store.settings.get("appearance"), null, "B doesn't see A's settings");
  store.settings.set("appearance", { scheme: "light" });
  assert.deepEqual(store.browserProfiles.list(), [], "None of A's profiles are B's");
  assert.equal(store.browserProfiles.ensureDefault().id, `timewarp:default:${B}`, "B's default profile has its own storage");
  assert.equal(store.browserProfiles.rename("work", "Mine"), null, "B can't change A's profiles");

  device.signIn(A);
  assert.deepEqual(store.settings.get("appearance"), { scheme: "dark" }, "A keeps the computer's earlier settings");
  assert.deepEqual(store.settings.get("memory"), { mode: "read" });
  assert.deepEqual(store.browserProfiles.list().map(profile => profile.label), ["Work"]);
  assert.equal(store.browserProfiles.ensureDefault().id, "timewarp:default");
  assert.equal(store.browserProfiles.get(`timewarp:default:${B}`).ownerId, B, "The browser itself still finds any profile's storage");

  device.signIn(null);
  assert.deepEqual(store.settings.get("appearance"), { scheme: "dark" }, "Signed out, the device's own copy shows");
  assert.equal(store.settings.all()["account:" + A + ":appearance"], undefined, "No account's copies are listed");
});

test("on a computer without earlier data, every account has its own folders", t => {
  const device = computer(t);
  device.signIn(A);
  assert.equal(device.accounts.paths(A).codexHome, path.join(device.runtimeDir, "accounts", A, "codex"));
  assert.equal(device.accounts.legacyOwner(), "");
  assert.throws(() => device.accounts.paths("../escape"), /Invalid account/);
  assert.equal(device.accounts.paths(null).codexHome, path.join(device.runtimeDir, "signed-out", "codex"));
});

test("an account's agents, memory, instructions, skills, settings and app access follow it to its other computer", async t => {
  const cloud = fixtureCloudStore(null);
  const first = computer(t, cloud), second = computer(t, cloud);
  first.signIn(A);
  const agent = first.agents.create({ name: "Scout", instructions: "Find flights." });
  first.agents.update(agent.id, { starred: true });
  write(first.memory("user.md"), "# User\n\nPrefers window seats.\n");
  write(first.memory("daily-logs", "2026-10-12.md"), "# 2026-10-12\n\nBooked Lisbon.\n");
  write(first.memory("imports", "claude-code", "CLAUDE.md"), "Use metric units.\n");
  fs.writeFileSync(first.memory("picture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  write(first.codex("AGENTS.md"), "Answer in Swedish.\n");
  write(first.codex("skills", "trip-planner", "SKILL.md"), "---\nname: trip-planner\ndescription: \"Plans trips\"\n---\n\nPlan it.\n");
  write(first.codex("skills", "trip-planner", "notes", "airlines.md"), "SAS, Norwegian\n");
  first.store.settings.set("appearance", { scheme: "dark", accent: "violet" });
  first.store.settings.set("privacy", { mode: "standard" });
  first.access[A] = { [agent.id]: [{ kind: "integration", integrationId: "composio-gmail", accountId: "conn-1", owner: "user" }] };
  const sent = await first.sync();
  assert.equal(sent, null);

  second.signIn(A);
  await second.sync();
  const copy = second.store.agents.get(agent.id);
  assert.equal(copy.name, "Scout");
  assert.equal(copy.instructions, "Find flights.");
  assert.equal(copy.ownerId, A);
  assert.ok(copy.starredAt);
  assert.match(read(path.join(copy.workspace, "AGENTS.md")), /^# Scout\n[\s\S]*Find flights\./, "Its workspace is made on this computer");
  assert.equal(read(second.memory("user.md")), "# User\n\nPrefers window seats.\n");
  assert.equal(read(second.memory("daily-logs", "2026-10-12.md")), "# 2026-10-12\n\nBooked Lisbon.\n");
  assert.equal(read(second.memory("imports", "claude-code", "CLAUDE.md")), "Use metric units.\n");
  assert.ok(!fs.existsSync(second.memory("picture.png")), "Files that aren't text stay on their computer");
  assert.equal(read(second.codex("AGENTS.md")), "Answer in Swedish.\n");
  assert.equal(read(second.codex("skills", "trip-planner", "notes", "airlines.md")), "SAS, Norwegian\n");
  assert.deepEqual(second.store.settings.get("appearance"), { scheme: "dark", accent: "violet" });
  assert.equal(second.store.settings.get("privacy"), null, "Privacy Mode is each computer's choice");
  assert.deepEqual(second.access[A][agent.id], [{ kind: "integration", integrationId: "composio-gmail", accountId: "conn-1", owner: "user" }]);

  // A change made on the second computer comes back; nothing else moves.
  second.agents.update(agent.id, { name: "Scout Two" });
  await second.sync();
  await first.sync();
  assert.equal(first.store.agents.get(agent.id).name, "Scout Two");
  const before = JSON.stringify(cloud.accountData(A, { operation: "changes", after: 0 }));
  await first.sync(); await second.sync();
  assert.equal(JSON.stringify(cloud.accountData(A, { operation: "changes", after: 0 })), before, "Unchanged items aren't sent again");
});

test("a change made on both computers at once is merged, and removals follow", async t => {
  const cloud = fixtureCloudStore(null);
  const first = computer(t, cloud), second = computer(t, cloud);
  first.signIn(A); second.signIn(A);
  write(first.memory("user.md"), "# User\n\n- Lives in Stockholm\n- Has a dog\n");
  for (let day = 1; day <= 5; day++) write(first.memory("daily-logs", `2026-10-0${day}.md`), `Day ${day}\n`);
  const agent = first.agents.create({ name: "Orbit" });
  await first.sync(); await second.sync();

  // Both computers change the notes and the agent before either syncs.
  await laterEdit();
  write(first.memory("user.md"), "# User\n\n- Lives in Stockholm\n- Has a dog called Rex\n- Drinks tea\n");
  write(second.memory("user.md"), "# User\n\n- Lives in Göteborg\n- Has a dog\n");
  first.agents.update(agent.id, { instructions: "Be brief." });
  second.agents.update(agent.id, { starred: true });
  await first.sync(); await second.sync(); await first.sync();
  const notes = read(first.memory("user.md"));
  assert.equal(notes, read(second.memory("user.md")), "Both computers end with the same notes");
  for (const line of ["- Lives in Göteborg", "- Has a dog called Rex", "- Drinks tea"]) assert.ok(notes.includes(line), "kept: " + line);
  assert.ok(!notes.includes("Stockholm"), "A line changed on one side and left alone on the other takes the change");
  for (const device of [first, second]) {
    const merged = device.store.agents.get(agent.id);
    assert.equal(merged.instructions, "Be brief.");
    assert.ok(merged.starredAt, "Different fields changed on each computer are both kept");
  }

  // A removed log is removed on the other computer too.
  fs.rmSync(first.memory("daily-logs", "2026-10-01.md"));
  await first.sync(); await second.sync();
  assert.ok(!fs.existsSync(second.memory("daily-logs", "2026-10-01.md")));
  // The whole memory folder gone at once isn't taken as removing everything.
  fs.rmSync(first.memory(), { recursive: true, force: true });
  await first.sync(); await second.sync();
  assert.ok(fs.existsSync(second.memory("daily-logs", "2026-10-05.md")), "The other computer keeps its memory");
  assert.match(first.logs.join("\n"), /left 5 memory items in the cloud/);
});

test("another account on the same computer starts with nothing of the first one's", async t => {
  const cloud = fixtureCloudStore(null);
  const device = computer(t, cloud);
  device.signIn(A);
  write(device.memory("user.md"), "A's notes\n");
  write(device.codex("AGENTS.md"), "A's instructions\n");
  device.agents.create({ name: "A's agent" });
  await device.sync();

  device.signIn(B);
  await device.sync();
  assert.ok(!fs.existsSync(device.memory("user.md")));
  assert.ok(!fs.existsSync(device.codex("AGENTS.md")));
  assert.deepEqual(device.store.agents.list(B), []);
  assert.deepEqual(cloud.accountData(B, { operation: "changes", after: 0 }).items, [], "Nothing of A's went to B's cloud copy");
  write(device.memory("user.md"), "B's notes\n");
  await device.sync();
  device.signIn(A);
  await device.sync();
  assert.equal(read(device.memory("user.md")), "A's notes\n");
});

test("secrets, oversized files and Privacy Mode keep items on the computer", async t => {
  const cloud = fixtureCloudStore(null);
  const device = computer(t, cloud);
  device.signIn(A);
  write(device.memory("card.md"), "Card 4242 4242 4242 4242\n");
  write(device.memory("big.md"), "x".repeat(300 * 1024));
  write(device.memory("user.md"), "Fine\n");
  await device.sync();
  assert.deepEqual(cloud.accountData(A, { operation: "changes", after: 0 }).items.map(item => item.key), ["user.md"]);
  assert.match(device.logs.join("\n"), /kept a memory item on this computer \(private\)/);
  device.privacy = true;
  write(device.memory("user.md"), "Private now\n");
  await device.sync();
  assert.equal(cloud.accountData(A, { operation: "changes", after: 0 }).items[0].value.text, "Fine\n");
});

test("a write refused because the cloud's copy changed is merged and sent again", async t => {
  const cloud = fixtureCloudStore(null);
  const device = computer(t, cloud);
  device.signIn(A);
  write(device.memory("user.md"), "one\n");
  await device.sync();
  // Another computer wrote meanwhile.
  const [stored] = cloud.accountData(A, { operation: "changes", after: 0 }).items;
  cloud.accountData(A, { operation: "put", items: [{ kind: "memory", key: "user.md", value: { text: "one\nfrom elsewhere\n" }, base: stored.revision }] });
  write(device.memory("user.md"), "one\nfrom here\n");
  // This computer sends before it has read the other change.
  const put = cloud.accountData(A, { operation: "put", items: [{ kind: "memory", key: "user.md", value: { text: "stale" }, base: stored.revision }] });
  assert.equal(put.results[0].conflict, true);
  await device.sync();
  const final = cloud.accountData(A, { operation: "changes", after: 0 }).items.find(item => item.key === "user.md").value.text;
  assert.equal(final, read(device.memory("user.md")));
  assert.match(final, /from elsewhere/);
  assert.match(final, /from here/);
});

test("text merges keep both sides' lines where they changed the same place", () => {
  assert.equal(sync.mergeText("a\nb\nc", "a\nB\nc", "a\nb\nC"), "a\nB\nC");
  assert.equal(sync.mergeText("a\nb", "a\nb\nmine", "a\nb\ntheirs"), "a\nb\ntheirs\nmine");
  assert.equal(sync.mergeText("a\nb", "a\nX", "a\nX"), "a\nX");
  assert.equal(sync.mergeText("", "local only", ""), "local only");
  assert.deepEqual(sync.merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }), { a: 2, b: 3 });
  assert.deepEqual(sync.merge3(null, { scheme: "dark" }, { scheme: "system" }), { scheme: "system" }, "A value that isn't text takes the cloud's");
  assert.deepEqual(sync.merge3({ archivedAt: null }, { archivedAt: "2026-10-12T10:00:00Z" }, { archivedAt: "2026-10-12T11:00:00Z" }), { archivedAt: "2026-10-12T11:00:00Z" });
  assert.deepEqual(sync.merge3({ instructions: "a" }, { instructions: "a\nb" }, { instructions: "a\nc" }), { instructions: "a\nc\nb" }, "Responsibilities merge as text");
  assert.deepEqual(sync.merge3({ files: { "SKILL.md": "x" } }, { files: { "SKILL.md": "x\nmine" } }, { files: { "SKILL.md": "x\ntheirs" } }), { files: { "SKILL.md": "x\ntheirs\nmine" } });
  assert.deepEqual(sync.merge3({ text: "x" }, null, { text: "y" }), { text: "y" }, "An edit wins over a removal");
  assert.deepEqual(sync.merge3({ text: "x" }, { text: "z" }, null), { text: "z" });
  assert.equal(sync.merge3(null, null, null), null);
  assert.equal(sync.digest({ a: null }), sync.digest({}), "A field set to nothing is no field");
});

test("MCP servers added by address follow the account without sign-ins, headers or commands", async () => {
  const config = {
    docs: { url: "https://mcp.example.com/sse", enabled: false, bearer_token_env_var: "DOCS_TOKEN" },
    local: { url: "http://localhost:3000/mcp" },
    secret: { url: "https://api.example.com/mcp", http_headers: { Authorization: "Bearer abc" } },
    files: { command: "npx", args: ["server"] },
    timewarp_browser: { url: "http://127.0.0.1:1/browser" },
  };
  const writes = [];
  const client = {
    on() {},
    request: async (method, params) => {
      if (method === "config/read") return { config: { mcp_servers: structuredClone(config) } };
      if (method === "config/value/write") { writes.push(params); const name = params.keyPath.split(".")[1]; if (params.value === null) delete config[name]; else config[name] = params.value; return {}; }
      return {};
    },
  };
  const mcp = createMcp({ client, openExternal: async () => {}, logout: async () => true });
  assert.deepEqual(await mcp.shared(), { servers: { docs: { url: "https://mcp.example.com/sse", enabled: false, bearerTokenEnvVar: "DOCS_TOKEN" } }, kept: ["local", "secret", "files"] }, "Servers that can't be carried are kept here");
  await assert.rejects(mcp.shared({ guard: () => { throw new Error("The active account changed."); } }), /account changed/, "Nothing is read once another account is signed in");
  await mcp.applyShared("linear", { url: "https://mcp.linear.app/mcp", enabled: true, envHttpHeaders: { "X-Team": "LINEAR_TEAM", "Bad Header": "x" } });
  assert.deepEqual(config.linear, { url: "https://mcp.linear.app/mcp", enabled: true, env_http_headers: { "X-Team": "LINEAR_TEAM" } });
  await mcp.applyShared("files", { url: "https://elsewhere.example.com/mcp", enabled: true });
  assert.deepEqual(config.files, { command: "npx", args: ["server"] }, "A command server here keeps its name");
  await mcp.applyShared("evil", { url: "http://192.168.1.2/mcp" });
  assert.equal(config.evil, undefined, "Local network servers aren't carried");
  await mcp.applyShared("lookalike", { url: "https://mcp.example.net/mcp", bearerTokenEnvVar: "TIMEWARP_TOOLS_TOKEN", envHttpHeaders: { "X-Key": "timewarp_bridge_token", "X-Team": "TEAM" } });
  assert.deepEqual(config.lookalike, { url: "https://mcp.example.net/mcp", enabled: true, env_http_headers: { "X-Team": "TEAM" } }, "Timewarp's own tokens never go to a synced server");
  await mcp.applyShared("docs", null);
  assert.equal(config.docs, undefined);
});

// The cloud function's route, run with its database calls answered here.
function cloudModule() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, "..", "cloud", "accountData.ts"), "utf8"), { mode: "strip" })
    .replace(/^import[^\n]*\n/gm, "").replace(/export const /g, "var ").replace(/export /g, "");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context;
}
test("the cloud's account data route pages changes by size and checks what it stores", async () => {
  const { accountData, MAX_ITEM } = cloudModule();
  const rows = Array.from({ length: 4 }, (_, index) => ({ kind: "memory", key: `file-${index}.md`, revision: index + 1, value: { text: "x".repeat(700 * 1024) } }));
  const calls = [];
  const admin = {
    from: () => {
      const query = { filters: [] };
      const chain = { select: () => chain, eq: (column, value) => { query.filters.push([column, value]); return chain; }, gt: (column, value) => { query.after = value; return chain; }, order: () => chain,
        limit: async limit => ({ data: rows.filter(row => row.revision > query.after).slice(0, limit), error: null }) };
      return chain;
    },
    rpc: async (name, params) => { calls.push({ name, params }); return { data: params.p_items.map((item, index) => index === 1 ? { kind: item.kind, key: item.key, conflict: true, revision: 9, value: { text: "theirs" } } : { kind: item.kind, key: item.key, revision: 10 + index }), error: null }; },
  };
  const user = { id: A };
  const first = await accountData(admin, user, { operation: "changes", after: 0 });
  assert.deepEqual([...first.items.map(item => item.revision)], [1, 2], "A page stops near 1.5 MB");
  assert.equal(first.cursor, 2);
  assert.equal(first.more, true);
  const last = await accountData(admin, user, { operation: "changes", after: 2 });
  assert.deepEqual([last.items.length, last.cursor, last.more], [2, 4, false]);
  const put = await accountData(admin, user, { operation: "put", items: [{ kind: "agent", key: "a", value: { name: "Orbit" }, base: 0 }, { kind: "memory", key: "user.md", value: null, base: 3 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(put.results)), [{ kind: "agent", key: "a", revision: 10 }, { kind: "memory", key: "user.md", conflict: true, revision: 9, value: { text: "theirs" } }]);
  assert.equal(calls[0].params.p_user, A);
  await assert.rejects(accountData(admin, user, { operation: "put", items: [{ kind: "vault", key: "x", value: {} }] }), /Invalid account data item/);
  await assert.rejects(accountData(admin, user, { operation: "put", items: [{ kind: "memory", key: "x", value: { text: "y".repeat(MAX_ITEM) } }] }), error => error.status === 413);
  await assert.rejects(accountData(admin, user, { operation: "put", items: Array.from({ length: 26 }, (_, index) => ({ kind: "memory", key: "k" + index, value: null })) }), /Invalid account data/);
  await assert.rejects(accountData(admin, user, { operation: "drop" }), /Invalid account data action/);
});

test("items that can't be carried stay on their computer and aren't taken as removed", async t => {
  const cloud = fixtureCloudStore(null);
  const first = computer(t, cloud), second = computer(t, cloud);
  first.signIn(A); second.signIn(A);
  const skill = text => `---\nname: tidy\ndescription: "Tidies"\n---\n\n${text}\n`;
  write(first.memory("user.md"), "Short\n");
  write(first.codex("skills", "tidy", "SKILL.md"), skill("Tidy up."));
  await first.sync(); await second.sync();
  assert.ok(fs.existsSync(second.codex("skills", "tidy", "SKILL.md")));
  // Finder's file in the skill doesn't count.
  fs.writeFileSync(first.codex("skills", "tidy", ".DS_Store"), Buffer.from([0, 1, 2]));
  write(first.codex("skills", "tidy", "SKILL.md"), skill("Tidy up, twice."));
  await first.sync(); await second.sync();
  assert.match(read(second.codex("skills", "tidy", "SKILL.md")), /twice/);
  // The skill gets a picture and the notes grow past what's carried.
  fs.writeFileSync(first.codex("skills", "tidy", "logo.png"), Buffer.from([0x89, 0x50, 0, 0]));
  write(first.memory("user.md"), "x".repeat(600 * 1024));
  await first.sync(); await second.sync();
  assert.ok(fs.existsSync(second.codex("skills", "tidy", "SKILL.md")), "A skill that can't be carried any more isn't removed elsewhere");
  assert.equal(read(second.memory("user.md")), "Short\n", "Nor are notes that grew too large");
  assert.ok(cloud.accountData(A, { operation: "changes", after: 0 }).items.every(item => item.value !== null), "No removal was sent");
});

test("agents from the cloud need plain ids, and an item that can't be applied stops holding up the rest", async t => {
  const cloud = fixtureCloudStore(null);
  const device = computer(t, cloud);
  device.signIn(A);
  cloud.accountData(A, { operation: "put", items: [
    { kind: "agent", key: "../../escape", value: { name: "Escape" }, base: 0 },
    { kind: "connector-access", key: "../x", value: { items: null }, base: 0 },
    { kind: "memory", key: "user.md", value: { text: "Hello\n" }, base: 0 },
  ] });
  await device.sync();
  assert.deepEqual(device.store.agents.list(A), []);
  assert.ok(!fs.existsSync(path.join(device.runtimeDir, "..", "escape")));
  assert.equal(read(device.memory("user.md")), "Hello\n");
  // A file that can't be written here (a folder is in its place) is tried a few times, then waits.
  fs.mkdirSync(device.memory("daily-logs", "2026-10-12.md"), { recursive: true });
  const [{ revision }] = cloud.accountData(A, { operation: "put", items: [{ kind: "memory", key: "daily-logs/2026-10-12.md", value: { text: "Day\n" }, base: 0 }] }).results;
  for (let pass = 0; pass < 4; pass++) await device.sync();
  assert.equal(device.store.accountSync.cursor(A), revision, "The cursor moved on after the attempts");
  assert.match(device.logs.join("\n"), /couldn't apply a memory item/);
});
