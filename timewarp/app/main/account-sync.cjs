"use strict";
// Account sync: what follows a Timewarp account to each computer it signs in
// on, besides its chats (desktop/local-history.cjs): its agents, memory,
// instructions for every agent, skills, settings, which connected accounts
// each agent may use, and its MCP servers' addresses. Secrets, the vault,
// files, browser sign-ins, automations (they run on the computer they were
// made on) and sign-ins of apps and servers stay on each computer.
//
// The cloud keeps the latest copy of each item with a revision
// (cloud/accountData.ts). Each pass fetches what changed since the last one,
// then sends what changed here. The store keeps, per item, the revision and
// value both sides last agreed on (store.accountSync): an item changed only
// in the cloud is taken as it is, one changed only here is sent, and one
// changed on both is merged from that agreed value (merge3): text line by
// line, objects field by field, an edit winning over a removal. A write the
// cloud refuses because the item changed meanwhile is merged the same way and
// sent again.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertCloudSafe } = require("../../shared/privacy.cjs");

// Applied in this order, so an agent exists before its connected-app access.
const KINDS = ["setting", "agent", "connector-access", "instructions", "memory", "skill", "mcp"];
// An item's JSON is at most 300 K characters (the cloud's limit); a request
// stays under the cloud's 2 MB of bytes, text with accents or other scripts
// taking more bytes than characters.
const MAX_ITEM = 300 * 1024, BATCH_ITEMS = 25, BATCH_BYTES = 1400 * 1024;
// What an adapter lists for an item that is on this computer but stays here
// (too large, a picture, a server that runs a command): it is never sent, nor
// taken as removed, and the cloud's copy doesn't replace it.
const KEPT = Object.freeze({ kept: true });
// An item the cloud has that can't be applied here is tried again at the
// next passes; after this many it waits until it changes again.
const ATTEMPTS = 3;

// A field that is null is the same as one that isn't there.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value ?? null))).digest("base64url");
const same = (a, b) => digest(a) === digest(b);
const plain = value => !!value && typeof value === "object" && !Array.isArray(value);

// The longest common subsequence of two lists of lines, as index pairs. Long
// texts compare their changed middle only; past a few million comparisons
// the texts are taken as having no lines in common.
function commonLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const pairs = [];
  for (let index = 0; index < start; index++) pairs.push([index, index]);
  const n = endA - start, m = endB - start;
  if (n && m && n * m <= 4e6) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) i++;
      else j++;
    }
  }
  for (let offset = 0; offset < a.length - endA; offset++) pairs.push([endA + offset, endB + offset]);
  return pairs;
}
// The changes from base to other: base lines [start, end) became `lines`.
function changes(base, other) {
  const result = [];
  let i = 0, j = 0;
  for (const [x, y] of [...commonLines(base, other), [base.length, other.length]]) {
    if (x > i || y > j) result.push({ start: i, end: x, lines: other.slice(j, y) });
    i = x + 1; j = y + 1;
  }
  return result;
}
// A three-way merge of text by lines. Changes on one side are applied as
// they are; where both sides changed the same lines, both are kept: the
// cloud's version, then this computer's lines it doesn't have.
function mergeText(base, local, remote) {
  if (local === remote) return local;
  const lines = text => String(text ?? "").split("\n");
  const b = lines(base), mine = changes(b, lines(local)).map(change => ({ ...change, side: 0 })), theirs = changes(b, lines(remote)).map(change => ({ ...change, side: 1 }));
  const all = [...mine, ...theirs].sort((x, y) => x.start - y.start || x.end - y.end || x.side - y.side);
  const out = [];
  let at = 0;
  for (let index = 0; index < all.length;) {
    const group = [all[index++]];
    let start = group[0].start, end = group[0].end;
    // Changes touching the same lines, or inserting at the same place, go together.
    while (index < all.length && (all[index].start < end || all[index].start === start || (all[index].start === end && (all[index].start === all[index].end || group.some(change => change.start === change.end))))) {
      end = Math.max(end, all[index].end);
      group.push(all[index++]);
    }
    out.push(...b.slice(at, start));
    const version = side => {
      const result = [];
      let position = start;
      for (const change of group.filter(item => item.side === side)) { result.push(...b.slice(position, change.start), ...change.lines); position = change.end; }
      return [...result, ...b.slice(position, end)];
    };
    const sides = new Set(group.map(change => change.side));
    if (sides.size === 1) out.push(...version([...sides][0]));
    else {
      const ours = version(0), cloud = version(1);
      if (ours.join("\n") === cloud.join("\n")) out.push(...cloud);
      else { const known = new Set(cloud); out.push(...cloud, ...ours.filter(line => !known.has(line) && line.trim())); }
    }
    at = end;
  }
  out.push(...b.slice(at));
  return out.join("\n");
}
// Fields holding written text, merged line by line: a file's text, an
// agent's responsibilities, the files of a skill. Any other value changed on
// both sides (a theme, a date, an address) takes the cloud's.
const TEXT_FIELDS = new Set(["text", "instructions"]);
const textField = path => TEXT_FIELDS.has(path.at(-1)) || path.at(-2) === "files";
// A three-way merge of two versions of an item from the version both had
// agreed on. Absent and null are the same (a removed item).
function merge3(base, local, remote, path = []) {
  base = base ?? null; local = local ?? null; remote = remote ?? null;
  if (same(local, remote)) return local;
  if (same(base, local)) return remote;
  if (same(base, remote)) return local;
  if (local === null) return remote;
  if (remote === null) return local;
  if (typeof local === "string" && typeof remote === "string" && textField(path)) return mergeText(typeof base === "string" ? base : "", local, remote);
  if (plain(local) && plain(remote)) {
    const result = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const value = merge3(plain(base) ? base[key] : null, local[key], remote[key], [...path, key]);
      if (value !== null && value !== undefined) result[key] = value;
    }
    return result;
  }
  return remote;
}

