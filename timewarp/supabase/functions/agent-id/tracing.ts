// Tracing what agents make back to them. Pictures (PNG) and sound (WAV) get a
// hidden mark (trace/), text an invisible one and a fingerprint, code only a
// fingerprint (marks would break it), and other files a record of their hash.
// Each output is one row in agent_id_traces whose id is the mark; the output
// itself is never kept. Anyone can check a file (/v1/trace/check). Agents
// mark what they make (/v1/me/trace), Agent ID marks what it sends for them
// (mail, texts, calls), and a model maker marks what it makes for an agent
// that shows it a passport for the trace audience (/v1/trace/mark).
import { CORS, checked, fail, hex, hmac, sha256Hex, str } from './util.ts';
import type { AgentCaller, Route } from './app.ts';
import type { AgentRow, Ctx } from './context.ts';
import { audit, rateLimit, verificationOf } from './shared.ts';
import { APPS, appForClient, modelOf, modelView } from './origin.ts';
import { fileBytes, fileView, saveFile } from './files.ts';
import { signJwt, verifyJwt } from './passport.ts';
import { decodePng, encodePng } from './trace/png.ts';
import { detectImage, embedImage } from './trace/image.ts';
import { decodeWav, encodeWav } from './trace/wav.ts';
import { detectAudio, embedAudio } from './trace/audio.ts';
import { embedText, extractText, fingerprint } from './trace/text.ts';
import { markId, newMark } from './trace/payload.ts';

export type TraceKind = 'image' | 'audio' | 'text' | 'code' | 'video' | 'other';
type Via = 'agent' | 'provider' | 'mail' | 'sms' | 'call';
type Made = { text?: string; bytes?: Uint8Array; mime?: string; filename?: string; kind?: TraceKind };
type By = { agent: AgentRow; userId: string; via: Via; app?: string | null; model?: string | null; provider?: string | null };

// What is marked inside, and what only recorded: big pictures and long sound
// would take longer to mark than a request may run.
const MAX_MARK_PIXELS = 4_200_000;
const MAX_MARK_SAMPLES = 48_000 * 60;
// Text shorter than this many fingerprint hashes is only matched exactly.
const MIN_HASHES = 8;
const MAX_TEXT = 200_000;

export const traceAudience = (ctx: Ctx) => `${ctx.config.issuer}/trace`;

// The key marks are made and found with. It must never change, or marks made
// before can't be found: AGENT_ID_TRACE_KEY, else one derived from the
// deployment's webhook secret, which is kept for good too.
let derived: { source: string; key: string } | null = null;
async function traceKey(ctx: Ctx) {
  const own = ctx.config.env('AGENT_ID_TRACE_KEY'), secret = ctx.config.webhookSecret;
  if (!own && !secret) throw fail(503, 'trace_unavailable', 'Tracing is not set up on this deployment yet.');
  if (own && own.length < 16) throw fail(503, 'trace_unavailable', 'AGENT_ID_TRACE_KEY must be at least 16 characters.');
  const source = own || secret;
  if (derived?.source !== source) derived = { source, key: own || hex(await hmac(secret, 'agent-id-trace-v1')) };
  return derived.key;
}

const CODE_FILES = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ps1|sql|lua|dart|scala|r|m|vue|svelte)$/i;
export function kindOf(mime = '', filename = ''): TraceKind {
  const type = mime.split(';')[0].trim().toLowerCase();
  if (CODE_FILES.test(filename) || /javascript|typescript|x-python|x-sh|x-c|x-java/.test(type)) return 'code';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || type === 'application/json' || /\.(txt|md|csv|html?|json|xml|ya?ml)$/i.test(filename)) return 'text';
  return 'other';
}
const isPng = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
// A PNG's size from its header, before decoding it takes the memory.
const pngPixels = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes.length >= 24 ? view.getUint32(16) * view.getUint32(20) : Infinity;
};
const isWav = (bytes: Uint8Array) => bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
const decoder = new TextDecoder('utf-8', { fatal: false });
// Fingerprint hashes as Postgres integers (signed 32-bit), each once.
const hashesOf = (shingles: number[]) => [...new Set(shingles.map(hash => hash | 0))];

