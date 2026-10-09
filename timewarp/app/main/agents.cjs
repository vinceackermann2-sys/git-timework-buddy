"use strict";
// Agents are named assistants with their own workspace folder. Codex reads the
// agent's instructions from AGENTS.md in that folder.
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { agentWorkspace } = require("./harness.cjs");
const { choices } = require("../../shared/mascots.cjs");
const mascots = require("../../desktop/mascots.cjs");

const fail = (status, message) => Object.assign(new Error(message), { status });
const MAX_NAME = 60, MAX_INSTRUCTIONS = 20000;

// A workspace starts as in the previous app: AGENTS.md with the agent's name and
// working conventions (and its responsibilities, when given), an overview, and
// a Git repository the agent commits to. The agent keeps AGENTS.md up to date.
function workspaceInstructions(name, responsibilities = "") {
  const extra = String(responsibilities || "").trim();
  return [
    `# ${name}`, "",
    "This repository is your persistent workspace.", "",
    "Project overview: `Overview.md`.", "",
    "- Keep durable instructions and working conventions in this file.",
    "- Store reusable procedures as skills.",
    "- Keep durable memory and working files in this repository.",
    "- Commit meaningful workspace changes to Git.",
    ...(extra ? ["", extra] : []), "",
  ].join("\n");
}
const git = (cwd, args) => new Promise(resolve => execFile("git", args, { cwd, windowsHide: true, timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, error => resolve(!error)));
// Best effort: without Git on the computer the workspace is still a plain folder.
async function commitWorkspace(workspace, message) {
  if (!fs.existsSync(path.join(workspace, ".git")) && !(await git(workspace, ["init", "-q"]))) return false;
  await git(workspace, ["add", "-A"]);
  return git(workspace, ["-c", "user.name=Timewarp", "-c", "user.email=agents@timewarp.local", "commit", "-q", "-m", message]);
}
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const readFile = file => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
  // Commits run one after another per workspace, in the background.
  const queues = new Map(), pending = new Set();
  function commit(workspace, message) {
    const run = (queues.get(workspace) || Promise.resolve()).then(() => commitWorkspace(workspace, message)).catch(() => false);
    queues.set(workspace, run);
    pending.add(run);
    void run.finally(() => { pending.delete(run); if (queues.get(workspace) === run) queues.delete(workspace); });
    return run;
  }
  // New workspaces, and ones left with an empty AGENTS.md (or only the responsibilities), get the conventions.
  function prepareWorkspace(agent) {
    fs.mkdirSync(agent.workspace, { recursive: true });
    const current = readFile(instructionsFile(agent));
    if (current !== null && current.trim() && current.trim() !== String(agent.instructions || "").trim()) return false;
    fs.writeFileSync(instructionsFile(agent), workspaceInstructions(agent.name, agent.instructions));
    if (readFile(path.join(agent.workspace, "Overview.md")) === null) fs.writeFileSync(path.join(agent.workspace, "Overview.md"), "# Overview\n");
    void commit(agent.workspace, "Initialize agent workspace");
    return true;
  }
  // Responsibilities are their own paragraph in AGENTS.md; a new name changes its title.
  function updateWorkspace(agent, { name: nextName, instructions: nextText }) {
    const file = instructionsFile(agent);
    let text = readFile(file);
    if (text === null) return;
    const before = text;
    if (nextName !== undefined && nextName !== agent.name) text = text.replace(new RegExp("^# " + escapeRegExp(agent.name) + "[ \\t]*$", "m"), "# " + nextName);
    if (nextText !== undefined) {
      const previous = String(agent.instructions || "").trim(), value = String(nextText || "").trim();
      if (previous && text.includes(previous)) text = text.replace(previous, value).replace(/\n{3,}/g, "\n\n");
      else if (value) text = text.replace(/\s*$/, "\n\n" + value + "\n");
    }
    if (text === before) return;
    fs.writeFileSync(file, text);
    void commit(agent.workspace, "Update agent workspace");
  }
  return {
    create({ id = crypto.randomUUID(), ownerId = owner(), name: displayName, instructions = "", avatar, avatarType, avatarUrl, modelSettings }) {
      const agentName = name(displayName);
      const workspace = agentWorkspace(root, agentName, id);
      const picture = avatarType ? { avatarType, avatarUrl } : avatarFor(avatar, id);
      if (String(instructions || "").length > MAX_INSTRUCTIONS) throw fail(400, "Instructions are too long.");
      const agent = store.agents.create({ id, ownerId, name: agentName, instructions: String(instructions || ""), workspace, modelSettings, ...picture, sortKey: new Date().toISOString() });
      prepareWorkspace(agent);
      return agent;
    },
    list: () => store.agents.list(owner()),
    get: id => owned(id),
    // The responsibilities the agent was given (edited in the agent dialog).
    instructions: id => owned(id).instructions || "",
    // Its AGENTS.md as the agent page shows it, without the title line.
    workspaceInstructions(id) {
      const text = readFile(instructionsFile(owned(id)));
      return text === null ? "" : text.replace(/^# [^\n]*\n+/, "").trim();
    },
    update(id, patch = {}) {
      const agent = owned(id), next = {};
      if (patch.name !== undefined) next.name = name(patch.name);
      if (patch.avatar !== undefined) Object.assign(next, avatarFor(patch.avatar, id));
      if (patch.starred !== undefined) next.starredAt = patch.starred ? new Date().toISOString() : null;
      if (patch.vaultAccess !== undefined) next.vaultAccess = !!patch.vaultAccess;
      if (patch.instructions !== undefined) {
        if (String(patch.instructions).length > MAX_INSTRUCTIONS) throw fail(400, "Instructions are too long.");
        next.instructions = String(patch.instructions);
      }
      if (next.name !== undefined || next.instructions !== undefined) updateWorkspace(agent, next);
      return store.agents.update(id, next);
    },
    archive(id) { owned(id); return store.agents.update(id, { archivedAt: new Date().toISOString() }); },
    reorder(ids) {
      if (!Array.isArray(ids)) throw fail(400, "Invalid order.");
      const base = Date.now();
      store.transaction(() => ids.forEach((id, index) => { owned(id); store.agents.update(id, { sortKey: new Date(base + index).toISOString() }); }));
      return store.agents.list(owner());
    },
    // Workspaces made before they started with the conventions get them now.
    // Resolves when background workspace commits have finished.
    settled: () => Promise.all([...pending]),
    prepareWorkspaces() { for (const agent of store.agents.list(owner())) { try { prepareWorkspace(agent); } catch {} } },
    // Agents without a picture, or with a retired built-in one, get a stable mascot.
    assignMascots() {
      for (const agent of store.agents.list(owner())) {
        if (mascots.shouldAssign(agent)) store.agents.update(agent.id, mascots.avatar(agent.id));
      }
    },
  };
}

module.exports = { createAgents, workspaceInstructions };
