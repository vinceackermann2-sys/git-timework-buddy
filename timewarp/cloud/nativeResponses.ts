import { reserveAgentAi } from './agentAiReservation.ts';
import { azureFoundryBase, azureSolKeys, azureLunaKeys, azureLunaModel } from './azureAgentAi.ts';
import { assertCloudSafe } from './privacy.ts';

// Forward real provider events. Meter the independent tee so a desktop closing
// mid-stream cannot turn a paid request into an unrecorded model call.
export async function nativeStream(admin: any, userId: string, model: string, payload: any, cors: Record<string, string>) {
  assertCloudSafe(payload);
  const keys = model === azureLunaModel() ? azureLunaKeys() : azureSolKeys();
  if (!keys.length) throw Object.assign(new Error('The cloud AI provider is not configured.'), { status: 503 });
  const reservation = await reserveAgentAi(admin, userId, `openai/${model}`, payload);
  let upstream: Response;
  try {
    upstream = await fetch(`${azureFoundryBase()}/responses`, { method: 'POST', headers: { 'api-key': keys[0], 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, model, store: false, stream: true, max_output_tokens: 16384 }), signal: AbortSignal.timeout(120000), redirect: 'error' });
  } catch {
    await reservation.finish('uncertain');
    throw Object.assign(new Error('The AI connection timed out. Usage reconciliation is pending.'), { status: 504 });
  }
  if (!upstream.ok || !upstream.body) {
    const error=await upstream.json().catch(()=>null);
    const param=String(error?.error?.param||'').replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,100),code=String(error?.error?.code||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    await reservation.finish(upstream.ok ? 'uncertain' : 'released');
    throw Object.assign(new Error(`The AI provider could not start this request (${upstream.status}${param?'; field '+param:''}${code?'; '+code:''}).`), { status: upstream.status===429?429:502 });
  }
  const [client, meter] = upstream.body.tee();
  const settle = (async () => {
    const reader = meter.getReader(); const decoder = new TextDecoder(); let buffer = '', usage: any = null;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 2 * 1024 * 1024) throw new Error('Provider event exceeded its size limit.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (!line.startsWith('data:')) continue;
          try { const event = JSON.parse(line.slice(5)); if (event.type === 'response.completed' || event.type === 'response.incomplete') usage = event.response?.usage; } catch { /* Non-data framing. */ }
        }
      }
      if (usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) await reservation.finish('settled', usage.input_tokens, usage.output_tokens);
      else await reservation.finish('uncertain');
    } catch { await reservation.finish('uncertain').catch(() => {}); }
    finally { reader.releaseLock(); }
  })();
  (globalThis as any).EdgeRuntime?.waitUntil(settle);
  return new Response(client, { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
