// An agent's vault: sign-ins and keys that live only on the agent's computer
// (vault/vm-script.ts), sealed to the computer's own key in the owner's
// browser, or by the Agent ID CLI on the agent's own computer when the agent
// saves one it was given. Agent ID keeps what's needed to list them (a name,
// the site or the sites a key may go to) and passes sealed items through; it
// never has a secret in the clear, and the agent uses a key by asking the vault
// to make a request with it, only to the sites the key is bound to. On the
// computer, the vault's key is encrypted with two halves: one there, one here
// (agent_id_vault_unlock), sent with each operation.
// Test computers (development) keep a test key pair here instead, and say so.
import { checked, fail, fromBase64, randomId, str, toBase64 } from './util.ts';
import type { AgentCaller, Owner, Route } from './app.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { audit, rateLimit, resourceFor } from './shared.ts';
import { askFirst } from './ask.ts';
import { machine, metered } from './agent.ts';
import { giveResource } from './provisioning.ts';
import { vaultOpCommand, vaultSetupCommand } from './vault/shell.ts';

type Op = (ctx: Ctx, who: AgentCaller, input: any) => Promise<unknown>;
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();

const itemView = (row: any) => ({
  id: row.id, kind: row.kind, label: row.label, site: row.site || null, hosts: row.hosts || [], send: row.send || null,
  totp: !!row.totp, savedBy: row.saved_by === 'agent' ? 'agent' : 'owner', createdAt: row.created_at, lastUsedAt: row.last_used_at || null,
});
const statusOf = (vm: ResourceRow | null) => ({
  // The vault needs a computer the agent never had root on.
  computer: vm ? (vm.state?.rootFree ? 'ready' : 'replace') : 'none',
  ready: !!vm?.state?.vault?.publicKey,
  publicKey: vm?.state?.vault?.publicKey || null,
  test: vm?.mode === 'test',
});

// What the vault program printed: its answer, or its reason.
function answer(stdout: string, stderr: string) {
  let parsed: any = null;
  try { parsed = JSON.parse(stdout.trim().split('\n').pop() || ''); } catch { /* not the program's answer */ }
  if (!parsed) {
    console.error('[agent-id] vault', stderr.slice(-500));
    throw fail(502, 'vault_failed', 'The vault on the agent\'s computer did not answer. Try again in a minute.');
  }
  if (parsed.error) throw fail(parsed.error.code === 'not_found' ? 404 : 409, String(parsed.error.code || 'vault_failed'), String(parsed.error.message || 'The vault could not do that.').slice(0, 300));
  return parsed;
}

// Agent ID's half of the key that unlocks the vault on this computer, made the
// first time. Alone it opens nothing: the other half never leaves the computer.
async function unlockOf(ctx: Ctx, vm: ResourceRow) {
  const kept = checked(await ctx.admin.from('agent_id_vault_unlock').select('half').eq('resource_id', vm.id).maybeSingle()) as any;
  if (kept?.half) return String(kept.half);
  const half = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const made = await ctx.admin.from('agent_id_vault_unlock').insert({ resource_id: vm.id, half }).select('half').single();
  // Made at the same moment by another request: that one stands.
  if (made.error?.code === '23505') return String((checked(await ctx.admin.from('agent_id_vault_unlock').select('half').eq('resource_id', vm.id).single()) as any).half);
  return String((checked(made) as any).half);
}

async function run(ctx: Ctx, who: AgentCaller, vm: ResourceRow, command: string, timeoutSeconds = 120) {
  const result = await metered(ctx, who, vm, command, { timeoutSeconds, history: false, as: 'system' });
  return answer(result.stdout, result.stderr);
}
const runOp = async (ctx: Ctx, who: AgentCaller, vm: ResourceRow, op: 'put' | 'remove' | 'request', input: Record<string, unknown>, timeoutSeconds = 120) =>
  run(ctx, who, vm, vaultOpCommand(op, { ...input, unlock: await unlockOf(ctx, vm) }), timeoutSeconds);

// --- Test computers: the same steps with a test key pair kept here -----------------

