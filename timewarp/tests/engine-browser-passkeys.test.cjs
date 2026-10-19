"use strict";
// Pages in the built-in browser and sign-in windows see a computer without
// passkeys, so the system's passkey window never opens at a sign-in or sign-up.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

// The script runs in a page's own world; here it runs in a page stand-in.
function page() {
  let func = null;
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === "electron") return { contextBridge: { executeInMainWorld: options => { func = options.func; } } };
    return original.call(this, request, ...rest);
  };
  const file = path.join(__dirname, "..", "app", "preload", "no-passkeys.cjs");
  try { delete require.cache[file]; require(file); } finally { Module._load = original; }
  const calls = [];
  class CredentialsContainer {
    get(options) { calls.push(["get", options]); return Promise.resolve("saved password"); }
    create(options) { calls.push(["create", options]); return Promise.resolve("new password"); }
  }
  class PublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true); }
    static isConditionalMediationAvailable() { return Promise.resolve(true); }
    static getClientCapabilities() { return Promise.resolve({ conditionalGet: true, hybridTransport: true, passkeyPlatformAuthenticator: true, "extension:prf": true }); }
  }
  const window = { CredentialsContainer, PublicKeyCredential };
  vm.runInNewContext(`(${func})()`, { window, DOMException });
  return { credentials: new CredentialsContainer(), PublicKeyCredential, calls };
}
const settled = promise => Promise.race([promise.then(() => true, () => true), new Promise(resolve => setTimeout(() => resolve(false), 20))]);
const publicKey = { challenge: new Uint8Array(32), rpId: "accounts.example" };

test("sites learn there's no passkey on this computer, nor a phone to use one from", async () => {
  const { PublicKeyCredential } = page();
  assert.equal(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), false);
  assert.equal(await PublicKeyCredential.isConditionalMediationAvailable(), false);
  assert.deepEqual({ ...await PublicKeyCredential.getClientCapabilities() }, { conditionalGet: false, hybridTransport: false, passkeyPlatformAuthenticator: false, "extension:prf": false });
});

test("a passkey asked for anyway is refused as if the passkey window had been closed", async () => {
  const { credentials, calls } = page();
  for (const ask of [() => credentials.get({ publicKey }), () => credentials.create({ publicKey: { ...publicKey, user: { name: "ada" } } }), () => credentials.create({ publicKey, mediation: "conditional" })]) {
    await assert.rejects(ask(), error => error.name === "NotAllowedError");
  }
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(credentials.get({ publicKey, signal: stopped.signal }), error => error.name === "AbortError");
  assert.deepEqual(calls, [], "The system was never asked");
});

test("a passkey offered with the sign-in fields stays unanswered until the page drops it", async () => {
  const { credentials, calls } = page();
  const controller = new AbortController();
  const offered = credentials.get({ publicKey, mediation: "conditional", signal: controller.signal });
  assert.equal(await settled(offered), false);
  controller.abort();
  await assert.rejects(offered, error => error.name === "AbortError");
  assert.deepEqual(calls, []);
});

test("passwords, codes and other sign-ins work as before", async () => {
  const { credentials, calls } = page();
  assert.equal(await credentials.get({ password: true }), "saved password");
  assert.equal(await credentials.get({ otp: { transport: ["sms"] } }), "saved password");
  assert.equal(await credentials.create({ password: { id: "ada", password: "secret" } }), "new password");
  assert.equal(await credentials.get(), "saved password");
  assert.deepEqual(calls.map(([name]) => name), ["get", "get", "create", "get"]);
});
