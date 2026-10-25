// Agent mail. Live inboxes are addresses on Timewarp's agent mail domain,
// sent and received through Resend (any address on a verified domain works,
// so no provider call is needed to create one). Test inboxes use a reserved
// .test domain and only reach other Agent ID inboxes.
import { fail, str } from '../util.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';

export async function provisionMail(ctx: Ctx, agent: AgentRow, mode: 'live' | 'test') {
  const domain = mode === 'live' ? ctx.config.mailDomain : ctx.config.testMailDomain;
  const address = `${agent.handle}@${domain}`;
  return { provider: mode === 'live' ? 'resend' : 'test', address, label: address, providerRef: null as string | null, state: {} };
}

// A display name safe for a From header.
const headerName = (name: string) => str(name, 60, 'name').replace(/["<>\\]/g, '') || 'Agent';

export type OutgoingMail = { to: string[]; cc: string[]; subject: string; text: string; html?: string; inReplyTo?: string; attachments?: { filename: string; content: string; content_type: string }[] };

export async function sendResend(ctx: Ctx, resource: ResourceRow, agent: AgentRow, mail: OutgoingMail, idempotencyKey: string) {
  const key = ctx.config.env('RESEND_API_KEY');
  if (!key) throw fail(503, 'provider_unavailable', 'Mail sending is not set up on this deployment.');
  const response = await ctx.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      from: `${headerName(agent.name)} <${resource.address}>`,
      to: mail.to,
      ...(mail.cc.length ? { cc: mail.cc } : {}),
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      reply_to: resource.address,
      ...(mail.inReplyTo ? { headers: { 'In-Reply-To': mail.inReplyTo, References: mail.inReplyTo } } : {}),
      ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
      tags: [{ name: 'agent_id', value: agent.id }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || !payload?.id) {
    console.error('[agent-id] resend send', response.status, payload?.name, payload?.message);
    throw fail(502, 'mail_failed', String(payload?.message || 'The mail provider did not accept the message.').slice(0, 300));
  }
  return String(payload.id);
}

// A received message's full content.
export async function fetchResendReceived(ctx: Ctx, emailId: string) {
  const key = ctx.config.env('RESEND_API_KEY');
  if (!key) throw fail(503, 'provider_unavailable', 'Mail receiving is not set up on this deployment.');
  const response = await ctx.fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw fail(502, 'mail_failed', String(payload?.message || `Could not fetch received mail (${response.status}).`).slice(0, 300));
  return payload as Record<string, any>;
}

// A received message's attachment: its name, type and a short-lived download link.
export async function resendAttachment(ctx: Ctx, emailId: string, attachmentId: string) {
  const key = ctx.config.env('RESEND_API_KEY');
  const response = await ctx.fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || !payload?.download_url) throw fail(502, 'mail_failed', 'Could not fetch an attachment.');
  return payload as { download_url: string; filename?: string; content_type?: string; size?: number };
}

export const addressOnly = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase().slice(0, 320);
  return (/<([^<>]+)>/.exec(raw)?.[1] || raw).trim();
};
