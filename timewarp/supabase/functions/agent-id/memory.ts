// An agent's memory: what it should remember across every app it's used in
// (Claude Code, Codex, Cursor, Antigravity…), which its owner sees and edits
// on the website. Each memory is encrypted before it's stored: AES-256-GCM
// under a key made per agent (HKDF-SHA256) from AGENT_ID_DATA_KEY, a secret
// of the function that's never in the database, and bound to its own id, so
// the table holds nothing readable. A keyed digest spots duplicates.
// Memories are notes, never instructions, and never secrets: a key or a
// password goes to the vault instead.
import { checked, fail, fromBase64, hex, randomId, str, toBase64, utf8 } from './util.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx } from './context.ts';
import { audit, rateLimit } from './shared.ts';

type Op = (ctx: Ctx, who: AgentCaller, input: any) => Promise<unknown>;
type Source = 'agent' | 'owner' | 'import';
type Body = { text: string; topic: string | null; from: string | null };

export const MAX_TEXT = 4000;
const MAX_MEMORIES = 1000;
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();

// What a key, a token or a password looks like, so none is kept as a memory
// (the CLI takes the same out of what it imports: agent-id/cli/src/memory.js).
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b(?:twa|two|twrp|twc)_[A-Za-z0-9_-]{20,}/,
  /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b0x[0-9a-fA-F]{64}\b/,
  /\b(?:password|passwd|pwd|passphrase|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token)\s*[:=]\s*["']?[^\s"']{6,}/i,
];
export const looksSecret = (text: string) => SECRET_PATTERNS.some(pattern => pattern.test(text));

// --- Encryption ---------------------------------------------------------------------

// Development deployments (test mode) without the secret use a fixed key, so
// their memories are only as private as the development database.
const DEV_KEY = utf8('agent-id-development-memory-key!');

async function keysFor(ctx: Ctx, agentId: string) {
  const configured = ctx.config.dataKey;
  let raw: Uint8Array;
  if (configured) {
    try { raw = fromBase64(configured); } catch { raw = new Uint8Array(); }
    if (raw.length !== 32) throw fail(500, 'memory_misconfigured', 'Memory is switched off: AGENT_ID_DATA_KEY must be 32 random bytes in base64.');
  } else {
    if (!ctx.config.testMode) throw fail(503, 'memory_off', 'Memory isn\'t switched on for this deployment yet.');
    raw = DEV_KEY;
  }
  const base = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey']);
  const derive = (info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('agent-id-memory') as BufferSource, info: utf8(info) as BufferSource }, base, algorithm, false, usages);
  return {
    aes: await derive(`seal:${agentId}`, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    mac: await derive(`digest:${agentId}`, { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
  };
}
type Keys = Awaited<ReturnType<typeof keysFor>>;

async function seal(keys: Keys, id: string, agentId: string, body: Body) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`${agentId}:${id}`) as BufferSource }, keys.aes, utf8(JSON.stringify(body)) as BufferSource));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return toBase64(out);
}

async function open(keys: Keys, row: any): Promise<Body | null> {
  try {
    const bytes = fromBase64(String(row.sealed));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) as BufferSource, additionalData: utf8(`${row.agent_id}:${row.id}`) as BufferSource }, keys.aes, bytes.subarray(12) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const digestOf = async (keys: Keys, text: string) => hex(new Uint8Array(await crypto.subtle.sign('HMAC', keys.mac, utf8(normal(text)) as BufferSource)));

// --- Reading and writing ------------------------------------------------------------

const memoryView = (row: any, body: Body | null) => ({
  id: row.id,
  text: body?.text ?? null,
  topic: body?.topic ?? null,
  // Where it came from: an app it was imported from, or the app it was saved in.
  from: body?.from ?? row.app ?? null,
  source: row.source,
  model: row.model || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(body ? {} : { note: 'This memory can\'t be read: it was encrypted with another key.' }),
});

