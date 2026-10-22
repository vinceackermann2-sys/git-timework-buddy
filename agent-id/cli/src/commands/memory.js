// `timewarp-id memory`: the agent's memory, which follows it into every app
// it works in, kept encrypted by Agent ID. `memory import` brings what's
// already on this computer (Claude Code, Codex, Cursor, Antigravity,
// Windsurf), asked first, with keys and passwords left out; the first run
// offers it once for the agent it set up.
import { CliError, UsageError } from '../errors.js';
import { findProfile } from '../config.js';
import { clip, table, when } from '../output.js';
import { collect, SOURCE_NAMES, SOURCES } from '../memory.js';

const need = (value, message) => { if (value === undefined || value === null || value === '' || value === true) throw new UsageError(message); return String(value); };
const rows = memories => table(memories, [
  ['ID', m => m.id], ['FROM', m => m.from || m.source], ['TOPIC', m => clip(m.topic || '', 24)], ['MEMORY', m => clip((m.text || m.note || '').replace(/\s+/g, ' '), 70)], ['SAVED', m => when(m.createdAt)],
]);

export async function memory(ctx) {
  const action = ctx.args[0] || 'list';
  if (action === 'list' || action === 'ls') {
    const data = await ctx.self.get('/v1/me/memories', { query: { limit: ctx.flags.limit } });
    return ctx.print(data, ({ memories, total }) => memories.length ? `${rows(memories)}${total > memories.length ? `\n${memories.length} of ${total}.` : ''}` : `Nothing remembered yet. Bring what's on this computer with: ${ctx.bin} memory import`);
  }
  if (action === 'search' || action === 'find') {
    const query = need((ctx.rest.length ? ctx.rest : ctx.args.slice(1)).join(' ').trim(), `What about? ${ctx.bin} memory search <words…>`);
    const data = await ctx.self.get('/v1/me/memories/search', { query: { query, limit: ctx.flags.limit } });
    return ctx.print(data, ({ memories, note }) => memories.length ? rows(memories) : note || 'Nothing remembered about that.');
  }
  if (action === 'save' || action === 'add' || action === 'remember') {
    const words = (ctx.rest.length ? ctx.rest : ctx.args.slice(1)).join(' ').trim();
    const text = ctx.flags.text === '-' ? (await ctx.readStdin()).trim() : need(typeof ctx.flags.text === 'string' ? ctx.flags.text : words, `What should it remember? ${ctx.bin} memory save <text…>`);
    const data = await ctx.self.post('/v1/me/memories', { text, ...(typeof ctx.flags.topic === 'string' ? { topic: ctx.flags.topic } : {}) });
    return ctx.print(data, ({ memory: m, note }) => note ? `${note} (${m.id})` : `Remembered (${m.id}).`);
  }
  if (action === 'forget' || action === 'rm' || action === 'delete') {
    const id = need(ctx.args[1], `Which memory? ${ctx.bin} memory forget <id> (see \`${ctx.bin} memory list\`).`);
    const data = await ctx.self.delete(`/v1/me/memories/${encodeURIComponent(id)}`);
    return ctx.print(data, () => 'Forgotten.');
  }
  if (action === 'import') {
    const agent = ctx.agent();
    const result = await importMemory(ctx, { post: body => ctx.self.post('/v1/me/memories/import', body), agentName: agent.name || agent.handle || 'the agent' });
    if (result?.done && agent.agentId) remember(ctx, agent.agentId, 'imported');
    return result?.code ?? 0;
  }
  throw new UsageError(`memory has no "${action}" command.`);
}

function sourcesOf(ctx) {
  if (typeof ctx.flags.from !== 'string') return Object.keys(SOURCES);
  const names = ctx.flags.from.split(',').map(name => name.trim().toLowerCase()).map(name => name === 'claude' ? 'claude-code' : name === 'gemini' ? 'antigravity' : name).filter(Boolean);
  for (const name of names) if (!SOURCES[name]) throw new UsageError(`--from lists ${Object.keys(SOURCES).join(', ')}.`);
  return names;
}