const pem = (label: string, der: ArrayBuffer) => `-----BEGIN ${label}-----\n${toBase64(new Uint8Array(der)).match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;
const derOf = (text: string) => fromBase64(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));

async function testKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
  return { publicKey: pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)), privateKey: pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)) };
}
async function testOpen(privateKey: string, envelope: any) {
  try {
    const key = await crypto.subtle.importKey('pkcs8', derOf(privateKey) as BufferSource, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, fromBase64(String(envelope.key)) as BufferSource);
    const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(String(envelope.iv)) as BufferSource }, aes, fromBase64(String(envelope.data)) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw fail(409, 'sealed_wrong', 'The item could not be opened on this computer. Add it again.');
  }
}
function testDescribe(item: any) {
  if (item?.kind === 'login' && /^https:\/\//.test(String(item.site)) && item.password) return { kind: 'login', site: new URL(item.site).origin, totp: !!item.totp };
  if (item?.kind === 'key' && Array.isArray(item.hosts) && item.hosts.length && item.value) return { kind: 'key', hosts: item.hosts.map((h: string) => String(h).toLowerCase()), send: item.send?.as || 'bearer' };
  throw fail(400, 'invalid', 'A vault item is a sign-in or a key, with what it needs.');
}

// --- Owner: setting the vault up, adding and removing items --------------------------

async function ownerAgent(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', agentId).eq('owner_user_id', owner.userId).maybeSingle()) as AgentRow | null;
  if (!agent) throw fail(404, 'not_found', 'No agent with that id.');
  return agent;
}
const asOwner = (owner: Owner, agent: AgentRow): AgentCaller => ({ kind: 'agent', userId: owner.userId, agent, via: 'owner' });
function needSession(owner: Owner) {
  // Secrets go in from the signed-in website only: a leaked CLI key can't fill or empty a vault.
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Manage the vault on the Agent ID website.');
}

export async function vaultStatus(ctx: Ctx, owner: Owner, agentId: string) {
  const agent = await ownerAgent(ctx, owner, agentId);
  const vm = await resourceFor(ctx, agent.id, 'vm', { required: false });
  const rows = vm ? (checked(await ctx.admin.from('agent_id_vault_items').select('*').eq('resource_id', vm.id).order('created_at')) || []) as any[] : [];
  return { vault: statusOf(vm), items: rows.map(itemView) };
}

// Sets the vault up on the agent's computer (giving it one first if it has none).
export async function setupVault(ctx: Ctx, owner: Owner, agentId: string) {
  needSession(owner);
  const agent = await ownerAgent(ctx, owner, agentId);
  if (agent.status !== 'active') throw fail(409, 'agent_inactive', 'The agent is paused or revoked.');
  await rateLimit(ctx, owner.userId, 'vault-setup', 3, 20, 'vault set-ups');
  let vm = await resourceFor(ctx, agent.id, 'vm', { required: false });
  // Real secrets get the real computer wherever there is one.
  if (!vm) vm = await giveResource(ctx, agent, 'vm', { mode: ctx.config.isLive('vm') ? 'live' : undefined });
  if (!vm.state?.rootFree) throw fail(409, 'computer_replace', 'This computer was set up before agents ran as an ordinary user, so the agent once had full control of it. Replace it to set up a vault.');
  let publicKey: string;
  if (vm.mode === 'test') {
    const keys = vm.state?.testVault?.privateKey ? { publicKey: vm.state.vault?.publicKey, privateKey: vm.state.testVault.privateKey } : await testKeys();
    publicKey = keys.publicKey;
    vm.state = { ...vm.state, testVault: { privateKey: keys.privateKey, items: vm.state?.testVault?.items || {} } };
  } else {
    if (vm.status !== 'active') ({ resource: vm } = await machine(ctx, asOwner(owner, agent)));
    if (vm.status !== 'active') throw fail(409, 'machine_not_ready', 'The agent\'s computer is still being set up. Try again in a minute.');
    publicKey = String((await run(ctx, asOwner(owner, agent), vm, vaultSetupCommand(await unlockOf(ctx, vm)), 600)).publicKey || '');
    if (!/^-----BEGIN PUBLIC KEY-----/.test(publicKey)) throw fail(502, 'vault_failed', 'The vault did not set up. Try again.');
  }
  const state = { ...vm.state, vault: { publicKey, setUpAt: vm.state?.vault?.setUpAt || iso(ctx) } };
  await ctx.admin.from('agent_id_resources').update({ state, updated_at: iso(ctx) }).eq('id', vm.id);
  await audit(ctx, owner.userId, agent.id, 'owner', 'vault.setup', { mode: vm.mode });
  return vaultStatus(ctx, owner, agent.id);
}

async function readyVault(ctx: Ctx, agent: AgentRow) {
  const vm = await resourceFor(ctx, agent.id, 'vm', { required: false });
  if (!vm?.state?.vault?.publicKey) throw fail(409, 'vault_not_set_up', 'The vault isn\'t set up on this agent\'s computer yet. Set it up on the Agent ID website.');
  return vm;
}

function sealedOf(input: any) {
  const envelope = input.envelope;
  if (!envelope || typeof envelope !== 'object' || envelope.v !== 1 || [envelope.key, envelope.iv, envelope.data].some(part => typeof part !== 'string' || part.length > 40_000)) throw fail(400, 'invalid', 'envelope must be a sealed vault item.');
  return { v: 1, key: envelope.key, iv: envelope.iv, data: envelope.data };
}

// A sealed item into the vault: the computer opens it to check it, keeps it
// sealed, and says what it is (never what's in it).
async function storeItem(ctx: Ctx, who: AgentCaller, vm: ResourceRow, label: string, sealed: Record<string, unknown>, savedBy: 'owner' | 'agent') {
  const agent = who.agent;
  const id = `vlt_${randomId(24)}`;
  let described: any;
  if (vm.mode === 'test') {
    described = testDescribe(await testOpen(vm.state.testVault.privateKey, sealed));
    const state = { ...vm.state, testVault: { ...vm.state.testVault, items: { ...vm.state.testVault.items, [id]: sealed } } };
    await ctx.admin.from('agent_id_resources').update({ state, updated_at: iso(ctx) }).eq('id', vm.id);
  } else {
    described = await runOp(ctx, who, vm, 'put', { id, envelope: sealed });
  }
  const row = checked(await ctx.admin.from('agent_id_vault_items').insert({
    id, agent_id: agent.id, resource_id: vm.id, owner_user_id: agent.owner_user_id, kind: described.kind, label,
    site: described.kind === 'login' ? described.site : null, hosts: described.kind === 'key' ? described.hosts : [],
    send: described.kind === 'key' ? described.send : null, totp: !!described.totp, saved_by: savedBy,
  }).select('*').single());
  await audit(ctx, agent.owner_user_id, agent.id, savedBy, savedBy === 'agent' ? 'vault.item_saved' : 'vault.item_added', { item: id, kind: described.kind, ...(described.site ? { site: described.site } : { hosts: described.hosts }) });
  return { item: itemView(row) };
}

// An item sealed in the owner's browser.
export async function addVaultItem(ctx: Ctx, owner: Owner, agentId: string, input: any) {
  needSession(owner);
  const agent = await ownerAgent(ctx, owner, agentId);
  const vm = await readyVault(ctx, agent);
  const label = str(input.label, 100, 'label', { required: true }).trim();
  const sealed = sealedOf(input);
  await rateLimit(ctx, owner.userId, 'vault-item', 20, 200, 'vault items');
  return storeItem(ctx, asOwner(owner, agent), vm, label, sealed, 'owner');
}

export async function removeVaultItem(ctx: Ctx, owner: Owner, agentId: string, itemId: string) {
  needSession(owner);
  const agent = await ownerAgent(ctx, owner, agentId);
  const row = /^vlt_[a-z0-9]{24}$/.test(itemId) ? checked(await ctx.admin.from('agent_id_vault_items').select('*').eq('id', itemId).eq('agent_id', agent.id).maybeSingle()) as any : null;
  if (!row) throw fail(404, 'not_found', 'No vault item with that id.');
  const vm = await resourceFor(ctx, agent.id, 'vm', { required: false });
  if (vm?.mode === 'test') {
    const { [row.id]: _gone, ...items } = vm.state?.testVault?.items || {};
    await ctx.admin.from('agent_id_resources').update({ state: { ...vm.state, testVault: { ...vm.state.testVault, items } }, updated_at: iso(ctx) }).eq('id', vm.id);
  } else if (vm) {
    await runOp(ctx, asOwner(owner, agent), vm, 'remove', { id: row.id });
  }
  await ctx.admin.from('agent_id_vault_items').delete().eq('id', row.id);
  await audit(ctx, owner.userId, agent.id, 'owner', 'vault.item_removed', { item: row.id });
  return { removed: true };
}

// --- The agent: what's in its vault, and using a key ---------------------------------

const vaultList: Op = async (ctx, who) => {
  const vm = await resourceFor(ctx, who.agent.id, 'vm', { required: false });
  if (!vm?.state?.vault?.publicKey) return { ready: false, items: [], note: 'The vault isn\'t set up yet. Your owner sets it up on the Agent ID website.' };
  const rows = (checked(await ctx.admin.from('agent_id_vault_items').select('*').eq('resource_id', vm.id).order('created_at')) || []) as any[];
  return {
    ready: true,
    // What the Agent ID CLI seals a secret to before saving it (public).
    publicKey: vm.state.vault.publicKey,
    items: rows.map(row => ({ id: row.id, kind: row.kind, label: row.label, ...(row.kind === 'login' ? { site: row.site } : { hosts: row.hosts }), savedBy: row.saved_by === 'agent' ? 'agent' : 'owner' })),
  };
};

// The agent saves a key or a sign-in it was given, so it isn't kept in files
// or a conversation. It arrives sealed: the Agent ID CLI seals it on the
// agent's own computer, so a secret sent in the clear is refused unread.
const vaultSave: Op = async (ctx, who, input) => {
  if (!input?.envelope && ['secret', 'value', 'password', 'key'].some(field => input?.[field] !== undefined)) {
    throw fail(400, 'seal_first', 'Secrets are sealed on your own computer before they go anywhere, so Timewarp never has them. Save it with the Agent ID CLI: `timewarp-id vault save`, or the vault_save tool of `timewarp-id mcp`.');
  }
  const vm = await readyVault(ctx, who.agent);
  const label = str(input.label, 100, 'label', { required: true }).trim();
  const sealed = sealedOf(input);
  const waiting = await askFirst(ctx, who, 'vault', 'vaultSave', { label, envelope: sealed }, { label });
  if (waiting) return waiting;
  await rateLimit(ctx, who.userId, `vault-save:${who.agent.id}`, 20, 200, 'vault saves');
  return storeItem(ctx, who, vm, label, sealed, 'agent');
};

// A request with a key from the vault added on the agent's computer. The key
// only goes to the sites it's bound to, and it's taken out of what comes back.
const vaultRequest: Op = async (ctx, who, input) => {
  const vm = await readyVault(ctx, who.agent);
  const itemId = str(input.item, 40, 'item', { required: true });
  const row = checked(await ctx.admin.from('agent_id_vault_items').select('*').eq('id', itemId).eq('agent_id', who.agent.id).maybeSingle()) as any;
  if (!row) throw fail(404, 'not_found', 'No vault item with that id. vault_list shows them.');
  const url = str(input.url, 4000, 'url', { required: true });
  const method = input.method ? str(input.method, 10, 'method').toUpperCase() : 'GET';
  const headers = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers) ? Object.fromEntries(Object.entries(input.headers).slice(0, 30).map(([k, v]) => [String(k).slice(0, 64), String(v).slice(0, 4000)])) : {};
  const body = input.body === undefined || input.body === null ? undefined : typeof input.body === 'string' ? input.body.slice(0, 1_000_000) : JSON.stringify(input.body).slice(0, 1_000_000);
  await rateLimit(ctx, who.userId, `vault-request:${who.agent.id}`, 60, 2000, 'vault requests');
  let host = '';
  try { host = new URL(url).hostname; } catch { throw fail(400, 'invalid', 'url is not a web address.'); }
  let result: any;
  if (vm.mode === 'test') {
    const item = await testOpen(vm.state.testVault.privateKey, vm.state.testVault.items?.[row.id] || {});
    if (item.kind !== 'key') throw fail(409, 'wrong_kind', 'That item is a sign-in: it signs in through the browser, not in requests.');
    const hosts = (item.hosts as string[]).map(h => h.toLowerCase());
    if (!hosts.some(h => h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h)) throw fail(409, 'host_not_allowed', `This key can only be sent to ${hosts.join(', ')}.`);
    result = { status: 200, contentType: 'text/plain', body: `Test computer: this ${method} would go to ${host} with the key added. Nothing was sent.`, truncated: false };
  } else {
    result = await runOp(ctx, who, vm, 'request', { id: row.id, url, method, headers, ...(body !== undefined ? { body } : {}) }, 90);
  }
  await ctx.admin.from('agent_id_vault_items').update({ last_used_at: iso(ctx) }).eq('id', row.id);
  await audit(ctx, who.userId, who.agent.id, who.via === 'owner' ? 'owner' : 'agent', 'vault.request', { item: row.id, host, method, status: result.status });
  return result;
};

export const vaultOps: Record<string, Op> = { vaultList, vaultRequest, vaultSave };

export const vaultAgentRoutes: Route<AgentCaller>[] = [
  ['GET', '/v1/me/vault', (ctx, who, input) => vaultList(ctx, who, input)],
  ['POST', '/v1/me/vault/items', (ctx, who, input) => vaultSave(ctx, who, input)],
  ['POST', '/v1/me/vault/request', (ctx, who, input) => vaultRequest(ctx, who, input)],
];

export const vaultOwnerRoutes: Route<Owner>[] = [
  ['GET', '/v1/agents/:id/vault', (ctx, owner, _input, params) => vaultStatus(ctx, owner, params.id)],
  ['POST', '/v1/agents/:id/vault/setup', (ctx, owner, _input, params) => setupVault(ctx, owner, params.id)],
  ['POST', '/v1/agents/:id/vault/items', (ctx, owner, input, params) => addVaultItem(ctx, owner, params.id, input)],
  ['DELETE', '/v1/agents/:id/vault/items/:itemId', (ctx, owner, _input, params) => removeVaultItem(ctx, owner, params.id, params.itemId)],
];