// Marks one output and records it. Returns what goes out instead: the marked
// text or bytes (unchanged when it could only be recorded).
export async function traceOutput(ctx: Ctx, by: By, made: Made) {
  const key = await traceKey(ctx);
  const mark = newMark(), id = markId(mark);
  let kind: TraceKind = made.kind || (made.text !== undefined ? 'text' : kindOf(made.mime, made.filename));
  let out: { text?: string; bytes?: Uint8Array } = {}, marked: 'mark' | 'record' | 'fingerprint' = 'record';
  let sha256: string, markedSha256: string | null = null, hashes: number[] | null = null, size: number;

  if (made.text !== undefined || kind === 'text' || kind === 'code') {
    const text = made.text ?? decoder.decode(made.bytes);
    if (text.length > MAX_TEXT) throw fail(413, 'too_large', `Text can be at most ${MAX_TEXT.toLocaleString('en-US')} characters.`);
    const print = await fingerprint(text);
    sha256 = print.exact;
    hashes = print.shingles.length >= MIN_HASHES ? hashesOf(print.shingles) : null;
    // Code is left exactly as it is, and so are texts and calls (a hidden
    // character would turn a text into a longer, pricier kind). Mail gets a
    // header instead.
    const inside = kind !== 'code' && by.via !== 'sms' && by.via !== 'call' && by.via !== 'mail';
    // Where no mark fits (code-like lines, a line starting with a link, text
    // without spaces), it goes out as it is and the fingerprint links it.
    const result = inside ? embedText(text, mark) : text;
    out = made.text !== undefined ? { text: result } : { bytes: new TextEncoder().encode(result) };
    marked = result !== text ? 'mark' : 'fingerprint';
    if (marked === 'mark') markedSha256 = await sha256Hex(result);
    size = text.length;
  } else {
    const bytes = made.bytes || new Uint8Array();
    sha256 = await sha256Hex(bytes);
    size = bytes.byteLength;
    out = { bytes };
    if (kind === 'image' && isPng(bytes) && pngPixels(bytes) <= MAX_MARK_PIXELS) {
      out = { bytes: await encodePng(await embedImage(await decodePng(bytes), mark, key)) };
      marked = 'mark';
    } else if (kind === 'audio' && isWav(bytes)) {
      const audio = decodeWav(bytes);
      if ((audio.channels[0]?.length || 0) <= MAX_MARK_SAMPLES) {
        out = { bytes: encodeWav(await embedAudio(audio, mark, key)) };
        marked = 'mark';
      }
    }
    if (marked === 'mark') markedSha256 = await sha256Hex(out.bytes!);
    if (kind !== 'image' && kind !== 'audio' && kind !== 'video') kind = 'other';
  }

  // A receipt anyone can check offline against Agent ID's public keys: this
  // agent made this output, at this time.
  const at = Math.floor(ctx.now() / 1000);
  const receipt = ctx.config.signingKey ? await signJwt(ctx.config, {
    iss: ctx.config.issuer, aud: traceAudience(ctx), sub: by.agent.id, jti: id, iat: at,
    trace: { kind, marked, sha256, ...(markedSha256 ? { markedSha256 } : {}) },
  }) : null;
  const row = checked(await ctx.admin.from('agent_id_traces').insert({
    id, agent_id: by.agent.id, owner_user_id: by.agent.owner_user_id, kind, marked, via: by.via, receipt, created_at: new Date(at * 1000).toISOString(),
    provider: by.provider || null, app: by.app ?? ctx.via?.app ?? null, model: by.model ?? ctx.via?.model ?? null,
    mime: made.mime ? made.mime.split(';')[0].trim().slice(0, 150) : null, size_bytes: size,
    sha256, marked_sha256: markedSha256, fingerprint: hashes,
  }).select('*').single());
  return { row, ...out, marked };
}