async function all(ctx: Ctx, agentId: string) {
  return (checked(await ctx.admin.from('agent_id_memories').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(MAX_MEMORIES)) || []) as any[];
}
async function opened(ctx: Ctx, agentId: string) {
  const keys = await keysFor(ctx, agentId);
  return Promise.all((await all(ctx, agentId)).map(async row => ({ row, body: await open(keys, row) })));
}

function textOf(input: any) {
  const text = str(input.text, MAX_TEXT, 'text', { required: true, multiline: true }).trim();
  if (!text) throw fail(400, 'invalid', 'text is required.');
  if (looksSecret(text)) throw fail(400, 'secret_in_memory', 'That looks like a key, token or password. Memory isn\'t for secrets: save it in the vault (vault_save), which keeps it encrypted on the agent\'s computer.');
  return text;
}
const topicOf = (input: any) => (str(input.topic, 80, 'topic') || '').trim() || null;
const fromOf = (value: unknown) => {
  const from = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(from) ? from : null;
};

// Stores one memory unless the same one is already there. Returns the row and
// whether it's new.
async function store(ctx: Ctx, agent: AgentRow, keys: Keys, body: Body, source: Source, via: { app: string | null; model: string | null }) {
  const digest = await digestOf(keys, body.text);
  const existing = checked(await ctx.admin.from('agent_id_memories').select('*').eq('agent_id', agent.id).eq('digest', digest).maybeSingle()) as any;
  if (existing) return { row: existing, body: (await open(keys, existing)) ?? body, added: false };
  const id = `mem_${randomId(24)}`;
  const inserted = await ctx.admin.from('agent_id_memories').insert({
    id, agent_id: agent.id, owner_user_id: agent.owner_user_id, sealed: await seal(keys, id, agent.id, body), digest, source,
    app: via.app && /^[a-z0-9-]{1,40}$/.test(via.app) ? via.app : null, model: via.model ? via.model.slice(0, 80) : null,
  }).select('*').single();
  // Saved at the same moment by another request: that one stands.
  if (inserted.error?.code === '23505') {
    const raced = checked(await ctx.admin.from('agent_id_memories').select('*').eq('agent_id', agent.id).eq('digest', digest).single());
    return { row: raced, body, added: false };
  }
  return { row: checked(inserted), body, added: true };
}

async function countOf(ctx: Ctx, agentId: string) {
  return ((checked(await ctx.admin.from('agent_id_memories').select('id').eq('agent_id', agentId).limit(MAX_MEMORIES + 1)) || []) as any[]).length;
}
async function room(ctx: Ctx, agentId: string, more = 1) {
  if ((await countOf(ctx, agentId)) + more > MAX_MEMORIES) throw fail(409, 'memory_full', `An agent keeps at most ${MAX_MEMORIES} memories. Forget some first.`);
}

// Words that say nothing about what a memory is about.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'how', 'are', 'was', 'you', 'your', 'from', 'about', 'into', 'have', 'has', 'not', 'but', 'its', 'our', 'their']);
const words = (text: string) => [...new Set(normal(text).split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length >= 2 && !STOP.has(word)))];