// adapters: { [kind]: { list(account) -> Map(key -> value), apply(account, key, value | null) } },
// either may return a promise; list may give KEPT for an item that stays here.
// cloud(account, route, input): the cloud's JSON answer, sent only while
// `account` is signed in (with its own token).
// paused(): Privacy Mode is on, so nothing leaves this computer.
function createAccountSync({ store, userId, cloud, adapters, paused = () => false, onStatus = () => {}, onApplied = () => {}, log = () => {}, intervalMs = 30000 }) {
  let running = null, again = false, stopped = false, soonTimer = null;
  const held = new Map(); // "kind\0key" -> digest: kept on this computer (too large or private) until it changes
  const warned = new Map(); // kind -> count of removals last left in the cloud
  const failures = new Map(); // "kind\0key" -> { revision, count }: items that couldn't be applied
  const id = (kind, key) => kind + "\0" + key;
  const order = kind => KINDS.indexOf(kind);
  const kinds = KINDS.filter(kind => adapters[kind]);
  const EMPTY = digest(null);

  async function pass(account) {
    const current = () => { if (stopped || userId() !== account) throw Object.assign(new Error("The active account changed."), { code: "account-changed" }); };
    const synced = new Map(store.accountSync.items(account).map(item => [id(item.kind, item.key), item]));
    // This computer's items of each kind, read once per pass (again after a
    // change); a kind that can't be read now (Codex is restarting) is left for
    // the next pass, in both directions.
    const locals = new Map(), unavailable = new Set();
    const localOf = async kind => {
      if (unavailable.has(kind)) return null;
      if (!locals.has(kind)) {
        let value;
        try { value = await adapters[kind].list(account); }
        catch (error) { current(); unavailable.add(kind); log(`Account sync couldn't read ${kind} items: ${error.message}`); return null; }
        current();
        locals.set(kind, value);
      }
      return locals.get(kind);
    };
    const remember = (kind, key, revision, value) => {
      const entry = { kind, key, revision, hash: digest(value), base: value ?? null };
      synced.set(id(kind, key), entry);
      store.accountSync.save(account, kind, key, entry);
    };
    let applied = 0, retryFrom = Infinity;
    // An item as the cloud has it: taken, or merged with this computer's
    // change. One that can't be applied now is fetched again next pass.
    async function receive({ kind, key, revision, value }) {
      const adapter = adapters[kind];
      if (!adapter) return;
      const known = synced.get(id(kind, key));
      if (known && revision <= known.revision) return;
      const items = await localOf(kind);
      if (!items) { retryFrom = Math.min(retryFrom, revision); return; }
      if (items.get(key) === KEPT) { remember(kind, key, revision, value ?? null); return; }
      const local = items.get(key) ?? null, remote = value ?? null;
      const unchanged = known ? digest(local) === known.hash : local === null;
      const result = same(local, remote) || unchanged ? remote : merge3(known?.base ?? null, local, remote);
      if (!same(result, local)) {
        current();
        try { await adapter.apply(account, key, result); }
        catch (error) {
          current();
          const failed = failures.get(id(kind, key)), count = failed?.revision === revision ? failed.count + 1 : 1;
          failures.set(id(kind, key), { revision, count });
          if (count < ATTEMPTS) retryFrom = Math.min(retryFrom, revision);
          log(`Account sync couldn't apply a ${kind} item: ${error.message}`);
          return;
        }
        failures.delete(id(kind, key));
        current();
        locals.delete(kind);
        applied++;
        onApplied(kind, key);
      }
      remember(kind, key, revision, remote);
    }

    // What changed in the cloud, applied in kind order once all of it is known.
    const cursor = store.accountSync.cursor(account);
    let latest = cursor;
    const incoming = [];
    for (let more = true, pages = 0; more && pages < 1000; pages++) {
      const page = await cloud(account, "/account-data", { operation: "changes", after: latest });
      current();
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.cursor) || page.cursor < latest) throw new Error("Invalid account data response.");
      incoming.push(...page.items);
      latest = page.cursor;
      more = page.more === true && page.items.length > 0;
    }
    incoming.sort((a, b) => order(a.kind) - order(b.kind) || a.revision - b.revision);
    for (const item of incoming) await receive(item);
    const reached = Math.min(latest, retryFrom - 1);
    if (reached > cursor) store.accountSync.setCursor(account, reached);

    // What changed here, sent; a write refused because the cloud's copy
    // changed meanwhile is merged and sent again.
    const outcome = { sent: 0, held: 0 };
    for (let round = 0; round < 3; round++) {
      const outgoing = [];
      for (const kind of kinds) {
        const local = await localOf(kind);
        if (!local) continue;
        const removals = [];
        for (const [key, value] of local) {
          if (value === KEPT) continue;
          const known = synced.get(id(kind, key)), hash = digest(value);
          if (known?.hash !== hash) outgoing.push({ kind, key, value, base: known?.revision || 0, hash });
        }
        for (const known of synced.values()) if (known.kind === kind && !local.has(known.key) && known.hash !== EMPTY) removals.push({ kind, key: known.key, value: null, base: known.revision, hash: EMPTY });
        // Every item of a kind gone at once (its folder deleted or unreadable)
        // isn't sent: removing them from every computer could lose the
        // account's data. They stay in the cloud.
        if (!local.size && removals.length > 3) {
          if (warned.get(kind) !== removals.length) log(`Account sync left ${removals.length} ${kind} items in the cloud: none of them are on this computer.`);
          warned.set(kind, removals.length);
        } else outgoing.push(...removals);
      }
      const ready = outgoing.filter(item => {
        if (held.get(id(item.kind, item.key)) === item.hash) return false;
        let reason = null;
        const json = JSON.stringify(item.value);
        if (item.value !== null && (json.length > MAX_ITEM || Buffer.byteLength(json) > BATCH_BYTES)) reason = "too large";
        else try { assertCloudSafe(item.value); } catch { reason = "private"; }
        if (!reason) return true;
        held.set(id(item.kind, item.key), item.hash);
        log(`Account sync kept a ${item.kind} item on this computer (${reason}).`);
        return false;
      });
      outcome.held = [...held.keys()].length;
      if (!ready.length) break;
      let conflicts = 0;
      for (let index = 0; index < ready.length;) {
        const batch = [];
        let size = 0;
        while (index < ready.length && batch.length < BATCH_ITEMS) {
          const length = Buffer.byteLength(JSON.stringify(ready[index]));
          if (batch.length && size + length > BATCH_BYTES) break;
          batch.push(ready[index++]); size += length;
        }
        current();
        const answer = await cloud(account, "/account-data", { operation: "put", items: batch.map(({ kind, key, value, base }) => ({ kind, key, value, base })) });
        current();
        if (!Array.isArray(answer?.results) || answer.results.length !== batch.length) throw new Error("Invalid account data response.");
        for (const [position, result] of answer.results.entries()) {
          const sent = batch[position];
          if (result.kind !== sent.kind || result.key !== sent.key) throw new Error("Invalid account data response.");
          if (Number.isSafeInteger(result.revision) && !result.conflict && !result.error) { remember(sent.kind, sent.key, result.revision, sent.value); outcome.sent++; }
          else if (result.conflict) { conflicts++; locals.delete(sent.kind); await receive({ kind: sent.kind, key: sent.key, revision: result.revision, value: result.value }); }
          else { held.set(id(sent.kind, sent.key), sent.hash); log(`The cloud kept a ${sent.kind} item off (${result.error || "refused"}).`); }
        }
      }
      if (!conflicts) break;
    }
    return { applied, ...outcome };
  }

  async function sync() {
    if (stopped) return null;
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        const account = userId();
        if (!account) return null;
        if (paused()) { onStatus({ state: "paused" }); return null; }
        try {
          const result = await pass(account);
          onStatus({ state: "synced", lastSyncedAt: new Date().toISOString(), ...result });
        } catch (error) {
          if (error.code === "account-changed") return null;
          // A cloud without account sync yet (404/410) is waited out quietly.
          if ([404, 410].includes(error.status)) { onStatus({ state: "unavailable" }); return null; }
          onStatus({ state: "error", message: error.message });
          log("Account sync is pending: " + error.message);
          return null;
        }
      } while (again && !stopped);
      return null;
    })().finally(() => { running = null; });
    return running;
  }
  const timer = setInterval(() => { void sync(); }, intervalMs);
  timer.unref?.();
  return {
    sync,
    // A change here: sent a moment later, once related changes are made too.
    soon(delayMs = 2000) {
      if (stopped) return;
      clearTimeout(soonTimer);
      soonTimer = setTimeout(() => { void sync(); }, delayMs);
      soonTimer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); clearTimeout(soonTimer); },
  };
}

