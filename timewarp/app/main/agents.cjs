"use strict";
// Agents are named assistants with their own workspace folder. Codex reads the
// agent's instructions from AGENTS.md in that folder.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { agentWorkspace } = require("./harness.cjs");
const { choices } = require("../../shared/mascots.cjs");
const mascots = require("../../desktop/mascots.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });
const MAX_NAME = 60, MAX_INSTRUCTIONS = 20000;

function createAgents({ store, root, userId }) {
  const owner = () => { const value = userId(); if (!value) throw fail(401, "Sign in to Timewarp."); return value; };
  const owned = id => {
    const agent = store.agents.get(id);
    if (!agent || agent.ownerId !== owner()) throw fail(404, "This agent is unavailable for this account.");
    return agent;
  };
  const instructionsFile = agent => path.join(agent.workspace, "AGENTS.md");
  const name = value => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) throw fail(400, "Give the agent a name.");
    return text.slice(0, MAX_NAME);
  };
  function avatarFor(input, seed) {
    if (input?.mascot) {
      const choice = choices.find(item => item.name.toLowerCase() === String(input.mascot).toLowerCase());
      if (!choice) throw fail(400, "Choose Orbit, Nova or Cosmo.");
      return { avatarType: "native", avatarUrl: choice.avatarUrl };
    }
    if (input?.imageUrl) {
      if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.imageUrl) || input.imageUrl.length > 3_000_000) throw fail(400, "Choose a PNG, JPEG or WebP picture smaller than 2 MB.");
      return { avatarType: "uploaded", avatarUrl: input.imageUrl };
    }
    return mascots.avatar(seed);
  }
  function writeInstructions(agent, text) {
    const value = String(text ?? "");
    if (value.length > MAX_INSTRUCTIONS) throw fail(400, "Instructions are too long.");
    fs.mkdirSync(agent.workspace, { recursive: true });
    fs.writeFileSync(instructionsFile(agent), value.trim() ? value.trim() + "\n" : "");
  }
  return {
    create({ id = crypto.randomUUID(), ownerId = owner(), name: displayName, instructions = "", avatar, avatarType, avatarUrl, modelSettings }) {
      const agentName = name(displayName);
      const workspace = agentWorkspace(root, agentName, id);
      const picture = avatarType ? { avatarType, avatarUrl } : avatarFor(avatar, id);
      const agent = store.agents.create({ id, ownerId, name: agentName, instructions: String(instructions || ""), workspace, modelSettings, ...picture, sortKey: new Date().toISOString() });
      if (!fs.existsSync(instructionsFile(agent))) writeInstructions(agent, instructions);
      return agent;
    },
    list: () => store.agents.list(owner()),
    get: id => owned(id),
    instructions(id) {
      const agent = owned(id);
      try { return fs.readFileSync(instructionsFile(agent), "utf8"); } catch { return agent.instructions || ""; }
    },
    update(id, patch = {}) {
      const agent = owned(id), next = {};
      if (patch.name !== undefined) next.name = name(patch.name);
      if (patch.avatar !== undefined) Object.assign(next, avatarFor(patch.avatar, id));
      if (patch.starred !== undefined) next.starredAt = patch.starred ? new Date().toISOString() : null;
      if (patch.vaultAccess !== undefined) next.vaultAccess = !!patch.vaultAccess;
      if (patch.instructions !== undefined) { writeInstructions(agent, patch.instructions); next.instructions = String(patch.instructions); }
      return store.agents.update(id, next);
    },
    archive(id) { owned(id); return store.agents.update(id, { archivedAt: new Date().toISOString() }); },
    reorder(ids) {
      if (!Array.isArray(ids)) throw fail(400, "Invalid order.");
      const base = Date.now();
      store.transaction(() => ids.forEach((id, index) => { owned(id); store.agents.update(id, { sortKey: new Date(base + index).toISOString() }); }));
      return store.agents.list(owner());
    },
    // Agents without a picture, or with a retired built-in one, get a stable mascot.
    assignMascots() {
      for (const agent of store.agents.list(owner())) {
        if (mascots.shouldAssign(agent)) store.agents.update(agent.id, mascots.avatar(agent.id));
      }
    },
  };
}

module.exports = { createAgents };