// The public view of a record: the agent, what kind of AI, and who answers
// for it (a verified business by name, a person never by name).
async function traceView(ctx: Ctx, row: any) {
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', row.agent_id).maybeSingle()) as AgentRow | null;
  if (!agent) return null;
  const verification = await verificationOf(ctx, agent);
  const business = verification.level === 'kyb' ? verification.business : null;
  return {
    id: row.id, kind: row.kind, createdAt: row.created_at, marked: row.marked, via: row.via, provider: row.provider || null,
    agent: { name: agent.name, handle: agent.handle, mascot: agent.mascot || null, model: modelView(agent), status: agent.status },
    owner: {
      verified: verification.verified, type: business ? 'business' : 'person',
      name: business?.legalName || null, country: business?.country || verification.person?.country || null,
    },
    app: row.app ? { app: row.app, label: APPS[row.app] || row.app } : null,
    model: row.model || null,
    receipt: row.receipt || null,
  };
}

async function byId(ctx: Ctx, id: string) {
  return checked(await ctx.admin.from('agent_id_traces').select('*').eq('id', id).maybeSingle()) as any;
}
async function byHash(ctx: Ctx, sha256: string) {
  const rows = (checked(await ctx.admin.from('agent_id_traces').select('*').eq('marked_sha256', sha256).limit(1)) || []) as any[];
  if (rows.length) return rows[0];
  return ((checked(await ctx.admin.from('agent_id_traces').select('*').eq('sha256', sha256).order('created_at', { ascending: true }).limit(1)) || []) as any[])[0] || null;
}

async function found(ctx: Ctx, row: any, kind: TraceKind, match: 'mark' | 'fingerprint' | 'exact', similarity?: number) {
  const trace = row && await traceView(ctx, row);
  return trace ? { found: true, kind, match, ...(similarity !== undefined ? { similarity: Math.round(similarity * 100) / 100 } : {}), trace } : { found: false, kind };
}

// Finds the record a picture, sound or text came from: its hidden mark first,
// then the exact bytes, then (text and code) the share of its fingerprint
// that matches one record.
export async function checkOutput(ctx: Ctx, made: Made) {
  const key = await traceKey(ctx);
  if (made.text !== undefined || kindOf(made.mime, made.filename) === 'text' || kindOf(made.mime, made.filename) === 'code') {
    const text = made.text ?? decoder.decode(made.bytes);
    if (text.length > MAX_TEXT) throw fail(413, 'too_large', `Text can be at most ${MAX_TEXT.toLocaleString('en-US')} characters.`);
    const mark = extractText(text);
    if (mark) { const row = await byId(ctx, markId(mark)); if (row) return found(ctx, row, row.kind, 'mark'); }
    const print = await fingerprint(text);
    const exact = await byHash(ctx, print.exact);
    if (exact) return found(ctx, exact, exact.kind, 'exact');
    const mine = hashesOf(print.shingles);
    if (mine.length >= MIN_HASHES) {
      const { data } = await ctx.admin.rpc('agent_id_trace_matches', { p_hashes: mine });
      const best = ((data || []) as any[])[0];
      const share = best ? Number(best.shared) / mine.length : 0;
      if (best && share >= 0.5) return found(ctx, await byId(ctx, best.id), best.kind, 'fingerprint', share);
    }
    return { found: false, kind: 'text' as TraceKind };
  }
  const bytes = made.bytes || new Uint8Array();
  const kind = kindOf(made.mime, made.filename);
  const exact = await byHash(ctx, await sha256Hex(bytes));
  if (exact) return found(ctx, exact, exact.kind, 'exact');
  let detection: { found: boolean; mark?: Uint8Array } | null = null;
  if (isPng(bytes)) {
    if (pngPixels(bytes) > MAX_MARK_PIXELS) throw fail(413, 'too_large', 'Send the picture at most 2048 pixels wide and high.');
    detection = await detectImage(await decodePng(bytes), key);
  } else if (isWav(bytes)) {
    detection = await detectAudio(decodeWav(bytes), key);
  } else if (kind === 'image' || kind === 'audio') {
    throw fail(415, 'unsupported', 'Send pictures as PNG and sound as WAV. The Agent ID website converts other formats for you.');
  }
  const answerKind: TraceKind = isPng(bytes) ? 'image' : isWav(bytes) ? 'audio' : kind;
  if (detection?.found && detection.mark) {
    const row = await byId(ctx, markId(detection.mark));
    if (row) return found(ctx, row, row.kind, 'mark');
  }
  return { found: false, kind: answerKind };
}

