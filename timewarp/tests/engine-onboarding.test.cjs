"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOnboarding } = require("../app/main/onboarding.cjs");

const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };

// One computer's profile signed in to a cloud that remembers finished setups.
// Several computers can share one cloud.
// A failure is an HTTP status, or "offline" for a request that never arrives.
function cloudDouble({ finished = [], failures = [], completeFailures = [] } = {}) {
  return { finished: new Set(finished), failures: [...failures], completeFailures: [...completeFailures], calls: [] };
}
function computer(cloud = cloudDouble(), { profile = fs.mkdtempSync(path.join(os.tmpdir(), "tw-onboarding-")), user = "alice", askMs = 1000 } = {}) {
  let owner = user;
  const agents = [], values = new Map();
  const fail = failure => { throw Object.assign(new Error("Cloud request failed."), failure === "offline" ? {} : { status: failure }); };
  const services = {
    auth: { userId: () => owner, refreshUser: async () => {} },
    accountRpc: async (rpc, input) => {
      cloud.calls.push({ user: owner, rpc });
      if (rpc === "product.onboarding.status") await cloud.hold;
      const failure = rpc === "product.onboarding.status" ? cloud.failures.shift() : rpc === "product.onboarding.complete" ? cloud.completeFailures.shift() : null;
      if (failure) fail(failure);
      if (rpc === "product.onboarding.status") return { done: cloud.finished.has(owner) };
      if (rpc === "product.onboarding.complete") { cloud.finished.add(owner); return null; }
      if (rpc === "product.profile.update") return null;
      throw new Error("Unexpected " + rpc + " " + JSON.stringify(input));
    },
    cloudJson: async (route, input) => {
      if (route === "/billing/service" && input.action === "status") return { plan: "free", plans: [{ id: "free" }, { id: "max" }] };
      if (route === "/account") return { activeOrganization: { id: "org" } };
      throw new Error("Unexpected " + route);
    },
  };
  const onboarding = createOnboarding({
    profile, services, encryption, retryMs: 1, askMs,
    store: { settings: { get: key => values.get(key), set: (key, value) => values.set(key, value) } },
    agents: { list: () => agents, create: agent => agents.push(agent), update: () => {} },
    knowledge: { memoriesRoot: path.join(profile, "memories"), detect: async () => ({ items: [] }), importItems: async () => ({}) },
    browserImport: null, dialog: null, shell: { openExternal: async () => {} },
    defaultAppearance: () => ({ scheme: "system", accent: { hue: 200 }, radiance: 0.5 }),
  });
  return { onboarding, profile, signIn: id => { owner = id; } };
}
const statusCalls = cloud => cloud.calls.filter(call => call.rpc === "product.onboarding.status").length;
async function finishSetup(onboarding) {
  const run = onboarding.service.run;
  await run("agent", { name: "Orbit" });
  await run("user", { name: "Alex" });
  await run("knowledge-done");
  await run("theme", { scheme: "dark", color: "#3366ff" });
  await run("plans");
  await run("select-plan", { plan: "free" });
  return run("complete");
}

test("finishing setup on one computer skips it on another and after signing in again", async () => {
  const cloud = cloudDouble(), first = computer(cloud);
  assert.equal(await first.onboarding.done(), false);
  assert.equal((await finishSetup(first.onboarding)).completed, true);
  assert.ok(cloud.finished.has("alice"));
  // Signing out and back in on the same computer, which knows without asking.
  const before = statusCalls(cloud);
  first.signIn(null); assert.equal(await first.onboarding.done(), true);
  first.signIn("alice"); assert.equal(await first.onboarding.done(), true);
  assert.equal(statusCalls(cloud), before);

  const second = computer(cloud);
  assert.equal(await second.onboarding.done(), true);
  assert.equal((await second.onboarding.service.read()).completed, true);
  // The answer is kept on that computer too.
  const asked = statusCalls(cloud);
  assert.equal(await second.onboarding.done(), true);
  assert.equal(statusCalls(cloud), asked);
});

