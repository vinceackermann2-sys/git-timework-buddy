// Providers calling back: mail arriving (Resend), texts, calls and voicemail
// (Twilio, Telnyx), identity checks and card payments (Stripe), bank
// verification and payouts (Bridge). Each is authenticated the provider's way
// before anything is read from it.
import { checked, fail, fromBase64, hmac, json, sameText, text, toBase64 } from './util.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { audit, setting } from './shared.ts';
import { addressOnly, fetchResendReceived, resendAttachment } from './providers/mail.ts';
import { MAX_ATTACHMENTS, MAX_FILE, saveFile, shareFiles } from './files.ts';
import { checkWebhookToken, voicemailTwiml } from './providers/phone.ts';
import { telnyxSigned } from './providers/telnyx.ts';
import { verifyStripeSignature } from './providers/stripe.ts';
import { bridgeSigned } from './providers/bridge.ts';
import { identityEvent } from './verification.ts';
import { refreshCustomer, setPayinState, setPayoutState } from './bank.ts';

const MAX = 1024 * 1024;
async function rawBody(req: Request) {
  if (req.method !== 'POST') throw fail(405, 'method_not_allowed', 'Webhooks use POST.');
  if (Number(req.headers.get('content-length')) > MAX) throw fail(413, 'too_large', 'Too large.');
  const raw = await req.text();
  if (raw.length > MAX) throw fail(413, 'too_large', 'Too large.');
  return raw;
}

async function recordEvent(ctx: Ctx, resource: ResourceRow, fields: Record<string, unknown>) {
  return checked(await ctx.admin.rpc('agent_id_record_event', {
    p_resource: resource.id, p_kind: fields.kind, p_direction: fields.direction, p_status: fields.status,
    p_counterparty: fields.counterparty ?? null, p_subject: fields.subject ?? null, p_body: fields.body ?? null,
    p_amount: fields.amount ?? null, p_currency: fields.currency ?? null, p_provider_ref: fields.providerRef ?? null,
    p_thread: fields.thread ?? null, p_data: fields.data ?? {},
  })) as { status: string; id: string };
}

