import { reserveAgentAi, responseOutputLimit } from './agentAiReservation.ts';
import { azureFoundryBase, type AzureRoute, servedSpeed } from './azureAgentAi.ts';
import { assertCloudSafe } from './privacy.ts';

// A deployment without priority processing turns Fast down; the request then
// runs at the standard speed and price.
export const rejectsFast = (route: AzureRoute, error: any) => route.fast && /service_tier/.test(String(error?.error?.param || '') + ' ' + String(error?.error?.message || ''));
export const standardRoute = (route: AzureRoute): AzureRoute => ({ ...route, fast: false, billing: `openai/${route.slug}` });

// Forward real provider events. Meter the independent tee so a desktop closing
// mid-stream cannot turn a paid request into an unrecorded model call.
export async function nativeStream(admin: any, userId: string, route: AzureRoute, payload: any, cors: Record<string, string>) {
  assertCloudSafe(payload);
  if (!route.keys.length) throw Object.assign(new Error('The cloud AI provider is not configured.'), { status: 503 });
  let upstream: Response, reservation: Awaited<ReturnType<typeof reserveAgentAi>>;
  for (let attempt = 0; ; attempt++) {
    const request={...payload,...(route.fast?{service_tier:'priority'}:{}),model:route.deployment,store:false,stream:true,max_output_tokens:responseOutputLimit(payload)};
    reservation = await reserveAgentAi(admin, userId, route.billing, request);
    try {
      upstream = await fetch(`${azureFoundryBase()}/responses`, { method: 'POST', headers: { 'api-key': route.keys[0], 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(300000), redirect: 'error' });
    } catch {
      await reservation.finish('uncertain');
      throw Object.assign(new Error('The AI connection timed out. Usage reconciliation is pending.'), { status: 504 });
    }
    if (upstream.ok && upstream.body) break;
    const error=await upstream.json().catch(()=>null);
    await reservation.finish(upstream.ok ? 'uncertain' : 'released');
    if (!attempt && upstream.status === 400 && rejectsFast(route, error)) { route = standardRoute(route); continue; }
    const param=String(error?.error?.param||'').replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,100),code=String(error?.error?.code||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    throw Object.assign(new Error(`The AI provider could not start this request (${upstream.status}${param?'; field '+param:''}${code?'; '+code:''}).`), { status: upstream.status===429?429:502 });
  }
  const [client, meter] = upstream.body.tee();
  const settled = route;
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
          if (!line.startsWith('data:')) continue;
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