// --- Routes --------------------------------------------------------------------------

const MAX_BODY = 10 * 1024 * 1024;
async function rawBody(req: Request) {
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw fail(413, 'too_large', 'Send at most 10 MB.');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY) throw fail(413, 'too_large', 'Send at most 10 MB.');
  if (!bytes.byteLength) throw fail(400, 'invalid', 'Send the picture, sound or text as the request body.');
  return bytes;
}
const isText = (mime: string) => /^text\//i.test(mime) || /json/i.test(mime);

// An agent marks what it made: text (JSON { text, kind? }) or a file it
// uploaded (JSON { fileId }); a marked copy of the file is saved beside it.
async function markMine(ctx: Ctx, who: AgentCaller, input: any) {
  await rateLimit(ctx, who.userId, `trace:${who.agent.id}`, 60, 2000, 'marks');
  const model = input.model !== undefined ? modelOf(input.model) : null;
  const by: By = { agent: who.agent, userId: who.userId, via: 'agent', ...(model ? { model } : {}) };
  const actor = who.via === 'owner' ? 'owner' : 'agent';
  if (input.fileId !== undefined) {
    const id = str(input.fileId, 60, 'fileId', { required: true });
    const file = /^[0-9a-f-]{36}$/.test(id) ? checked(await ctx.admin.from('agent_id_files').select('*').eq('id', id).eq('agent_id', who.agent.id).maybeSingle()) : null;
    if (!file) throw fail(404, 'not_found', 'No file with that id. Upload it first.');
    const result = await traceOutput(ctx, by, { bytes: await fileBytes(ctx, file), mime: file.content_type, filename: file.filename });
    const copy = result.marked === 'mark' || result.row.kind === 'text'
      ? await saveFile(ctx, who.agent, { filename: file.filename, contentType: file.content_type, bytes: result.bytes! })
      : file;
    await audit(ctx, who.userId, who.agent.id, actor, 'trace.mark', { trace: result.row.id, kind: result.row.kind, marked: result.marked });
    return { trace: await traceView(ctx, result.row), marked: result.marked, file: fileView(copy) };
  }
  // As given, to the last space and line ending: code must stay exactly as it is.
  if (typeof input.text !== 'string' || !input.text.trim()) throw fail(400, 'invalid', 'text is required: the text or code you made, or fileId for an upload.');
  const kind = input.kind === 'code' ? 'code' : 'text';
  const result = await traceOutput(ctx, by, { text: input.text, kind });
  await audit(ctx, who.userId, who.agent.id, actor, 'trace.mark', { trace: result.row.id, kind, marked: result.marked });
  return { trace: await traceView(ctx, result.row), marked: result.marked, text: result.text };
}

export const traceAgentRoutes: Route<AgentCaller>[] = [
  ['POST', '/v1/me/trace', (ctx, who, input) => markMine(ctx, who, input)],
];

type Op = (ctx: Ctx, who: AgentCaller, input: any) => Promise<unknown>;
export const traceOps: Record<string, Op> = {
  traceMark: (ctx: Ctx, who: AgentCaller, input: any) => markMine(ctx, who, input),
  traceCheck: async (ctx: Ctx, who: AgentCaller, input: any) => {
    if (input.fileId !== undefined) {
      const id = str(input.fileId, 60, 'fileId', { required: true });
      const file = /^[0-9a-f-]{36}$/.test(id) ? checked(await ctx.admin.from('agent_id_files').select('*').eq('id', id).eq('agent_id', who.agent.id).maybeSingle()) : null;
      if (!file) throw fail(404, 'not_found', 'No file with that id.');
      return checkOutput(ctx, { bytes: await fileBytes(ctx, file), mime: file.content_type, filename: file.filename });
    }
    return checkOutput(ctx, { text: str(input.text, MAX_TEXT, 'text', { required: true, multiline: true }) });
  },
};

