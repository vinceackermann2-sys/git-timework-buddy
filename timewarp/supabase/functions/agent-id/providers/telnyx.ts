// Agent phone numbers through Timewarp's Telnyx account. Texts go through one
// messaging profile and calls through one TeXML application (Twilio-style
// markup), both made by Agent ID on first use and remembered in
// agent_id_settings. Telnyx signs every webhook with Ed25519 (the account's
// public key, TELNYX_PUBLIC_KEY), so they can't be forged.
import { fail, fromBase64 } from '../util.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';
import { putSetting, setting } from '../shared.ts';

const API = 'https://api.telnyx.com/v2';
const escapeXml = (value: string) => value.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
export const telnyxWebhookUrl = (ctx: Ctx, event: 'messaging' | 'voice' | 'status' | 'recording') => `${ctx.config.publicUrl}/webhooks/telnyx/${event}`;

async function telnyx(ctx: Ctx, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const key = ctx.config.env('TELNYX_API_KEY');
  if (!key) throw fail(503, 'provider_unavailable', 'Phone numbers are not set up on this deployment.');
  const response = await ctx.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (method === 'DELETE' && response.status === 404) return {};
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const error = payload?.errors?.[0];
    console.error('[agent-id] telnyx', response.status, error?.code, error?.title, error?.detail);
    throw fail(response.status >= 500 ? 503 : 502, 'phone_failed', String(error?.detail || error?.title || 'The phone provider could not complete the request.').slice(0, 300));
  }
  return payload;
}

// Where texts may be sent (AGENT_ID_SMS_COUNTRIES, default US and Canada).
const smsCountries = (ctx: Ctx) => (ctx.config.env('AGENT_ID_SMS_COUNTRIES') || 'US,CA').split(/[,\s]+/).map(c => c.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c));

// The account's messaging profile, outbound voice profile and TeXML app for
// Agent ID, made once (again if the function's address changed).
async function account(ctx: Ctx) {
  const current = await setting(ctx, 'telnyx.setup');
  if (current?.url === ctx.config.publicUrl && current.messagingProfileId && current.texmlAppId) return current as { messagingProfileId: string; texmlAppId: string };
  const name = 'Timewarp Agent ID';
  const messaging = current?.messagingProfileId
    ? await telnyx(ctx, 'PATCH', `/messaging_profiles/${encodeURIComponent(current.messagingProfileId)}`, { webhook_url: telnyxWebhookUrl(ctx, 'messaging'), webhook_api_version: '2' })
    : await telnyx(ctx, 'POST', '/messaging_profiles', { name, enabled: true, whitelisted_destinations: smsCountries(ctx), webhook_url: telnyxWebhookUrl(ctx, 'messaging'), webhook_api_version: '2' });
  const voiceProfile = current?.voiceProfileId ? { data: { id: current.voiceProfileId } } : await telnyx(ctx, 'POST', '/outbound_voice_profiles', { name, enabled: true, whitelisted_destinations: smsCountries(ctx) });
  const app = current?.texmlAppId
    ? await telnyx(ctx, 'PATCH', `/texml_applications/${encodeURIComponent(current.texmlAppId)}`, { friendly_name: name, voice_url: telnyxWebhookUrl(ctx, 'voice'), voice_method: 'post', status_callback: telnyxWebhookUrl(ctx, 'status'), status_callback_method: 'post' })
    : await telnyx(ctx, 'POST', '/texml_applications', { friendly_name: name, active: true, voice_url: telnyxWebhookUrl(ctx, 'voice'), voice_method: 'post', status_callback: telnyxWebhookUrl(ctx, 'status'), status_callback_method: 'post', outbound: { outbound_voice_profile_id: voiceProfile?.data?.id } });
  const ids = { messagingProfileId: String(messaging?.data?.id || ''), voiceProfileId: String(voiceProfile?.data?.id || ''), texmlAppId: String(app?.data?.id || '') };
  if (!ids.messagingProfileId || !ids.texmlAppId) throw fail(502, 'phone_failed', 'The phone provider did not set up texting and calling.');
  await putSetting(ctx, 'telnyx.setup', { ...ids, url: ctx.config.publicUrl });
  return ids;
}

