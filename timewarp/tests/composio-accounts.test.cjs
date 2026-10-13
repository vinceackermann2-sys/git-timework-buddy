"use strict";
// Connected-app accounts: an unfinished Connect never shows as needing a
// reconnect, a first Connect is confirmed even while the app list lags, and
// every account shows the name and email it signs in with.
const test = require("node:test"), assert = require("node:assert/strict");
const { createComposio } = require("../desktop/composio.cjs");

function fixture({ accounts = [], status = () => null, stored = null } = {}) {
  const state = { accounts, stored, calls: [], connectionId: "ca_new" };
  const service = createComposio({
    userId: () => "owner", settleMs: 200,
    storage: { load: () => structuredClone(state.stored), save: value => { state.stored = structuredClone(value); } },
    getAgent: async id => ({ id, ownerUserId: "owner" }), ensureCallback: async () => {}, mcpToken: "token",
    cloud: async (_route, input) => {
      state.calls.push(input.action);
      if (input.action === "list-apps") return { apps: [{ toolkitSlug: "gmail", authConfigId: "ac_gmail", name: "Gmail", accounts: structuredClone(state.accounts) }] };
      if (input.action === "initiate-connection") {
        state.accounts.push({ connectionId: state.connectionId, status: "INITIATED", active: false, label: "Account " + state.connectionId.slice(-6), email: null });
        return { connectionId: state.connectionId, redirectUrl: "https://connect.composio.dev/link" };
      }
      if (input.action === "connection-status") return status(input.connectionId);
      if (input.action === "disconnect") { state.accounts = state.accounts.filter(account => account.connectionId !== input.connectionId); return { ok: true }; }
      throw Error("Unexpected action " + input.action);
    },
  });
  return { service, state };
}
const accountsOf = async service => (await service.list({})).items[0].accounts;

test("an unfinished Connect is not listed, so a working app never shows Reconnect", async () => {
  const { service } = fixture({ accounts: [
    { connectionId: "ca_work", status: "ACTIVE", active: true, label: "vince@example.com", email: "vince@example.com", name: "Vince Ackermann" },
    { connectionId: "ca_abandoned", status: "INITIATED", active: false, label: "Account andned", email: null },
    { connectionId: "ca_expired_attempt", status: "EXPIRED", active: false, label: "Account ttempt", email: null },
  ] });
  const accounts = await accountsOf(service);
  assert.deepEqual(accounts.map(account => [account.id, account.authStatus]), [["ca_work", "ready"]]);
  assert.equal(accounts[0].displayName, "Vince Ackermann");
  assert.equal(accounts[0].email, "vince@example.com");
});

test("accounts show their name and email, whichever the cloud gives", async () => {
  const { service } = fixture({ accounts: [
    { connectionId: "ca_both", status: "ACTIVE", label: "both@example.com", email: "both@example.com", name: "Both Names" },
    { connectionId: "ca_label", status: "ACTIVE", label: "Label Name", email: "label@example.com" },
    { connectionId: "ca_email", status: "ACTIVE", label: "only@example.com", email: null },
    { connectionId: "ca_000001", status: "ACTIVE", label: "Account 000001", email: null },
  ] });
  const accounts = Object.fromEntries((await accountsOf(service)).map(account => [account.id, account]));
  assert.deepEqual([accounts.ca_both.name, accounts.ca_both.email, accounts.ca_both.displayName], ["Both Names", "both@example.com", "Both Names"]);
  assert.deepEqual([accounts.ca_label.name, accounts.ca_label.email], ["Label Name", "label@example.com"]);
  assert.deepEqual([accounts.ca_email.name, accounts.ca_email.email, accounts.ca_email.displayName], [null, "only@example.com", "only@example.com"]);
  // The cloud's stand-in label is not a name.
  assert.deepEqual([accounts.ca_000001.name, accounts.ca_000001.email, accounts.ca_000001.displayName], [null, null, "Account 000001"]);
});