// Open to everyone: checking a file, and one record by its id.
export async function publicCheck(ctx: Ctx, req: Request) {
  // Checks take work, so each network gets a fair share (counted under a
  // stand-in id made from its address).
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
  if (ip) {
    const h = await sha256Hex(`trace-check:${ctx.config.webhookSecret}:${ip}`);
    await rateLimit(ctx, `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`, 'trace-check', 30, 1000, 'checks');
  }
  const mime = req.headers.get('content-type') || '';
  const bytes = await rawBody(req);
  return checkOutput(ctx, isText(mime) ? { text: decoder.decode(bytes) } : { bytes, mime });
}
export async function publicTrace(ctx: Ctx, id: string) {
  const row = /^tr_[0-9a-f]{16}$/.test(id) ? await byId(ctx, id) : null;
  const trace = row && await traceView(ctx, row);
  if (!trace) throw fail(404, 'not_found', 'No Agent ID trace with that id.');
  return { trace };
}

// A model maker marks what it made for an agent: the agent gives it a
// passport for the trace audience, and it sends the output (PNG, WAV or text)
// as the body. It gets the marked output back, with its id in Agent-Trace.
export async function providerMark(ctx: Ctx, req: Request, query: URLSearchParams) {
  const passport = (req.headers.get('agent-passport') || '').trim();
  if (!passport) throw fail(401, 'passport_required', `Send the agent's passport for ${traceAudience(ctx)} in an Agent-Passport header.`);
  const { claims } = await verifyJwt(ctx.config, passport, traceAudience(ctx), ctx.now());
  const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', String(claims.sub)).maybeSingle()) as AgentRow | null;
  if (!agent || agent.status !== 'active') throw fail(403, 'agent_inactive', 'This agent is paused or revoked by its owner.');
  await rateLimit(ctx, agent.owner_user_id, `trace:${agent.id}`, 60, 2000, 'marks');
  const mime = req.headers.get('content-type') || 'application/octet-stream';
  const bytes = await rawBody(req);
  const provider = str(query.get('provider') || '', 100, 'provider') || null;
  const model = modelOf(query.get('model') || '');
  const kind = query.get('kind') === 'code' ? 'code' : undefined;
  const by: By = { agent, userId: agent.owner_user_id, via: 'provider', provider, model, app: provider ? appForClient(provider) : null };
  const result = await traceOutput(ctx, by, isText(mime) ? { text: decoder.decode(bytes), kind } : { bytes, mime });
  await audit(ctx, agent.owner_user_id, agent.id, 'provider', 'trace.mark', { trace: result.row.id, kind: result.row.kind, marked: result.marked, provider });
  const body = result.text !== undefined ? new TextEncoder().encode(result.text) : result.bytes!;
  return new Response(body as BodyInit, { headers: { ...CORS, 'content-type': isText(mime) ? 'text/plain; charset=utf-8' : mime, 'agent-trace': result.row.id, 'agent-trace-marked': result.marked, 'access-control-expose-headers': 'agent-trace, agent-trace-marked', 'cache-control': 'no-store' } });
}

// What Agent ID sends for an agent (mail, texts, calls) is traced as it goes:
// the text by its fingerprint, and pictures and sound attached to mail get a
// marked copy that goes instead.
export async function traceOutgoing(ctx: Ctx, who: AgentCaller, via: 'mail' | 'sms' | 'call', text: string, files: any[] = []) {
  try {
    const result = await traceOutput(ctx, { agent: who.agent, userId: who.userId, via }, { text });
    const sent: any[] = [];
    for (const file of files) {
      const bytes = await fileBytes(ctx, file);
      const traced = await traceOutput(ctx, { agent: who.agent, userId: who.userId, via }, { bytes, mime: file.content_type, filename: file.filename });
      sent.push(traced.marked === 'mark' ? { ...await saveFile(ctx, who.agent, { filename: file.filename, contentType: file.content_type, bytes: traced.bytes! }), traced: traced.row.id } : file);
    }
    return { trace: result.row.id as string, files: sent };
  } catch (error) {
    // Tracing never stops a message: it goes out recorded as untraced.
    console.error('[agent-id] trace outgoing', (error as any)?.message);
    return { trace: null, files };
  }
}

