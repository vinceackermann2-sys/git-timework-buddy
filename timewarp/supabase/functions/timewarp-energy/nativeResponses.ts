import { requestInputTokens, reserveAgentAi, responseOutputLimit } from './agentAiReservation.ts';
import { azureCacheRetention, azureFoundryBase, type AzureRoute, servedSpeed } from './azureAgentAi.ts';
import { assertCloudSafe } from './privacy.ts';

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// A deployment without priority processing turns Fast down; the request then
// runs at the standard speed and price.
export const rejectsFast = (route: AzureRoute, error: any) => route.fast && /service_tier/.test(String(error?.error?.param || '') + ' ' + String(error?.error?.message || ''));
export const standardRoute = (route: AzureRoute): AzureRoute => ({ ...route, fast: false, billing: `openai/${route.slug}` });

// What a deployment turned down (Fast, 24-hour retention, encrypted
// reasoning), remembered by this isolate for a while, so later requests skip
// the reservation, the 400 and the release.
const DECLINED_MS = 10 * 60_000;
const declined = new Map<string, number>();
const declines = (route: AzureRoute, what: string) => (declined.get(`${route.deployment} ${what}`) || 0) > Date.now();
const decline = (route: AzureRoute, what: string) => declined.set(`${route.deployment} ${what}`, Date.now() + DECLINED_MS);
const mentions = (error: any, pattern: RegExp) => pattern.test(`${error?.error?.param || ''} ${error?.error?.code || ''} ${error?.error?.message || ''}`);
const isReasoning = (item: any) => item?.type === 'reasoning';
const withoutInclude = ({ include: _, ...payload }: any) => payload;

// Opens a Responses request on Azure with a reservation for its worst case. A
// 400 for something the deployment can't take sends the request again
// without it: Fast, 24-hour retention, encrypted reasoning, or reasoning that
// another model encrypted (after a model switch mid-chat).
async function openAzure(admin: any, userId: string, route: AzureRoute, payload: any, stream: boolean) {
  if (!route.keys.length) throw fail(503, 'The cloud AI provider is not configured.');
  if (route.fast && declines(route, 'fast')) route = standardRoute(route);
  if (payload.include && declines(route, 'include')) payload = withoutInclude(payload);
  let retention = azureCacheRetention() && !declines(route, 'retention'), replayed = false;
  for (;;) {
    const request = { ...payload, ...(route.fast ? { service_tier: 'priority' } : {}), ...(retention ? { prompt_cache_retention: '24h' } : {}), model: route.deployment, store: false, stream, max_output_tokens: responseOutputLimit(payload) };
    // One serialization sizes the reservation and is sent.
    const text = JSON.stringify(request);
    const reservation = await reserveAgentAi(admin, userId, route.billing, request, { inputTokens: requestInputTokens(request, text) });
    let upstream: Response;
    try {
      upstream = await fetch(`${azureFoundryBase()}/responses`, { method: 'POST', headers: { 'api-key': route.keys[0], 'content-type': 'application/json' }, body: text, signal: AbortSignal.timeout(stream ? 300_000 : 65_000), redirect: 'error' });
    } catch {
      await reservation.finish('uncertain');
      throw fail(504, stream ? 'The AI connection timed out. Usage reconciliation is pending.' : 'The AI request timed out. Its allowance stays reserved until usage is reconciled.');
    }
    if (upstream.ok && (upstream.body || !stream)) return { upstream, reservation, route };
    const error = await upstream.json().catch(() => null);
    await reservation.finish(upstream.ok || (!stream && !error) ? 'uncertain' : 'released');
    if (upstream.status === 400) {
      const param = String(error?.error?.param || ''), reasoning = /^include/.test(param) || mentions(error, /encrypted/i);
      if (rejectsFast(route, error)) { decline(route, 'fast'); route = standardRoute(route); continue; }
      if (retention && mentions(error, /prompt_cache_retention/)) { decline(route, 'retention'); retention = false; continue; }
      const carried = Array.isArray(payload.input) && payload.input.some(isReasoning);
      if (reasoning && !replayed && carried && !/^include/.test(param)) { replayed = true; payload = { ...payload, input: payload.input.filter((item: any) => !isReasoning(item)) }; continue; }
      if (reasoning && payload.include) { decline(route, 'include'); payload = withoutInclude(payload); continue; }
    }
    if (!stream) throw fail(upstream.status === 429 ? 429 : 502, `The AI provider could not complete this request (${upstream.status}).`);
    const param=String(error?.error?.param||'').replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,100),code=String(error?.error?.code||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    throw fail(upstream.status===429?429:502, `The AI provider could not start this request (${upstream.status}${param?'; field '+param:''}${code?'; '+code:''}).`);
  }
}

// Forward real provider events. Meter the independent tee so a desktop closing
// mid-stream cannot turn a paid request into an unrecorded model call. The
// request was checked for secrets on arrival (index.ts).
export async function nativeStream(admin: any, userId: string, route: AzureRoute, payload: any, cors: Record<string, string>) {
  const { upstream, reservation, route: settled } = await openAzure(admin, userId, route, payload, true);
  const [client, meter] = upstream.body!.tee();
  const settle = (async () => {
    const reader = meter.getReader(); const decoder = new TextDecoder(); let buffer = '', usage: any = null, tier: unknown;
    const details = () => ({ ...usage.input_tokens_details, speed: servedSpeed(settled, tier) });
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += chunk.done ? decoder.decode() + '\n' : decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 2 * 1024 * 1024) throw new Error('Provider event exceeded its size limit.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          // Only the closing event carries usage; the deltas aren't parsed.
          if (!line.startsWith('data:') || !(line.includes('response.completed') || line.includes('response.incomplete'))) continue;
          try { const event = JSON.parse(line.slice(5)); if (event.type === 'response.completed' || event.type === 'response.incomplete') { usage = event.response?.usage; tier = event.response?.service_tier; } } catch { /* Non-data framing. */ }
        }
        if (chunk.done) break;
      }
      if (usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) await reservation.finish('settled', usage.input_tokens, usage.output_tokens, details());
      else await reservation.finish('uncertain');
    } catch {
      const known = usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens);
      await reservation.finish(known ? 'settled' : 'uncertain', known ? usage.input_tokens : 0, known ? usage.output_tokens : 0, known ? details() : undefined)
        .catch(() => console.error('[timewarp] Stream settlement requires operator recovery.', { reservationId: reservation.id }));
    }
    finally { reader.releaseLock(); }
  })();
  (globalThis as any).EdgeRuntime?.waitUntil(settle);
  return new Response(client, { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

// The same request as one Responses object, for clients that don't stream.
export async function nativeCall(admin: any, userId: string, route: AzureRoute, payload: any) {
  const { upstream, reservation, route: served } = await openAzure(admin, userId, route, payload, false);
  const output = await upstream.json().catch(() => null);
  if (!output) { await reservation.finish('uncertain'); throw fail(502, `The AI provider could not complete this request (${upstream.status}).`); }
  if (!output.usage || !Number.isFinite(output.usage.input_tokens) || !Number.isFinite(output.usage.output_tokens)) {
    await reservation.finish('uncertain'); throw fail(502, 'The AI provider did not return usage information.');
  }
  await reservation.finish('settled', output.usage.input_tokens, output.usage.output_tokens, { ...output.usage.input_tokens_details, speed: servedSpeed(served, output.service_tier) });
  assertCloudSafe(output.output);
  return output;
}
