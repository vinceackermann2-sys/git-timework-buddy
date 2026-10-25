// Tracing what an agent makes back to it. `mark` puts Agent ID's hidden mark
// in a picture (PNG), a sound (WAV) or a text file, keeps code as it is with a
// fingerprint, and records anything else by its hash. `check` asks whether a
// file or text was made by an agent with an Agent ID, and who answers for it.
import fs from 'node:fs';
import path from 'node:path';
import { CliError, UsageError } from '../errors.js';
import { fields, when } from '../output.js';
import { SITE } from '../config.js';

const CODE = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ps1|sql|lua|dart|scala|vue|svelte)$/i;
const TEXT = /\.(txt|md|markdown|csv|html?|json|xml|ya?ml)$/i;
const TYPES = { png: 'image/png', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf' };
const typeOf = file => TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
const MARKED = { mark: 'Marked', fingerprint: 'Recorded by its fingerprint', record: 'Recorded' };

function read(ctx, file) {
  const full = path.resolve(ctx.cwd, file);
  try { return { full, bytes: fs.readFileSync(full) }; } catch { throw new CliError(`Can't read ${file}.`); }
}

// Marks a file on this computer, in place (or into `outFile`): pictures and
// sound through a marked copy Agent ID makes, text and code as text.
export async function markFile(ctx, file, outFile = null) {
  const { full, bytes } = read(ctx, file);
  const out = path.resolve(ctx.cwd, outFile || file);
  let data;
  if (CODE.test(full) || TEXT.test(full)) {
    data = await ctx.self.post('/v1/me/trace', { text: bytes.toString('utf8'), kind: CODE.test(full) ? 'code' : 'text' });
    if (data.marked === 'mark' || out !== full) fs.writeFileSync(out, data.text);
  } else {
    const { file: uploaded } = await ctx.self.upload('/v1/me/files', bytes, { 'content-type': typeOf(full), 'x-filename': encodeURIComponent(path.basename(full)) });
    data = await ctx.self.post('/v1/me/trace', { fileId: uploaded.id });
    if (data.marked === 'mark') fs.writeFileSync(out, await ctx.self.download(`/v1/me/files/${encodeURIComponent(data.file.id)}`));
    else if (out !== full) fs.copyFileSync(full, out);
  }
  return { data, out };
}

export async function mark(ctx) {
  const file = ctx.args[0];
  if (ctx.flags.text !== undefined) {
    const text = ctx.flags.text === '-' ? (await ctx.readStdin()).replace(/\r\n/g, '\n') : String(ctx.flags.text);
    const data = await ctx.self.post('/v1/me/trace', { text, kind: ctx.flags.code ? 'code' : 'text' });
    // The marked text alone on stdout, so it can be piped on.
    return ctx.json ? ctx.print(data) : ctx.out(data.text);
  }
  if (!file) throw new UsageError('What to mark: timewarp-id mark <file> [--out <file>], or --text "…" (--text - reads stdin).');
  const { data, out } = await markFile(ctx, file, typeof ctx.flags.out === 'string' ? ctx.flags.out : null);
  return ctx.print(data, () => [
    `${MARKED[data.marked] || 'Recorded'}: ${path.relative(ctx.cwd, out) || path.basename(out)} can be traced to ${data.trace.agent.name} (${data.trace.id}).`,
    data.marked === 'record' ? 'Only its exact bytes are recorded: a hidden mark needs a PNG picture or a WAV sound.' : null,
    data.marked === 'fingerprint' ? 'Code is left as it is: copies, even edited ones, are matched by its fingerprint.' : null,
    `Anyone can check it: ${SITE}/agent-id/check`,
  ].filter(Boolean).join('\n'));
}

export async function check(ctx) {
  const file = ctx.args[0];
  let data;
  if (ctx.flags.text !== undefined) {
    const text = ctx.flags.text === '-' ? await ctx.readStdin() : String(ctx.flags.text);
    data = await ctx.api.request('POST', '/v1/trace/check', { raw: text, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  } else {
    if (!file) throw new UsageError('What to check: timewarp-id check <file>, or --text "…" (--text - reads stdin).');
    const { full, bytes } = read(ctx, file);
    const type = CODE.test(full) || TEXT.test(full) ? 'text/plain; charset=utf-8' : typeOf(full);
    data = await ctx.api.request('POST', '/v1/trace/check', { raw: bytes, headers: { 'content-type': type } });
  }
  return ctx.print(data, () => {
    if (!data.found) return 'No Agent ID mark found. That doesn\'t prove a person made it: only work made through Agent ID carries one.';
    const { trace } = data;
    const owner = trace.owner.name || (trace.owner.verified ? `a verified ${trace.owner.type}` : 'a person, not verified yet');
    return [
      `Made by AI: ${trace.agent.name}${trace.agent.model ? `, ${trace.agent.model.label}${[trace.agent.model.provider, trace.agent.model.name].filter(Boolean).length ? ` (${[trace.agent.model.provider, trace.agent.model.name].filter(Boolean).join(' ')})` : ''}` : ''}.`,
      fields([
        ['Answers for it', owner],
        ['Made', when(trace.createdAt)],
        ['Through', [trace.app?.label, trace.model, trace.provider].filter(Boolean).join(' · ') || null],
        ['Found by', data.match === 'mark' ? 'its hidden mark' : data.match === 'exact' ? 'the same file' : `its fingerprint (${Math.round((data.similarity || 0) * 100)}% the same)`],
        ['Trace', trace.id],
      ]),
    ].join('\n');
  });
}