test("an account that worked and then expired asks to reconnect, naming who it was", async () => {
  const { service, state } = fixture({ accounts: [{ connectionId: "ca_mail", status: "ACTIVE", label: "me@example.com", email: "me@example.com", name: "Me Myself", icon: "https://example.com/me.png" }] });
  assert.equal((await accountsOf(service))[0].authStatus, "ready");
  state.accounts = [{ connectionId: "ca_mail", status: "EXPIRED", active: false, label: "Account a_mail", email: null }];
  service.invalidate();
  const [account] = await accountsOf(service);
  assert.equal(account.authStatus, "reauthorization_required");
  assert.deepEqual([account.name, account.email, account.avatarUrl], ["Me Myself", "me@example.com", "https://example.com/me.png"]);
  // A moment the cloud couldn't check it isn't a reason to reconnect.
  state.accounts = [{ connectionId: "ca_mail", status: "UNKNOWN", active: false, label: "Account a_mail", email: null }];
  service.invalidate();
  assert.equal((await accountsOf(service))[0].authStatus, "ready");
});

test("an account an agent was given counts as having worked", async () => {
  const stored = { owner: { agent: [{ kind: "integration", integrationId: "composio-gmail", accountId: "ca_old", owner: "user" }] } };
  const { service } = fixture({ stored, accounts: [{ connectionId: "ca_old", status: "EXPIRED", active: false, label: "Account ca_old", email: null }] });
  assert.equal((await accountsOf(service))[0].authStatus, "reauthorization_required");
});

test("a first Connect is confirmed on its own while the app list still shows it started", async () => {
  const { service, state } = fixture({
    stored: { owner: { agent: [] } },
    status: id => ({ connectionId: id, status: "ACTIVE", active: true, failed: false, label: "new@example.com", email: "new@example.com", name: "New Person" }),
  });
  await service.beginConnect({ integrationId: "composio-gmail", agentId: "agent" });
  // While the sign-in is open, the started account isn't offered as a reconnect.
  assert.deepEqual(await accountsOf(service), []);
  const result = await service.callback(new URLSearchParams({ status: "success", connected_account_id: "ca_new" }));
  assert.deepEqual(result, { connected: true, accounts: [{ app: "Gmail", name: "New Person", email: "new@example.com" }] });
  const [account] = await accountsOf(service);
  assert.deepEqual([account.id, account.authStatus, account.name, account.email], ["ca_new", "ready", "New Person", "new@example.com"]);
  // The agent it was connected for can use it.
  assert.deepEqual((await service.connections("agent")).map(item => [item.connectionId, item.name, item.email]), [["ca_new", "New Person", "new@example.com"]]);
  assert.deepEqual(state.stored.owner.agent.map(item => item.accountId), ["ca_new"]);
  // Once the list catches up it's used as it is.
  state.accounts = [{ connectionId: "ca_new", status: "ACTIVE", active: true, label: "new@example.com", email: "new@example.com", name: "New Person" }];
  service.invalidate();
  assert.equal((await accountsOf(service))[0].authStatus, "ready");
});

test("a sign-in Composio reports as failed ends the wait with its reason", async () => {
  const { service } = fixture({ status: id => ({ connectionId: id, status: "FAILED", active: false, failed: true, statusReason: "Access denied" }) });
  await service.beginConnect({ integrationId: "composio-gmail" });
  await assert.rejects(service.callback(), /didn't complete: Access denied/);
  await assert.rejects(service.callback(), /No app connection is awaiting approval/);
});

test("a sign-in that never finishes still reads as pending", async () => {
  const { service } = fixture({ status: id => ({ connectionId: id, status: "INITIATED", active: false, failed: false }) });
  await service.beginConnect({ integrationId: "composio-gmail" });
  await assert.rejects(service.callback(), /still pending/);
  assert.deepEqual(await accountsOf(service), []);
});

test("disconnecting forgets the account", async () => {
  const { service, state } = fixture({ accounts: [{ connectionId: "ca_mail", status: "ACTIVE", label: "me@example.com", email: "me@example.com" }] });
  await accountsOf(service);
  assert.ok(state.stored.seen.owner.ca_mail);
  await service.disconnect({ integrationId: "composio-gmail", accountId: "ca_mail" });
  assert.equal(state.stored.seen.owner.ca_mail, undefined);
});
