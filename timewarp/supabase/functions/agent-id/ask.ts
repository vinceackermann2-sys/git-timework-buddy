// Asking the owner first. The owner chooses, per agent, which of its actions
// wait for their yes: sending mail, texting, calling, changing contacts and
// saving to the vault (payments have their own approval amount). An action
// that waits is kept as an approval holding exactly what the agent asked
// for, and runs as asked once the owner approves it on the website
// (owner.ts); the agent can never approve one.
import { checked } from './util.ts';
import type { AgentCaller } from './app.ts';
import type { Ctx } from './context.ts';
import { asksFirst, audit, type AskKind } from './shared.ts';

const WHAT: Record<AskKind, string> = {
  mail: 'send this email', sms: 'send this text', call: 'make this call', contacts: 'change its contacts', vault: 'save this to its vault',
};

export const approvalUrl = (ctx: Ctx, id: string) => `${ctx.config.siteUrl}/agent-id/approvals?id=${id}`;

const escapeHtml = (value: string) => value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

// An email to the owner with one button (approvals).
export async function mailOwner(ctx: Ctx, who: AgentCaller, mail: { subject: string; line: string; quote?: string | null; button: string; url: string; note: string }) {
  const key = ctx.config.env('RESEND_API_KEY');
  if (!key) return;
  const { data } = await ctx.admin.auth.admin.getUserById(who.agent.owner_user_id);
  const email = data?.user?.email;
  if (!email) return;
  const response = await ctx.fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Timewarp Agent ID <no-reply@${ctx.config.mailDomain}>`, to: [email],
      subject: mail.subject,
      text: `${mail.line}${mail.quote ? `\n\n"${mail.quote}"` : ''}\n\n${mail.button}: ${mail.url}\n\n${mail.note}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#1c1b22"><p style="font-size:15px;margin:0 0 6px">${escapeHtml(mail.line)}</p>${mail.quote ? `<p style="font-size:13px;color:#6b6878;margin:0 0 18px;white-space:pre-wrap">"${escapeHtml(mail.quote)}"</p>` : ''}<a href="${escapeHtml(mail.url)}" style="display:inline-block;background:#6d4bd8;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:10px">${escapeHtml(mail.button)}</a><p style="font-size:12px;color:#6b6878;margin-top:18px">${escapeHtml(mail.note)}</p></div>`,
      tags: [{ name: 'agent_id', value: 'approval' }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) console.error('[agent-id] approval mail', response.status);
}

// Waits for the owner when they asked to approve this kind of action first:
// returns what to answer the agent, or null to go ahead. `summary` is what the
// owner is shown; `input` is what runs once they approve.
export async function askFirst(ctx: Ctx, who: AgentCaller, kind: AskKind, action: string, input: Record<string, unknown>, summary: Record<string, unknown>, mode?: string) {
  // Running an approved request, or the owner acting as the agent: no asking.
  if (ctx.approved || who.via === 'owner' || !asksFirst(who.agent, kind, mode)) return null;
  const row = checked(await ctx.admin.from('agent_id_approvals').insert({
    agent_id: who.agent.id, owner_user_id: who.agent.owner_user_id, kind: 'action', request: { action, kind, summary, input },
  }).select('*').single()) as any;
  await audit(ctx, who.userId, who.agent.id, 'agent', 'approval.requested', { approval: row.id, kind });
  const url = approvalUrl(ctx, row.id);
  const quote = String(summary.text ?? summary.preview ?? summary.say ?? '').slice(0, 300) || null;
  const to = summary.to ? ` to ${Array.isArray(summary.to) ? summary.to.join(', ') : summary.to}` : '';
  ctx.background(mailOwner(ctx, who, {
    subject: `${who.agent.name} wants to ${WHAT[kind]}`,
    line: `${who.agent.name} wants to ${WHAT[kind]}${to}${summary.subject ? `: ${summary.subject}` : ''}.`,
    quote, button: 'Review it', url, note: 'It expires in 24 hours. Nothing happens unless you approve.',
  }).catch(error => console.error('[agent-id] approval mail', error?.message)));
  return {
    status: 'needs_approval', approval: row.id, approveUrl: url, summary,
    message: `Your owner asked to approve this first (to ${WHAT[kind]}). It waits for them: show them this link to approve or decline it: ${url} (they were emailed it too). Check the answer with approval_status. It expires in 24 hours.`,
  };
}
