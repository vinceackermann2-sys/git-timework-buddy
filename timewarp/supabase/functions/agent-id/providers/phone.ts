// Agent phone numbers through Timewarp's Twilio account: a number is bought
// for the agent and released back to Twilio when the agent gives it up.
// Twilio calls back on a per-number URL whose last part is an HMAC of the
// number's id, so a webhook can't be forged without the server's secret.
// Test numbers use the 555-01xx range set aside for fiction.
import { base64url, fail, hmac, randomBytes, sameText } from '../util.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';

const API = 'https://api.twilio.com/2010-04-01';
export const escapeXml = (value: string) => value.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

export async function webhookToken(ctx: Ctx, resourceId: string) {
  if (!ctx.config.webhookSecret) throw fail(503, 'provider_unavailable', 'AGENT_ID_WEBHOOK_SECRET is not set.');
  return base64url(await hmac(ctx.config.webhookSecret, `twilio:${resourceId}`)).slice(0, 32);
}
export async function checkWebhookToken(ctx: Ctx, resourceId: string, token: string) {
  if (!ctx.config.webhookSecret) return false;
  return sameText(await webhookToken(ctx, resourceId), String(token || ''));
}
export const webhookUrl = async (ctx: Ctx, resourceId: string, event: 'sms' | 'voice' | 'status' | 'recording') =>
  `${ctx.config.publicUrl}/webhooks/twilio/${resourceId}/${await webhookToken(ctx, resourceId)}/${event}`;

async function twilio(ctx: Ctx, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string>) {
  const sid = ctx.config.env('TWILIO_ACCOUNT_SID'), token = ctx.config.env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) throw fail(503, 'provider_unavailable', 'Phone numbers are not set up on this deployment.');
  const query = method === 'GET' && params ? '?' + new URLSearchParams(params).toString() : '';
  const response = await ctx.fetch(`${API}/Accounts/${encodeURIComponent(sid)}${path}${query}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(method === 'POST' && params ? { body: new URLSearchParams(params).toString() } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (method === 'DELETE' && (response.status === 204 || response.status === 404)) return {};
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    console.error('[agent-id] twilio', response.status, payload?.code, payload?.message);
    throw fail(502, 'phone_failed', String(payload?.message || 'The phone provider could not complete the request.').slice(0, 300));
  }
  return payload;
}

export function testNumber() {
  const [a, b, c] = randomBytes(3);
  const area = 201 + ((a << 8 | b) % 790); // 201–990
  return `+1${area}55501${String(c % 100).padStart(2, '0')}`;
}

export async function provisionPhone(ctx: Ctx, agent: AgentRow, resourceId: string, mode: 'live' | 'test', options: { country?: string; areaCode?: string }) {
  if (mode === 'test') return { provider: 'test', address: testNumber(), providerRef: null as string | null, label: 'Test number', state: { capabilities: ['sms', 'voice'] } };
  const country = /^[A-Z]{2}$/.test(String(options.country || '').toUpperCase()) ? String(options.country).toUpperCase() : 'US';
  const search: Record<string, string> = { SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '5' };
  if (/^\d{3}$/.test(String(options.areaCode || ''))) search.AreaCode = String(options.areaCode);
  const found = await twilio(ctx, 'GET', `/AvailablePhoneNumbers/${country}/Local.json`, search);
  const candidate = found?.available_phone_numbers?.[0]?.phone_number;
  if (!candidate) throw fail(409, 'no_numbers', `No phone numbers with texts and calls are available in ${country}${search.AreaCode ? ` with area code ${search.AreaCode}` : ''}.`);
  const bought = await twilio(ctx, 'POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: candidate,
    FriendlyName: `Agent ID ${agent.id}`.slice(0, 64),
    SmsUrl: await webhookUrl(ctx, resourceId, 'sms'), SmsMethod: 'POST',
    VoiceUrl: await webhookUrl(ctx, resourceId, 'voice'), VoiceMethod: 'POST',
    StatusCallback: await webhookUrl(ctx, resourceId, 'status'), StatusCallbackMethod: 'POST',
  });
  if (!bought?.sid || !bought?.phone_number) throw fail(502, 'phone_failed', 'The phone provider did not return the number it bought.');
  return { provider: 'twilio', address: String(bought.phone_number), providerRef: String(bought.sid), label: String(bought.friendly_name || bought.phone_number), state: { country, capabilities: ['sms', 'voice'] } };
}

export async function releasePhone(ctx: Ctx, resource: ResourceRow) {
  if (resource.mode === 'live' && resource.provider_ref) await twilio(ctx, 'DELETE', `/IncomingPhoneNumbers/${encodeURIComponent(resource.provider_ref)}.json`);
}

export async function sendSms(ctx: Ctx, resource: ResourceRow, to: string, body: string) {
  const sent = await twilio(ctx, 'POST', '/Messages.json', { From: resource.address!, To: to, Body: body, StatusCallback: await webhookUrl(ctx, resource.id, 'status') });
  return { providerRef: String(sent.sid), status: String(sent.status || 'queued') };
}

// A call that speaks the agent's message, then hangs up.
export async function placeCall(ctx: Ctx, resource: ResourceRow, to: string, say: string) {
  const twiml = `<Response><Say>${escapeXml(say)}</Say></Response>`;
  const call = await twilio(ctx, 'POST', '/Calls.json', { From: resource.address!, To: to, Twiml: twiml, StatusCallback: await webhookUrl(ctx, resource.id, 'status'), StatusCallbackMethod: 'POST' });
  return { providerRef: String(call.sid), status: String(call.status || 'queued') };
}

// What an incoming call hears: the agent's greeting, then a voicemail.
export async function voicemailTwiml(ctx: Ctx, resource: ResourceRow, agentName: string) {
  const greeting = String(resource.settings?.greeting || '').slice(0, 300) || `You've reached ${agentName}, an AI agent. Leave a message after the tone.`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(greeting)}</Say><Record maxLength="120" playBeep="true" recordingStatusCallback="${escapeXml(await webhookUrl(ctx, resource.id, 'recording'))}" recordingStatusCallbackMethod="POST"/></Response>`;
}