// The memories that match a query best: each word found counts, in the topic
// twice, and the whole query found together more.
export function rank(memories: { text: string; topic: string | null }[], query: string) {
  const terms = words(query), phrase = normal(query);
  return memories.map((memory, index) => {
    const text = normal(memory.text), topic = normal(memory.topic || '');
    let score = 0;
    for (const term of terms) score += (text.includes(term) ? 1 : 0) + (topic.includes(term) ? 2 : 0);
    if (phrase.length > 3 && text.includes(phrase)) score += 3;
    return { index, score };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(hit => hit.index);
}

// --- The agent ------------------------------------------------------------------------

const via = (ctx: Ctx) => ({ app: ctx.via?.app ?? null, model: ctx.via?.model ?? null });

const memorySave: Op = async (ctx, who, input) => {
  const text = textOf(input);
  await rateLimit(ctx, who.userId, `memory:${who.agent.id}`, 30, 1000, 'memories');
  await room(ctx, who.agent.id);
  const keys = await keysFor(ctx, who.agent.id);
  const { row, body, added } = await store(ctx, who.agent, keys, { text, topic: topicOf(input), from: null }, who.via === 'owner' ? 'owner' : 'agent', via(ctx));
  if (added) await audit(ctx, who.userId, who.agent.id, who.via === 'owner' ? 'owner' : 'agent', 'memory.save', { memory: row.id });
  return { memory: memoryView(row, body), ...(added ? {} : { note: 'Already remembered.' }) };
};

const memorySearch: Op = async (ctx, who, input) => {
  const query = str(input.query ?? input.q, 300, 'query');
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const list = (await opened(ctx, who.agent.id)).filter(item => item.body);
  if (!query) return { memories: list.slice(0, limit).map(item => memoryView(item.row, item.body)), note: 'No query: the newest memories.' };
  const hits = rank(list.map(item => item.body!), query).slice(0, limit);
  return { memories: hits.map(index => memoryView(list[index].row, list[index].body)), ...(hits.length ? {} : { note: 'Nothing remembered about that.' }) };
};

const memoryList: Op = async (ctx, who, input) => {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);
  const list = await opened(ctx, who.agent.id);
  return { memories: list.slice(offset, offset + limit).map(item => memoryView(item.row, item.body)), total: list.length };
};

const memoryForget: Op = async (ctx, who, input) => {
  const id = str(input.id, 40, 'id', { required: true });
  const rows = checked(await ctx.admin.from('agent_id_memories').delete().eq('id', id).eq('agent_id', who.agent.id).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No memory with that id.');
  await audit(ctx, who.userId, who.agent.id, who.via === 'owner' ? 'owner' : 'agent', 'memory.forget', { memory: id });
  return { forgotten: true };
};

// Memories brought from the apps on the agent's computer (the CLI's
// `memory import`): each checked like any other, duplicates skipped, and any
// that look like secrets left out.
const memoryImport: Op = async (ctx, who, input) => {
  const items = Array.isArray(input.items) ? input.items : null;
  if (!items || !items.length || items.length > 200) throw fail(400, 'invalid', 'items is a list of 1 to 200 memories.');
  await rateLimit(ctx, who.userId, `memory-import:${who.agent.id}`, 20, 200, 'memory imports');
  await room(ctx, who.agent.id, 0);
  const keys = await keysFor(ctx, who.agent.id);
  let added = 0, duplicates = 0, skipped = 0, full = false;
  let total = await countOf(ctx, who.agent.id);
  for (const item of items) {
    const text = String(item?.text ?? '').trim();
    if (!text || text.length > MAX_TEXT || looksSecret(text)) { skipped++; continue; }
    if (total >= MAX_MEMORIES) { full = true; skipped++; continue; }
    const topic = (String(item?.topic ?? '').trim().slice(0, 80)) || null;
    const result = await store(ctx, who.agent, keys, { text, topic, from: fromOf(item?.from) }, 'import', via(ctx));
    if (result.added) { added++; total++; } else duplicates++;
  }
  if (added) await audit(ctx, who.userId, who.agent.id, who.via === 'owner' ? 'owner' : 'agent', 'memory.import', { added, duplicates, skipped });
  return { added, duplicates, skipped, ...(full ? { note: `The memory is full (${MAX_MEMORIES}); forget some to import the rest.` } : {}) };
};

export const memoryOps: Record<string, Op> = { memorySave, memorySearch, memoryList, memoryForget, memoryImport };

export const memoryAgentRoutes: Route<AgentCaller>[] = [
  ['GET', '/v1/me/memories', (ctx, who, input) => memoryList(ctx, who, input)],
  ['POST', '/v1/me/memories', (ctx, who, input) => memorySave(ctx, who, input)],
  ['GET', '/v1/me/memories/search', (ctx, who, input) => memorySearch(ctx, who, input)],
  ['POST', '/v1/me/memories/import', (ctx, who, input) => memoryImport(ctx, who, input)],
  ['DELETE', '/v1/me/memories/:id', (ctx, who, _input, params) => memoryForget(ctx, who, { id: params.id })],
];

// --- The owner ------------------------------------------------------------------------

async function ownerAgent(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', agentId).eq('owner_user_id', owner.userId).maybeSingle()) as AgentRow | null;
  if (!agent) throw fail(404, 'not_found', 'No agent with that id.');
  return agent;
}

const ownerMemories: Route<Owner>[2] = async (ctx, owner, _input, params) => {
  const agent = await ownerAgent(ctx, owner, params.id);
  return { memories: (await opened(ctx, agent.id)).map(item => memoryView(item.row, item.body)) };
};

const ownerAdd: Route<Owner>[2] = async (ctx, owner, input, params) => {
  const agent = await ownerAgent(ctx, owner, params.id);
  const text = textOf(input);
  await room(ctx, agent.id);
  const keys = await keysFor(ctx, agent.id);
  const { row, body, added } = await store(ctx, agent, keys, { text, topic: topicOf(input), from: null }, 'owner', { app: null, model: null });
  if (added) await audit(ctx, owner.userId, agent.id, 'owner', 'memory.save', { memory: row.id });
  return { memory: memoryView(row, body) };
};

const ownerEdit: Route<Owner>[2] = async (ctx, owner, input, params) => {
  const agent = await ownerAgent(ctx, owner, params.id);
  const row = checked(await ctx.admin.from('agent_id_memories').select('*').eq('id', params.memoryId).eq('agent_id', agent.id).maybeSingle()) as any;
  if (!row) throw fail(404, 'not_found', 'No memory with that id.');
  const keys = await keysFor(ctx, agent.id);
  const before = await open(keys, row);
  const body: Body = { text: input.text === undefined && before ? before.text : textOf(input), topic: input.topic === undefined ? before?.topic ?? null : topicOf(input), from: before?.from ?? null };
  const digest = await digestOf(keys, body.text);
  const clash = checked(await ctx.admin.from('agent_id_memories').select('id').eq('agent_id', agent.id).eq('digest', digest).neq('id', row.id).maybeSingle());
  if (clash) throw fail(409, 'duplicate', 'The same memory is already there.');
  const updated = checked(await ctx.admin.from('agent_id_memories').update({ sealed: await seal(keys, row.id, agent.id, body), digest, updated_at: iso(ctx) }).eq('id', row.id).select('*').single());
  await audit(ctx, owner.userId, agent.id, 'owner', 'memory.edit', { memory: row.id });
  return { memory: memoryView(updated, body) };
};

const ownerForget: Route<Owner>[2] = async (ctx, owner, _input, params) => {
  const agent = await ownerAgent(ctx, owner, params.id);
  const rows = checked(await ctx.admin.from('agent_id_memories').delete().eq('id', params.memoryId).eq('agent_id', agent.id).select('id')) as any[];
  if (!rows?.length) throw fail(404, 'not_found', 'No memory with that id.');
  await audit(ctx, owner.userId, agent.id, 'owner', 'memory.forget', { memory: params.memoryId });
  return { forgotten: true };
};

const ownerForgetAll: Route<Owner>[2] = async (ctx, owner, _input, params) => {
  const agent = await ownerAgent(ctx, owner, params.id);
  const rows = checked(await ctx.admin.from('agent_id_memories').delete().eq('agent_id', agent.id).select('id')) as any[];
  await audit(ctx, owner.userId, agent.id, 'owner', 'memory.forget_all', { count: rows?.length || 0 });
  return { forgotten: rows?.length || 0 };
};

export const memoryOwnerRoutes: Route<Owner>[] = [
  ['GET', '/v1/agents/:id/memories', ownerMemories],
  ['POST', '/v1/agents/:id/memories', ownerAdd],
  ['PATCH', '/v1/agents/:id/memories/:memoryId', ownerEdit],
  ['DELETE', '/v1/agents/:id/memories/:memoryId', ownerForget],
  ['DELETE', '/v1/agents/:id/memories', ownerForgetAll],
];