// Finds the memory on this computer, says what it found, asks, then sends it
// in batches. Without a terminal it needs --yes.
export async function importMemory(ctx, { post, agentName, question = null, quiet = false }) {
  const { found, skipped, removed } = await collect({ env: ctx.env, from: sourcesOf(ctx) });
  const items = Object.values(found).flat();
  const summary = Object.entries(found).map(([name, list]) => `  ${SOURCE_NAMES[name]}: ${list.length} ${list.length === 1 ? 'memory' : 'memories'}`);
  if (!items.length) {
    // Offered on the first run: nothing found, nothing said.
    if (quiet) return { code: 0, done: false };
    ctx.print({ found: 0, skipped }, () => `No memory found on this computer from Claude Code, Codex, Cursor, Antigravity or Windsurf.${skipped.length ? `\nSkipped: ${skipped.join('; ')}.` : ''}`);
    return { code: 0, done: false };
  }
  const told = [
    `Memory found on this computer:`, ...summary,
    ...(removed ? [`  (${removed} line${removed === 1 ? '' : 's'} that looked like keys or passwords left out: those belong in the vault)`] : []),
    ...(skipped.length ? [`  Skipped: ${skipped.join('; ')}`] : []),
  ].join('\n');
  if (ctx.flags['dry-run']) {
    ctx.print({ found: Object.fromEntries(Object.entries(found).map(([name, list]) => [name, list.map(({ text, topic }) => ({ topic, text }))])), removed, skipped }, () => told);
    return { code: 0, done: false };
  }
  if (!ctx.flags.yes) {
    if (!ctx.interactive) throw new UsageError('Add --yes to import without being asked (or --dry-run to see what would be imported).');
    if (!ctx.json) ctx.err(`${quiet ? '\n' : ''}${told}`);
    const answer = (await ctx.ask(question || `Bring ${items.length === 1 ? 'it' : `these ${items.length}`} into ${agentName}'s memory? It's kept encrypted, and you can see and delete it on Agent ID. [Y/n] `) ?? '').trim().toLowerCase();
    if (answer && !/^y(es)?$/.test(answer)) { ctx.out('Not imported.'); return { code: 0, done: false, declined: true }; }
  }
  const totals = { added: 0, duplicates: 0, skipped: 0 };
  let note = null;
  for (let i = 0; i < items.length; i += 200) {
    const batch = items.slice(i, i + 200).map(({ text, topic, from }) => ({ text, topic, from }));
    const result = await post({ items: batch });
    for (const key of Object.keys(totals)) totals[key] += result[key] || 0;
    if (result.note) { note = result.note; break; }
  }
  ctx.print({ ...totals, removed, ...(note ? { note } : {}) }, () => `Imported ${totals.added} ${totals.added === 1 ? 'memory' : 'memories'} into ${agentName}'s memory${totals.duplicates ? ` (${totals.duplicates} already there)` : ''}${totals.skipped ? `, ${totals.skipped} left out` : ''}.${note ? `\n${note}` : ''}`);
  return { code: 0, done: true };
}

// Whether this computer's memory was offered to an agent already.
function remember(ctx, agentId, how) {
  ctx.config.memoryImported = { ...(ctx.config.memoryImported || {}), [agentId]: { how, at: new Date().toISOString() } };
  try { ctx.save(); } catch { /* the next run asks again */ }
}

// After the first run sets an agent up, in a terminal: the memory on this
// computer, offered once.
export async function offerMemory(ctx, agent) {
  if (!ctx.interactive || ctx.json || ctx.flags.memory === false || !agent?.id) return;
  if (ctx.config.memoryImported?.[agent.id]) return;
  const key = findProfile(ctx.config, agent.handle)?.key;
  if (!key) return;
  try {
    const result = await importMemory(ctx, {
      quiet: true,
      post: body => ctx.api.post('/v1/me/memories/import', body, { token: key }), agentName: agent.name || agent.handle,
      question: `Bring it into ${agent.name || agent.handle}'s memory, so it knows you in every app? It's kept encrypted, and you can see and delete it on Agent ID. [Y/n] `,
    });
    if (result.done || result.declined) remember(ctx, agent.id, result.done ? 'imported' : 'declined');
  } catch (error) {
    // Setting up worked; memory can come later.
    ctx.err(`Memory wasn't imported: ${error.message}. Try again with \`${ctx.bin} memory import --agent ${agent.handle}\`.`);
    if (!(error instanceof CliError) && !(error?.status)) throw error;
  }
}