export async function provisionTelnyx(ctx: Ctx, agent: AgentRow, options: { country?: string; areaCode?: string }) {
  const setup = await account(ctx);
  const country = /^[A-Z]{2}$/.test(String(options.country || '').toUpperCase()) ? String(options.country).toUpperCase() : 'US';
  const query = new URLSearchParams({ 'filter[country_code]': country, 'filter[phone_number_type]': 'local', 'filter[limit]': '5' });
  query.append('filter[features][]', 'sms');
  query.append('filter[features][]', 'voice');
  if (/^\d{3}$/.test(String(options.areaCode || ''))) query.set('filter[national_destination_code]', String(options.areaCode));
  const found = await telnyx(ctx, 'GET', `/available_phone_numbers?${query}`);
  const candidate = (found?.data || []).map((n: any) => n?.phone_number).find((n: unknown) => typeof n === 'string' && /^\+[1-9]\d{6,14}$/.test(n));
  if (!candidate) throw fail(409, 'no_numbers', `No phone numbers with texts and calls are available in ${country}${options.areaCode ? ` with area code ${options.areaCode}` : ''}.`);
  const order = await telnyx(ctx, 'POST', '/number_orders', { phone_numbers: [{ phone_number: candidate }], connection_id: setup.texmlAppId, messaging_profile_id: setup.messagingProfileId, customer_reference: agent.id });
  const number = order?.data?.phone_numbers?.[0]?.phone_number || candidate;
  return { provider: 'telnyx', address: String(number), providerRef: String(order?.data?.id || ''), label: String(number), state: { country, capabilities: ['sms', 'voice'], order: order?.data?.status || null } };
}

export async function releaseTelnyx(ctx: Ctx, resource: ResourceRow) {
  if (!resource.address) return;
  const digits = resource.address.replace(/\D/g, '');
  const found = await telnyx(ctx, 'GET', `/phone_numbers?${new URLSearchParams({ 'filter[phone_number]': digits })}`);
  const row = (found?.data || []).find((n: any) => n?.phone_number === resource.address);
  if (row?.id) await telnyx(ctx, 'DELETE', `/phone_numbers/${encodeURIComponent(row.id)}`);
}

export async function sendTelnyxSms(ctx: Ctx, resource: ResourceRow, to: string, text: string) {
  const setup = await account(ctx);
  const sent = await telnyx(ctx, 'POST', '/messages', { from: resource.address, to, text, messaging_profile_id: setup.messagingProfileId });
  return { providerRef: String(sent?.data?.id || ''), status: String(sent?.data?.to?.[0]?.status || 'queued') };
}

// A call that speaks the agent's message, then hangs up.
export async function placeTelnyxCall(ctx: Ctx, resource: ResourceRow, to: string, say: string) {
  const setup = await account(ctx);
  const call = await telnyx(ctx, 'POST', `/texml/calls/${encodeURIComponent(setup.texmlAppId)}`, {
    From: resource.address, To: to, Texml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(say)}</Say></Response>`,
  });
  return { providerRef: String(call?.call_sid || ''), status: String(call?.status || 'queued') };
}

// Telnyx's signature: Ed25519 over "<timestamp>|<raw body>", within 5 minutes.
export async function telnyxSigned(ctx: Ctx, req: Request, body: string) {
  const key = ctx.config.env('TELNYX_PUBLIC_KEY');
  const signature = req.headers.get('telnyx-signature-ed25519') || '', timestamp = req.headers.get('telnyx-timestamp') || '';
  if (!key || !signature || !/^\d+$/.test(timestamp) || Math.abs(ctx.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw', fromBase64(key.trim()) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', publicKey, fromBase64(signature) as BufferSource, new TextEncoder().encode(`${timestamp}|${body}`) as BufferSource);
  } catch {
    return false;
  }
}
