// Signed Resend lifecycle webhook. It records delivery, bounce and complaint
// reports for mail the email queue sent, and suppresses addresses that bounce
// or complain. Resend is the caller, so the raw body is authenticated with the
// endpoint's Svix signing secret instead of a JWT. The name is kept because it
// is the endpoint registered in Resend. Agent ID receives its own agents' mail
// through the agent-id function.
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, max = 100_000) => String(value ?? '').trim().slice(0, max);

const OUTBOUND_EVENT_STATUS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
};

const decodeBase64 = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
};

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
};

const verifyWebhook = async (request: Request, payload: string, secret: string) => {
  const id = request.headers.get('svix-id') || '';
  const timestamp = request.headers.get('svix-timestamp') || '';
  const signatures = request.headers.get('svix-signature') || '';
  const unix = Number(timestamp);
  if (!id || !Number.isFinite(unix) || Math.abs(Date.now() - unix * 1000) > 5 * 60 * 1000) return false;
  let keyBytes: Uint8Array;
  try { keyBytes = decodeBase64(secret.replace(/^whsec_/, '')); } catch { return false; }
  const keyMaterial = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${payload}`)));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  return signatures.split(/\s+/).some((candidate) => {
    const [version, signature] = candidate.split(',', 2);
    return version === 'v1' && Boolean(signature) && constantTimeEqual(signature, expected);
  });
};

const addressOnly = (value: unknown) => {
  const raw = text(value, 320).toLowerCase();
  const angle = raw.match(/<([^<>]+)>/);
  return (angle?.[1] || raw).trim();
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) return json({ error: 'Resend webhook is not configured.' }, 503);

  const rawPayload = await request.text();
  if (!await verifyWebhook(request, rawPayload, webhookSecret)) return json({ error: 'Invalid webhook signature.' }, 401);

  try {
    const event = record(JSON.parse(rawPayload));
    const eventType = text(event.type, 80);
    const eventData = record(event.data);
    const providerId = text(eventData.email_id, 180);
    const deliveryStatus = OUTBOUND_EVENT_STATUS[eventType];
    if (!deliveryStatus) return json({ ok: true, ignored: true });
    if (!providerId) return json({ error: 'Email event ID is missing.' }, 400);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const svixId = text(request.headers.get('svix-id'), 180);
    const { data: existingEvent, error: existingEventError } = await admin
      .from('email_webhook_events')
      .select('svix_id')
      .eq('svix_id', svixId)
      .maybeSingle();
    if (existingEventError) throw existingEventError;
    if (existingEvent) return json({ ok: true, duplicate: true });

    const { data: trackedSend, error: trackedSendError } = await admin
      .from('email_send_log')
      .select('message_id, template_name, recipient_email')
      .eq('provider_message_id', providerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (trackedSendError) throw trackedSendError;

    if (trackedSend) {
      const status = deliveryStatus;
      const { error: statusError } = await admin.from('email_send_log').insert({
        message_id: trackedSend.message_id,
        template_name: trackedSend.template_name,
        recipient_email: trackedSend.recipient_email,
        status,
        provider: 'resend',
        provider_message_id: providerId,
        metadata: {
          resend_event_id: svixId,
          event_created_at: event.created_at || null,
          bounce: eventData.bounce || null,
        },
        ...(status === 'failed' || status === 'bounced' || status === 'suppressed'
          ? { error_message: text(eventData?.bounce?.message || eventData?.message || eventType, 1_000) }
          : {}),
      });
      if (statusError && String(statusError.code || '') !== '23505') throw statusError;

      if (eventType === 'email.bounced' || eventType === 'email.complained' || eventType === 'email.suppressed') {
        const reason = eventType === 'email.complained' ? 'complaint' : 'bounce';
        const recipients = (Array.isArray(eventData.to) ? eventData.to : [trackedSend.recipient_email])
          .map(addressOnly)
          .filter(Boolean);
        for (const email of recipients) {
          const { error: suppressionError } = await admin.from('suppressed_emails').upsert({
            email,
            reason,
            metadata: { provider: 'resend', event_type: eventType, provider_message_id: providerId },
          }, { onConflict: 'email' });
          if (suppressionError) throw suppressionError;
        }
      }
    }

    const { error: eventStoreError } = await admin.from('email_webhook_events').insert({
      svix_id: svixId,
      event_type: eventType,
      provider_message_id: providerId,
      payload: event,
      event_created_at: event.created_at || null,
    });
    if (eventStoreError && String(eventStoreError.code || '') !== '23505') throw eventStoreError;
    return json({ ok: true, tracked: Boolean(trackedSend) });
  } catch (error) {
    console.error('[timewarp-agent-mail-webhook]', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