// --- Resend (Svix signatures) ------------------------------------------------
async function svixValid(req: Request, body: string, secret: string, now: number) {
  const id = req.headers.get('svix-id') || '', timestamp = req.headers.get('svix-timestamp') || '', signatures = req.headers.get('svix-signature') || '';
  if (!secret || !id || !Number.isFinite(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  let key: Uint8Array;
  try { key = fromBase64(secret.replace(/^whsec_/, '')); } catch { return false; }
  const expected = toBase64(await hmac(key, `${id}.${timestamp}.${body}`));
  return signatures.split(/\s+/).some(part => { const [version, signature] = part.split(',', 2); return version === 'v1' && !!signature && sameText(signature, expected); });
}

const DELIVERY: Record<string, string> = { 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed' };
const plain = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

async function resend(ctx: Ctx, req: Request) {
  const body = await rawBody(req);
  const secret = ctx.config.env('AGENT_ID_RESEND_WEBHOOK_SECRET') || (await setting(ctx, 'resend.webhook'))?.secret || '';
  if (!(await svixValid(req, body, secret, ctx.now()))) return json({ error: 'Invalid signature.' }, 401);
  const event = JSON.parse(body), data = event?.data || {};
  const emailId = String(data.email_id || '').slice(0, 180);
  if (!emailId) return json({ ok: true, ignored: true });
  if (DELIVERY[event.type]) {
    await ctx.admin.from('agent_id_events').update({ status: DELIVERY[event.type] }).eq('kind', 'mail').eq('direction', 'out').eq('provider_ref', emailId);
    return json({ ok: true });
  }
  if (event.type !== 'email.received') return json({ ok: true, ignored: true });
  const received = await fetchResendReceived(ctx, emailId);
  const domain = `@${ctx.config.mailDomain}`;
  const recipients = [...new Set([...(received.to || data.to || []), ...(received.cc || []), ...(received.bcc || [])].map(addressOnly).filter(address => address.endsWith(domain)))];
  if (!recipients.length) return json({ ok: true, ignored: true });
  const inboxes = (checked(await ctx.admin.from('agent_id_resources').select('*').eq('kind', 'mail').eq('mode', 'live').eq('status', 'active').in('address', recipients)) || []) as ResourceRow[];
  const headers = received.headers || {};
  const messageId = String(received.message_id || headers['message-id'] || headers['Message-ID'] || '').slice(0, 300) || null;
  const textBody = String(received.text || '') || plain(String(received.html || ''));
  // Attachments are kept with the message (Resend's links expire): each is
  // downloaded once and shared by every inbox it went to.
  let stored: any[] | null = null;
  for (const inbox of inboxes) {
    const recorded = await recordEvent(ctx, inbox, {
      kind: 'mail', direction: 'in', status: 'received', providerRef: emailId,
      counterparty: addressOnly(received.from || data.from), subject: String(received.subject || data.subject || '').slice(0, 998), body: textBody.slice(0, 200_000),
      data: { messageId, to: received.to || data.to || [], cc: received.cc || [], ...(received.html ? { html: String(received.html).slice(0, 50_000) } : {}) },
    });
    if (recorded.status !== 'ok') continue;
    if (stored === null) stored = await keepAttachments(ctx, emailId, received.attachments || [], inbox, recorded.id);
    else await shareFiles(ctx, stored, inbox, recorded.id);
  }
  return json({ ok: true, delivered: inboxes.length });
}

async function keepAttachments(ctx: Ctx, emailId: string, attachments: any[], inbox: ResourceRow, eventId: string) {
  const kept: any[] = [];
  let total = 0;
  for (const attachment of attachments.slice(0, 20)) {
    if (!attachment?.id || Number(attachment.size) > MAX_FILE || total + Number(attachment.size || 0) > MAX_ATTACHMENTS) continue;
    try {
      const meta = await resendAttachment(ctx, emailId, String(attachment.id));
      const response = await ctx.fetch(String(meta.download_url), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_FILE) continue;
      total += bytes.byteLength;
      kept.push(await saveFile(ctx, { id: inbox.agent_id, owner_user_id: inbox.owner_user_id }, { filename: String(meta.filename || attachment.filename || 'attachment'), contentType: meta.content_type || attachment.content_type, bytes, eventId }));
    } catch (error) { console.error('[agent-id] attachment', (error as Error).message); }
  }
  return kept;
}

// --- Twilio (per-number URL token) -------------------------------------------
const xml = (body: string) => text(body, 200, 'text/xml; charset=utf-8');
const CALL_STATUS: Record<string, string> = { completed: 'completed', busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', canceled: 'canceled', 'in-progress': 'in_progress', ringing: 'ringing', queued: 'queued' };

async function twilio(ctx: Ctx, req: Request, resourceId: string, token: string, kind: string) {
  const body = await rawBody(req);
  if (!/^[0-9a-f-]{36}$/.test(resourceId) || !(await checkWebhookToken(ctx, resourceId, token))) return json({ error: 'Unknown number.' }, 404);
  const resource = checked(await ctx.admin.from('agent_id_resources').select('*').eq('id', resourceId).eq('kind', 'phone').maybeSingle()) as ResourceRow | null;
  if (!resource || resource.status === 'released') return xml('<Response><Reject/></Response>');
  return phoneEvent(ctx, resource, kind, Object.fromEntries(new URLSearchParams(body)));
}

// What a number's provider reports, in Twilio's terms (Telnyx's TeXML uses
// the same): a text, an incoming call, a voicemail, a status change.
async function phoneEvent(ctx: Ctx, resource: ResourceRow, kind: string, params: Record<string, string>) {
  if (kind === 'sms') {
    await recordEvent(ctx, resource, { kind: 'sms', direction: 'in', status: 'received', providerRef: params.MessageSid, counterparty: params.From, body: String(params.Body || '').slice(0, 5000), data: { media: Number(params.NumMedia) || 0 } });
    return xml('<Response/>');
  }
  if (kind === 'voice') {
    const agent = checked(await ctx.admin.from('agent_id_agents').select('*').eq('id', resource.agent_id).single()) as AgentRow;
    await recordEvent(ctx, resource, { kind: 'call', direction: 'in', status: 'ringing', providerRef: params.CallSid, counterparty: params.From });
    if (resource.status !== 'active' || agent.status !== 'active') return xml('<Response><Reject reason="busy"/></Response>');
    return xml(await voicemailTwiml(ctx, resource, agent.name));
  }
  if (kind === 'recording') {
    const row = checked(await ctx.admin.from('agent_id_events').select('id,data').eq('resource_id', resource.id).eq('provider_ref', params.CallSid).maybeSingle()) as any;
    if (row) await ctx.admin.from('agent_id_events').update({ status: 'voicemail', data: { ...row.data, recordingUrl: params.RecordingUrl, recordingSeconds: Number(params.RecordingDuration) || 0 } }).eq('id', row.id);
    return xml('<Response/>');
  }
  if (kind === 'status') {
    const sid = params.MessageSid || params.CallSid, status = params.MessageStatus || CALL_STATUS[params.CallStatus] || params.CallStatus;
    if (sid && status) {
      const row = checked(await ctx.admin.from('agent_id_events').select('id,status,direction,kind').eq('resource_id', resource.id).eq('provider_ref', sid).maybeSingle()) as any;
      // A finished voicemail keeps its status, and an incoming call that
      // ended without one was missed; outgoing messages and calls follow Twilio.
      const ended = ['completed', 'no_answer', 'busy', 'canceled', 'failed'].includes(status);
      const next = row?.kind === 'call' && row.direction === 'in' ? (ended ? 'missed' : null) : status;
      if (row && next && row.status !== 'voicemail' && !(row.direction === 'in' && row.kind === 'sms')) await ctx.admin.from('agent_id_events').update({ status: String(next).slice(0, 40), ...(params.CallDuration ? { data: { duration: Number(params.CallDuration) } } : {}) }).eq('id', row.id);
    }
    return xml('<Response/>');
  }
  return json({ error: 'Unknown event.' }, 404);
}

// --- Telnyx (Ed25519-signed; the number is found by its address) ---------------
async function telnyxNumber(ctx: Ctx, address: unknown) {
  const number = String(address || '');
  if (!/^\+[1-9]\d{6,14}$/.test(number)) return null;
  return checked(await ctx.admin.from('agent_id_resources').select('*').eq('kind', 'phone').eq('provider', 'telnyx').eq('address', number).neq('status', 'released').maybeSingle()) as ResourceRow | null;
}

const SMS_STATUS: Record<string, string> = { queued: 'queued', sending: 'sending', sent: 'sent', delivered: 'delivered', sending_failed: 'failed', delivery_failed: 'failed', delivery_unconfirmed: 'sent' };

async function telnyx(ctx: Ctx, req: Request, kind: string) {
  const body = await rawBody(req);
  if (!(await telnyxSigned(ctx, req, body))) return json({ error: 'Invalid signature.' }, 401);
  if (kind === 'messaging') {
    const event = JSON.parse(body)?.data || {}, payload = event.payload || {};
    if (event.event_type === 'message.received') {
      const resource = await telnyxNumber(ctx, payload.to?.[0]?.phone_number);
      if (resource) await recordEvent(ctx, resource, { kind: 'sms', direction: 'in', status: 'received', providerRef: String(payload.id || ''), counterparty: payload.from?.phone_number || null, body: String(payload.text || '').slice(0, 5000), data: { media: Array.isArray(payload.media) ? payload.media.length : 0 } });
    } else if (event.event_type === 'message.sent' || event.event_type === 'message.finalized') {
      const status = SMS_STATUS[String(payload.to?.[0]?.status || '')];
      if (status && payload.id) await ctx.admin.from('agent_id_events').update({ status }).eq('kind', 'sms').eq('direction', 'out').eq('provider_ref', String(payload.id));
    }
    return json({ ok: true });
  }
  const params = Object.fromEntries(new URLSearchParams(body));
  if (kind === 'voice') {
    const resource = await telnyxNumber(ctx, params.To);
    if (!resource) return xml('<Response><Reject/></Response>');
    return phoneEvent(ctx, resource, 'voice', params);
  }
  if (kind === 'status' || kind === 'recording') {
    const sid = String(params.CallSid || '');
    const row = sid ? checked(await ctx.admin.from('agent_id_events').select('resource_id').eq('provider_ref', sid).eq('kind', 'call').maybeSingle()) as any : null;
    const resource = row ? checked(await ctx.admin.from('agent_id_resources').select('*').eq('id', row.resource_id).maybeSingle()) as ResourceRow | null : null;
    if (resource) await phoneEvent(ctx, resource, kind, params);
    return xml('<Response/>');
  }
  return json({ error: 'Unknown event.' }, 404);
}

// --- Stripe (Identity and Issuing) ---------------------------------------------
async function cardFor(ctx: Ctx, cardId: string) {
  return checked(await ctx.admin.from('agent_id_resources').select('*').eq('kind', 'card').eq('provider', 'stripe_issuing').eq('provider_ref', cardId).maybeSingle()) as ResourceRow | null;
}

async function stripeEvent(ctx: Ctx, req: Request) {
  const body = await rawBody(req);
  const secret = ctx.config.env('AGENT_ID_STRIPE_WEBHOOK_SECRET') || (await setting(ctx, 'stripe.webhook'))?.secret || '';
  if (!(await verifyStripeSignature(secret, req.headers.get('stripe-signature') || '', body, ctx.now()))) return json({ error: 'Invalid signature.' }, 400);
  const event = JSON.parse(body), object = event?.data?.object || {};
  if (String(event.type).startsWith('identity.verification_session.')) { await identityEvent(ctx, event); return json({ ok: true }); }
  if (event.type === 'issuing_authorization.request') {
    // Answered in the response, within Stripe's two-second window. An
    // unknown card or any failure declines.
    let approved = false;
    try {
      const card = await cardFor(ctx, String(object.card?.id || ''));
      if (card) {
        const request = object.pending_request || {};
        const decision = checked(await ctx.admin.rpc('agent_id_card_authorize', {
          p_resource: card.id, p_amount: Math.abs(Number(request.amount ?? object.amount) || 0), p_currency: String(request.currency || object.currency || '').toUpperCase(),
          p_merchant: object.merchant_data?.name || null, p_category: object.merchant_data?.category || null, p_provider_ref: String(object.id),
          p_data: { city: object.merchant_data?.city || null, country: object.merchant_data?.country || null },
        })) as any;
        approved = decision?.approved === true;
      }
    } catch (error) { console.error('[agent-id] authorization decision failed', (error as Error).message); }
    return json({ approved }, 200, { 'Stripe-Version': '2024-06-20' });
  }
  if (event.type === 'issuing_transaction.created') {
    const card = await cardFor(ctx, String(object.card || ''));
    if (card) {
      const authorization = typeof object.authorization === 'string' ? object.authorization : object.authorization?.id;
      const row = authorization ? checked(await ctx.admin.from('agent_id_events').select('id,data').eq('resource_id', card.id).eq('provider_ref', authorization).maybeSingle()) as any : null;
      const amount = Math.abs(Number(object.amount) || 0);
      if (row) await ctx.admin.from('agent_id_events').update({ data: { ...row.data, captured: amount, transaction: object.id, type: object.type } }).eq('id', row.id);
      else await recordEvent(ctx, card, { kind: 'card', direction: object.type === 'refund' ? 'in' : 'out', status: object.type === 'refund' ? 'refunded' : 'captured', providerRef: String(object.id), counterparty: object.merchant_data?.name || null, amount, currency: String(object.currency || '').toUpperCase() || card.currency, data: { type: object.type } });
    }
    return json({ ok: true });
  }
  if (event.type === 'issuing_card.updated' && object.status === 'canceled') {
    const card = await cardFor(ctx, String(object.id || ''));
    if (card && card.status !== 'released') {
      await ctx.admin.from('agent_id_resources').update({ status: 'released', released_at: new Date(ctx.now()).toISOString() }).eq('id', card.id);
      await audit(ctx, card.owner_user_id, card.agent_id, 'provider', 'card.canceled', {});
    }
  }
  return json({ ok: true, ignored: true });
}

// --- Bridge (RSA signatures): verification, and bank payouts --------------------------
async function bridgeEvent(ctx: Ctx, req: Request) {
  const body = await rawBody(req);
  const key = ctx.config.env('BRIDGE_WEBHOOK_PUBLIC_KEY') || (await setting(ctx, 'bridge.webhook'))?.publicKey || '';
  if (!(await bridgeSigned(key, req.headers.get('x-webhook-signature') || '', body, ctx.now()))) return json({ error: 'Invalid signature.' }, 400);
  const event = JSON.parse(body), object = event?.event_object || {};
  const id = String(object.id || event?.event_object_id || '').slice(0, 100);
  if (!id) return json({ ok: true, ignored: true });
  if (event.event_category === 'transfer') {
    // A payout (money out to a bank) or a pay-in (a SEPA transfer in).
    const state = String(object.state || event.event_object_status || '').slice(0, 40);
    if (state) await Promise.all([setPayoutState(ctx, id, state), setPayinState(ctx, id, state)]);
  }
  else if (event.event_category === 'kyc_link') await refreshCustomer(ctx, { kycLink: id });
  else if (event.event_category === 'customer') await refreshCustomer(ctx, { customer: id });
  else return json({ ok: true, ignored: true });
  return json({ ok: true });
}

export async function handleWebhook(ctx: Ctx, req: Request, path: string) {
  const parts = path.split('/').filter(Boolean); // webhooks, provider, …
  if (parts[1] === 'resend' && parts.length === 2) return resend(ctx, req);
  if (parts[1] === 'bridge' && parts.length === 2) return bridgeEvent(ctx, req);
  if (parts[1] === 'stripe' && parts.length === 2) return stripeEvent(ctx, req);
  if (parts[1] === 'twilio' && parts.length === 5) return twilio(ctx, req, parts[2], parts[3], parts[4]);
  if (parts[1] === 'telnyx' && parts.length === 3) return telnyx(ctx, req, parts[2]);
  return json({ error: 'Unknown webhook.' }, 404);
}
