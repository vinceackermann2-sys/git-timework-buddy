import { computeCostUsd } from './aiCost.ts';
import { AI_COST_MARKUP, USD_PER_CREDIT } from './nativeBilling.ts';
export const AGENT_MODEL_OUTPUT_TOKENS = 16_384;
// Extra high and Max thinking count toward the output, so they get room for it.
export const DEEP_MODEL_OUTPUT_TOKENS = 32_768;
// Codex's approval reviews answer with a short verdict.
export const REVIEW_OUTPUT_TOKENS = 4_096;
export function responseOutputLimit(body:any) {
  const limit=['xhigh','max','ultra'].includes(body?.reasoning?.effort)?DEEP_MODEL_OUTPUT_TOKENS:AGENT_MODEL_OUTPUT_TOKENS;
  const value=body?.max_output_tokens;
  if(value===undefined||value===null)return limit;
  if(!Number.isSafeInteger(value)||value<1)throw Object.assign(new Error('Invalid output token limit.'),{status:400});
  return Math.min(value,limit);
}

// An image's width and height from the start of its base64 data (PNG, JPEG,
// GIF or WebP), decoding only the bytes it reads. Null when it can't tell.
export function imageSize(data: string): [number, number] | null {
  let checked = 0;
  const read = (offset: number, count: number) => {
    const start = Math.floor(offset / 3) * 4, skip = offset % 3, end = start + Math.ceil((skip + count) / 3) * 4;
    // Offsets into the text hold only while it is plain base64 up to there.
    if (end > checked) { if (!/^[A-Za-z0-9+/=]*$/.test(data.slice(checked, end))) throw new RangeError('Not plain base64.'); checked = end; }
    const bytes = atob(data.slice(start, end));
    if (bytes.length < skip + count) throw new RangeError('The image ends before its header does.');
    return (at: number) => bytes.charCodeAt(skip + at);
  };
  const size = (width: number, height: number): [number, number] | null => width > 0 && height > 0 ? [width, height] : null;
  try {
    const head = read(0, 30), be = (at: number) => head(at) << 8 | head(at + 1), le = (at: number) => head(at) | head(at + 1) << 8;
    if (be(0) === 0x8950 && be(2) === 0x4e47) return size(be(16) * 65536 + be(18), be(20) * 65536 + be(22));
    if (be(0) === 0x4749 && head(2) === 0x46) return size(le(6), le(8));
    if (be(0) === 0x5249 && be(2) === 0x4646 && be(8) === 0x5745 && be(10) === 0x4250) {
      const chunk = String.fromCharCode(head(12), head(13), head(14), head(15));
      if (chunk === 'VP8 ') return size(le(26) & 0x3fff, le(28) & 0x3fff);
      if (chunk === 'VP8L') { const bits = (head(21) | head(22) << 8 | head(23) << 16 | head(24) << 24) >>> 0; return size((bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1); }
      if (chunk === 'VP8X') return size((head(24) | head(25) << 8 | head(26) << 16) + 1, (head(27) | head(28) << 8 | head(29) << 16) + 1);
      return null;
    }
    // A JPEG's size is in its frame header; walk the segments before it.
    if (be(0) !== 0xffd8) return null;
    for (let at = 2, step = 0; step < 200; step++) {
      const marker = read(at, 4), type = marker(1);
      if (marker(0) !== 0xff) return null;
      if (type === 0xff) { at++; continue; }
      if (type >= 0xc0 && type <= 0xcf && type !== 0xc4 && type !== 0xc8 && type !== 0xcc) { const frame = read(at + 5, 4); return size(frame(2) << 8 | frame(3), frame(0) << 8 | frame(1)); }
      if (type === 0xd9 || type === 0xda) return null;
      at += type === 0x01 || (type >= 0xd0 && type <= 0xd8) ? 2 : 2 + (marker(2) << 8 | marker(3));
    }
  } catch { /* Not an image this can read. */ }
  return null;
}

// Images count by their pixels, not their base64 bytes. Claude bills a 28 px
// patch as a token and scales big images down to at most 4,784 tokens. GPT
// bills a 32 px patch times 1.2, never enlarges an image and keeps large ones
// whole by default (rejecting more than 30,000 patches). Twice the 28 px
// patch count covers both.
export const imageTokens = (width: number, height: number) => 2 * Math.ceil(width / 28) * Math.ceil(height / 28);

// An image whose size can't be read here (a link the provider fetches, a file
// id, a header this can't parse) counts as the most GPT bills for one image,
// 30,000 patches times 1.2, which is more than Claude's 4,784.
export const UNSIZED_IMAGE_TOKENS = 36_000;
// The most input any model takes: Claude's 1M context, GPT's 872K. A file
// bills by its pages, not its bytes (a small PDF can hold hundreds), so a
// request with one reserves this much.
export const MODEL_INPUT_TOKENS = 1_000_000;

// A request's input token ceiling. UTF-8 bytes are a conservative ceiling for
// the byte-based tokenizers; add schema/message framing. An image whose size
// can be read (in Responses input or Claude messages, tool results included)
// counts by imageTokens instead of its bytes; any other image counts as at
// least UNSIZED_IMAGE_TOKENS, and a file raises the request to
// MODEL_INPUT_TOKENS, so a call can't cost more than its reservation.
export function requestInputTokens(body: any, text = JSON.stringify(body)) {
  let tokens = new TextEncoder().encode(text).length + 4096, file = false;
  const count = (part: any) => {
    const url = part?.type === 'input_image' && typeof part.image_url === 'string' ? part.image_url : null;
    const prefix = url ? /^data:[^,;]*;base64,/.exec(url) : null;
    const data = prefix ? url!.slice(prefix[0].length) : part?.type === 'image' && part.source?.type === 'base64' && typeof part.source.data === 'string' ? part.source.data : null;
    const size = data === null ? null : imageSize(data);
    if (size) tokens += imageTokens(...size) - (url ?? data)!.length;
    else if (part?.type === 'input_image' || part?.type === 'image') tokens += Math.max(0, UNSIZED_IMAGE_TOKENS - (url ?? data ?? '').length);
    else if (part?.type === 'input_file' || part?.type === 'document') file = true;
    else if (part?.type === 'tool_result' && Array.isArray(part.content)) part.content.forEach(count);
  };
  for (const item of Array.isArray(body?.input) ? body.input : Array.isArray(body?.messages) ? body.messages : []) {
    for (const parts of [item?.content, item?.output]) if (Array.isArray(parts)) parts.forEach(count);
  }
  return file ? Math.max(tokens, MODEL_INPUT_TOKENS) : tokens;
}

export async function reserveAgentAi(admin: any, userId: string, model: string, body: unknown, bounds?: { inputTokens?: number; outputTokens?: number }) {
  // Include the bounded reasoning+output allowance. Non-text requests (audio)
  // pass their own ceilings.
  const inputCeiling = bounds?.inputTokens ?? requestInputTokens(body);
  // Reserve the worst case (all input written to cache); settle actual categories.
  const credits = computeCostUsd(model, inputCeiling, bounds?.outputTokens ?? responseOutputLimit(body), { cache_write_tokens: inputCeiling }) * AI_COST_MARKUP / USD_PER_CREDIT;
  const id = crypto.randomUUID();
  // The most this call can be charged. The ledger refuses a cost above the
  // reservation, which would leave the call unbilled, so usage past it is
  // charged the whole reservation (just under, for rounding) and logged.
  const reservedUsd = credits * USD_PER_CREDIT / AI_COST_MARKUP;
  const charged = (input: number, output: number, details?: { cached_tokens?: number; cache_write_tokens?: number; speed?: string }) => {
    const cost = computeCostUsd(model, input, output, details);
    if (cost <= reservedUsd) return cost;
    console.error('[timewarp] AI usage exceeded its reservation; the reservation is charged.', { reservationId: id, model, inputTokens: input, outputTokens: output, costUsd: cost, reservedUsd });
    return reservedUsd * (1 - 1e-9);
  };
  let known: { outcome: 'settled' | 'released'; input: number; output: number; cost: number } | null = null;
  const reservation = {
    id,
    async finish(outcome: 'settled' | 'released' | 'uncertain', input = 0, output = 0, details?: { cached_tokens?: number; cache_write_tokens?: number; speed?: string }) {
      const candidate = known || { outcome, input, output, cost: charged(input, output, details) };
      if (candidate.outcome !== 'uncertain') known = { ...candidate, outcome: candidate.outcome };
      const desired = candidate;
      const params = { p_id: id, p_user_id: userId, p_model: model, p_input: desired.input,
        p_output: desired.output, p_cost: desired.cost, p_outcome: desired.outcome };
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await admin.rpc('timewarp_energy_complete_ai', params);
        if (!error) return data; // A durable queued settlement may still be pending.
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
      // Usage-only operator evidence survives a database outage in function logs.
      // The deployed log retention/alert destination is a release requirement.
      console.error('[timewarp] AI settlement evidence could not be saved.', { reservationId: id, model,
        outcome: desired.outcome, inputTokens: desired.input, outputTokens: desired.output, costUsd: params.p_cost });
      throw new Error('AI usage reconciliation is pending; its allowance remains reserved.');
    },
  };
  const { data, error } = await admin.rpc('timewarp_reserve_agent_ai', { p_id: id, p_user_id: userId, p_credits: credits });
  if (error || data !== true) throw Object.assign(new Error(error ? 'AI budget reservation is unavailable. No model request was sent.' : 'Not enough unreserved AI credits for this bounded model call. Other agent work may still be using the shared allowance.'), { status: error ? 503 : 402 });
  return reservation;
}