// ---- What each kind is on this computer ----

// File names a synced key may use: plain names in plain folders, nothing that
// could reach outside the folder.
const SAFE_SEGMENT = /^(?!\.)[^\\/:*?"<>|\u0000-\u001f]{1,120}$/;
const safeRelative = key => typeof key === "string" && key.length <= 400 && key.split("/").length <= 6 && key.split("/").every(part => SAFE_SEGMENT.test(part) && part !== ".." && !/[. ]$/.test(part));
function within(root, file) { const relative = path.relative(root, file); return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
// UTF-8 text, or null for other files (pictures, archives).
function textOf(buffer) {
  if (buffer.includes(0)) return null;
  const text = buffer.toString("utf8");
  return Buffer.byteLength(text) === buffer.length && !text.includes("�") ? text : null;
}

// A folder of text files: each file is an item keyed by its path inside the
// folder ("daily-logs/2026-10-12.md"), { text }. Files read once and kept
// until they change; files that aren't text or are over maxBytes stay here.
function textFiles({ root, maxBytes = 512 * 1024, maxFiles = 3000 }) {
  const known = new Map(); // file -> { key, value }
  function list(account) {
    const folder = root(account), result = new Map();
    const walk = (directory, prefix, depth) => {
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (result.size >= maxFiles || !SAFE_SEGMENT.test(entry.name) || entry.name.endsWith(".tmp")) continue;
        const file = path.join(directory, entry.name), key = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) { if (depth < 5) walk(file, key, depth + 1); continue; }
        if (!entry.isFile() || !safeRelative(key)) continue;
        let stat;
        try { stat = fs.statSync(file); } catch { continue; }
        if (stat.size > maxBytes) { result.set(key, KEPT); continue; }
        const mark = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`, cached = known.get(file);
        if (cached?.mark === mark) { result.set(key, cached.value || KEPT); continue; }
        let text = null;
        try { text = textOf(fs.readFileSync(file)); } catch { result.set(key, KEPT); continue; }
        const value = text === null ? null : { text };
        known.set(file, { mark, value });
        result.set(key, value || KEPT);
      }
    };
    walk(folder, "", 0);
    return result;
  }
  function apply(account, key, value) {
    if (!safeRelative(key)) return;
    const folder = root(account), file = path.join(folder, ...key.split("/"));
    if (!within(folder, file)) return;
    if (value === null) { fs.rmSync(file, { force: true }); return; }
    if (typeof value?.text !== "string") return;
    writeAtomic(file, value.text);
  }
  return { list, apply };
}

// Skills: each skill folder with a SKILL.md, { files: { "SKILL.md": text, … } }.
// A skill with pictures or other files that aren't text, or larger than
// maxBytes, stays on this computer.
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Left out of a skill: version control, installed packages, and files the
// system or Python leave in folders.
const JUNK = /^(\.git|node_modules|__pycache__|\.DS_Store|Thumbs\.db|desktop\.ini|.*\.pyc)$/i;
function skillFolders({ root, maxBytes = 256 * 1024, maxFiles = 60, onChanged = () => {} }) {
  function read(folder) {
    const files = {};
    let count = 0, bytes = 0;
    const walk = (directory, prefix, depth) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (JUNK.test(entry.name)) continue;
        const file = path.join(directory, entry.name), key = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isSymbolicLink()) throw new Error("link");
        if (entry.isDirectory()) { if (depth >= 4) throw new Error("deep"); walk(file, key, depth + 1); continue; }
        if (!entry.isFile() || !safeRelative(key)) throw new Error("name");
        const buffer = fs.readFileSync(file), text = textOf(buffer);
        if (text === null || ++count > maxFiles || (bytes += buffer.length) > maxBytes) throw new Error("size");
        files[key] = text;
      }
    };
    walk(folder, "", 0);
    return files;
  }
  function list(account) {
    const folder = root(account), result = new Map();
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return result; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SKILL_NAME.test(entry.name) || entry.name.startsWith(".")) continue;
      const skill = path.join(folder, entry.name);
      if (!fs.existsSync(path.join(skill, "SKILL.md"))) continue;
      try { result.set(entry.name, { files: read(skill) }); } catch { result.set(entry.name, KEPT); }
    }
    return result;
  }
  function apply(account, name, value) {
    if (!SKILL_NAME.test(name) || name.startsWith(".")) return;
    const folder = root(account), target = path.join(folder, name);
    if (!within(folder, target)) return;
    if (value === null) { fs.rmSync(target, { recursive: true, force: true }); onChanged(); return; }
    const files = plain(value?.files) ? Object.entries(value.files).filter(([key, text]) => safeRelative(key) && typeof text === "string") : [];
    if (!files.some(([key]) => key === "SKILL.md")) return;
    const staging = path.join(folder, `.sync-${crypto.randomUUID()}`);
    try {
      for (const [key, text] of files) writeAtomic(path.join(staging, ...key.split("/")), text);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    onChanged();
  }
  return { list, apply };
}

// One text file, keyed by its name: the instructions for every agent.
function singleFile({ file, key }) {
  return {
    list(account) {
      const result = new Map();
      try { result.set(key, { text: fs.readFileSync(file(account), "utf8") }); } catch {}
      return result;
    },
    apply(account, name, value) {
      if (name !== key) return;
      if (value === null) { fs.rmSync(file(account), { force: true }); return; }
      if (typeof value?.text === "string") writeAtomic(file(account), value.text);
    },
  };
}

// Settings that follow the account (accounts.cjs SYNCED_SETTINGS). A setting
// is never removed: a removal leaves this computer's as it is.
function settingsItems({ settings, keys, onChanged = () => {} }) {
  return {
    list() {
      const result = new Map();
      for (const key of keys) { const value = settings.get(key); if (plain(value)) result.set(key, value); }
      return result;
    },
    apply(_account, key, value) {
      if (!keys.includes(key) || !plain(value) || JSON.stringify(value).length > 20000) return;
      settings.set(key, value);
      onChanged(key, value);
    },
  };
}

// Agents: their name, responsibilities, picture, star, order and whether
// they're archived. Each computer keeps its own workspace folder for them.
// An uploaded picture over the limit is made smaller first (shrinkPicture,
// here too), so both computers keep the same one.
const PICTURE_LIMIT = 200 * 1024;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
function agentItems({ store, agents, shrinkPicture = () => null, log = () => {} }) {
  function list(account) {
    const result = new Map();
    for (let agent of store.agents.list(account, { includeArchived: true })) {
      if (agent.avatarType === "uploaded" && String(agent.avatarUrl || "").length > PICTURE_LIMIT) {
        const smaller = shrinkPicture(agent.avatarUrl);
        if (typeof smaller === "string" && smaller.length <= PICTURE_LIMIT && /^data:image\/(?:png|jpeg|webp);base64,/.test(smaller)) agent = store.agents.update(agent.id, { avatarUrl: smaller });
      }
      const picture = agent.avatarType && String(agent.avatarUrl || "").length <= PICTURE_LIMIT ? { avatar: { type: agent.avatarType, url: agent.avatarUrl } } : {};
      result.set(agent.id, {
        name: agent.name, instructions: agent.instructions || "", ...picture,
        starredAt: agent.starredAt || null, sortKey: agent.sortKey || null, archivedAt: agent.archivedAt || null,
      });
    }
    return result;
  }
  function apply(account, id, value) {
    // The id names the agent's workspace folder: plain letters, digits and dashes only.
    if (!ITEM_ID.test(id)) return;
    const existing = store.agents.get(id);
    if (existing && existing.ownerId !== account) { log("Account sync skipped an agent that belongs to another account."); return; }
    // Agents aren't removed; one removed elsewhere is archived here.
    if (value === null) { if (existing && !existing.archivedAt) store.agents.update(id, { archivedAt: new Date().toISOString() }); return; }
    if (!plain(value) || typeof value.name !== "string" || !value.name.trim()) return;
    const avatar = plain(value.avatar) && ["native", "uploaded"].includes(value.avatar.type) && typeof value.avatar.url === "string"
      && (value.avatar.type === "native" || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.avatar.url)) ? { avatarType: value.avatar.type, avatarUrl: value.avatar.url } : null;
    const instructions = typeof value.instructions === "string" ? value.instructions.slice(0, 20000) : "";
    const agent = existing || agents.create({ id, ownerId: account, name: value.name, instructions, ...(avatar || {}) });
    if (existing && (existing.name !== value.name.trim() || existing.instructions !== instructions)) agents.update(id, { name: value.name, instructions });
    const text = item => typeof item === "string" && item.length <= 40 ? item : null;
    store.agents.update(id, { ...(avatar || {}), starredAt: text(value.starredAt), sortKey: text(value.sortKey) || agent.sortKey, archivedAt: text(value.archivedAt) });
  }
  return { list, apply };
}

// Which connected accounts each agent may use (desktop/composio.cjs); an
// agent without an entry may use all of them.
function connectorAccess({ integrations, store }) {
  return {
    list(account) {
      const result = new Map();
      for (const [agentId, items] of Object.entries(integrations.accessMap(account))) if (items === null || Array.isArray(items)) result.set(agentId, { items });
      return result;
    },
    apply(account, agentId, value) {
      if (!ITEM_ID.test(agentId) || store.agents.get(agentId)?.ownerId !== account) return;
      integrations.restoreAccess(account, agentId, value === null ? undefined : value.items);
    },
  };
}

// MCP servers added by address (mcp.cjs shared/applyShared). Their sign-ins
// stay on each computer: the server asks to be signed in to there. They're
// read from Codex, so they wait for Codex to be running (ready()) rather
// than hold up the rest of a pass, such as the first one at sign-in. A
// server here that can't be carried (it runs a command) is kept, so one of
// the same name from the other computer doesn't remove it. Codex is only
// asked while `account` is signed in (signedIn), since it runs in the
// signed-in account's home.
function mcpServers({ mcp, ready = () => true, signedIn = () => null }) {
  const guard = account => () => { if (signedIn() !== account) throw new Error("The active account changed."); };
  return {
    list: async account => {
      if (!ready()) throw new Error("Codex is starting.");
      const { servers, kept } = await mcp.shared({ guard: guard(account) });
      return new Map([...kept.map(name => [name, KEPT]), ...Object.entries(servers)]);
    },
    apply: async (account, name, value) => { await mcp.applyShared(name, value, { guard: guard(account) }); },
  };
}

module.exports = { createAccountSync, merge3, mergeText, digest, textFiles, skillFolders, singleFile, settingsItems, agentItems, connectorAccess, mcpServers, KINDS, KEPT };
