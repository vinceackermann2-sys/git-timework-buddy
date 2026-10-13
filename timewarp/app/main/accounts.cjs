"use strict";
// Each Timewarp account signed in on this computer keeps its own data. Chats,
// agents, automations and vault items carry their owner in the database; the
// files Codex and memory keep live in a folder per account:
//
//   runtime/accounts/<account id>/codex     the account's Codex home: its MCP
//                                           servers and their sign-ins, skills,
//                                           instructions for every agent, its
//                                           ChatGPT connection and chat transcripts
//   runtime/accounts/<account id>/memories  its memory notes, daily logs and imports
//
// Before this, every account on the computer shared runtime/codex and
// runtime/entities/memories. Those stay where they are and belong to one
// account, decided once (claim): the one with the most chats on this
// computer, or the first to sign in when there are none. Nothing is moved,
// so nothing can be lost halfway; the other accounts start with their own
// empty folders, which account sync then fills from the cloud.
const fs = require("node:fs");
const path = require("node:path");

const LEGACY_OWNER = "accounts.legacyOwner";
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
// Settings each account keeps for itself (store.settings.scopeTo). The rest
// (the window's graphics, the command sandbox, what was imported once) are
// the device's. SYNCED_SETTINGS also follow the account to its other
// computers (account-sync.cjs); the default model depends on how AI is paid
// for on each computer (a ChatGPT plan is connected per computer), and
// Privacy Mode and the Cursor folder are this computer's choice.
const ACCOUNT_SETTINGS = ["appearance", "preferences", "notifications", "memory", "modelSettings", "privacy", "cursorRoot", "replacedSkillsRetired"];
const SYNCED_SETTINGS = ["appearance", "preferences", "notifications", "memory"];

function createAccounts({ store, runtimeDir }) {
  const legacy = { codexHome: path.join(runtimeDir, "codex"), memoriesRoot: path.join(runtimeDir, "entities", "memories") };
  const used = folder => { try { return fs.readdirSync(folder).length > 0; } catch { return false; } };
  let known; // the claimed owner once read: an account id, or "" when there was no earlier data

  // The account that owns the computer's earlier data; null until decided.
  function legacyOwner() {
    if (known === undefined) { const value = store.settings.get(LEGACY_OWNER); if (typeof value === "string") known = value; }
    return known ?? null;
  }
  // Decided the first time someone signs in to this version.
  function claim(current) {
    if (legacyOwner() !== null) return known;
    let owner = "";
    if (used(legacy.codexHome) || used(legacy.memoriesRoot)) {
      const top = store.db.prepare("select owner_id, count(*) chats, max(last_activity_at) latest from conversations group by owner_id order by chats desc, latest desc limit 1").get();
      owner = top?.owner_id || current || "";
    }
    store.settings.set(LEGACY_OWNER, owner);
    known = owner;
    // That account keeps the settings this computer had (appearance, memory mode…).
    if (owner) store.settings.adopt(owner);
    return owner;
  }
  // The account's folders; signed out, a folder of no account.
  function paths(userId) {
    if (!userId) {
      const root = path.join(runtimeDir, "signed-out");
      return { root, codexHome: path.join(root, "codex"), memoriesRoot: path.join(root, "memories") };
    }
    if (!ACCOUNT_ID.test(userId)) throw new Error("Invalid account identifier.");
    if (claim(userId) === userId) return { root: runtimeDir, ...legacy };
    const root = path.join(runtimeDir, "accounts", userId);
    return { root, codexHome: path.join(root, "codex"), memoriesRoot: path.join(root, "memories") };
  }
  return { legacyOwner, claim, paths };
}

module.exports = { createAccounts, LEGACY_OWNER, ACCOUNT_SETTINGS, SYNCED_SETTINGS };