test("a computer that finished setup before tells the cloud once", async () => {
  const cloud = cloudDouble(), first = computer(cloud);
  await first.onboarding.skip();
  assert.equal(await first.onboarding.done(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(cloud.finished.has("alice"));
  const told = cloud.calls.length;
  // A later launch of the same profile doesn't tell it again.
  assert.equal(await computer(cloud, { profile: first.profile }).onboarding.done(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cloud.calls.length, told);
});

test("only the account that finished setup skips it", async () => {
  const cloud = cloudDouble({ finished: ["alice"] }), shared = computer(cloud);
  assert.equal(await shared.onboarding.done(), true);
  shared.signIn("bob");
  assert.equal(await shared.onboarding.done(), false);
  assert.equal((await shared.onboarding.service.read()).completed, false);
});

test("Run setup again runs it on this computer whatever the cloud says", async () => {
  const cloud = cloudDouble({ finished: ["alice"] }), { onboarding } = computer(cloud);
  assert.equal(await onboarding.done(), true);
  await onboarding.restart();
  assert.equal(await onboarding.done(), false);
  await finishSetup(onboarding);
  assert.equal(await onboarding.done(), true);
});

test("Run setup again while the cloud is still answering keeps setup to run", async () => {
  let answer;
  const cloud = cloudDouble({ finished: ["alice"] });
  cloud.hold = new Promise(resolve => { answer = resolve; });
  const { onboarding } = computer(cloud);
  const asking = onboarding.done();
  await onboarding.restart();
  answer();
  assert.equal(await asking, false);
  assert.equal(await onboarding.done(), false);
});

test("setup runs as before with a cloud that doesn't keep it", async () => {
  // An older cloud doesn't know the request: no retry.
  const old = cloudDouble({ finished: ["alice"], failures: [410] }), first = computer(old);
  assert.equal(await first.onboarding.done(), false);
  assert.equal(statusCalls(old), 1);
  // Nothing is kept, so the next check asks again.
  assert.equal(await first.onboarding.done(), true);
});

test("a cloud that can't answer now doesn't bring setup back", async () => {
  // A passing outage is retried.
  const flaky = cloudDouble({ finished: ["alice"], failures: [503, "offline"] });
  assert.equal(await computer(flaky).onboarding.done(), true);
  assert.equal(statusCalls(flaky), 3);
  // Still no answer (an outage, no network, a sign-in the cloud refuses): setup
  // doesn't show now. Nothing is kept, so the next check asks again, and an
  // account that never finished setup gets it then.
  for (const failure of [503, "offline", 401]) {
    const down = cloudDouble({ failures: [failure, failure, failure] }), { onboarding } = computer(down);
    assert.equal(await onboarding.done(), true, String(failure));
    assert.equal(await onboarding.done(), false, String(failure));
  }
});

test("a cloud that doesn't answer in time counts as not answering", async () => {
  const cloud = cloudDouble();
  cloud.hold = new Promise(() => {});
  assert.equal(await computer(cloud, { askMs: 5 }).onboarding.done(), true);
  assert.equal(statusCalls(cloud), 3);
});

test("a finished setup the cloud couldn't be told is told again", async () => {
  const cloud = cloudDouble({ completeFailures: [503, "offline"] }), first = computer(cloud);
  assert.equal((await finishSetup(first.onboarding)).completed, true);
  assert.ok(!cloud.finished.has("alice"));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(cloud.finished.has("alice"));
  // Another computer signing in now skips setup.
  assert.equal(await computer(cloud).onboarding.done(), true);
});

test("the window and the sandbox asking together reach the cloud once", async () => {
  const cloud = cloudDouble({ finished: ["alice"] }), { onboarding } = computer(cloud);
  assert.deepEqual(await Promise.all([onboarding.done(), onboarding.done()]), [true, true]);
  assert.equal(statusCalls(cloud), 1);
});
