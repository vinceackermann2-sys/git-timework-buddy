// Running Agent ID: what this deployment has switched on, and registering
// its own webhooks with Stripe (identity checks, card payments) and Resend
// (incoming mail), keeping their signing secrets in agent_id_settings so no
// one has to copy them by hand. For Timewarp staff named in AGENT_ID_REVIEWERS.
import { fail } from './util.ts';
import { KINDS, type Kind } from './config.ts';
import type { Owner, Route } from './app.ts';
import type { Ctx } from './context.ts';
import { audit, putSetting, setting } from './shared.ts';
import { stripe } from './providers/stripe.ts';

function operator(ctx: Ctx, owner: Owner) {
  if (owner.via !== 'session' || !ctx.config.reviewers.has(owner.userId)) throw fail(403, 'forbidden', 'Only Agent ID operators can do this.');
}

const STRIPE_IDENTITY_EVENTS = ['identity.verification_session.verified', 'identity.verification_session.requires_input', 'identity.verification_session.canceled'];
const STRIPE_CARD_EVENTS = ['issuing_authorization.request', 'issuing_transaction.created', 'issuing_card.updated'];
const RESEND_EVENTS = ['email.received', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed'];

const wantsStripe = (ctx: Ctx) => ctx.config.kycProvider === 'stripe_identity' || ctx.config.isLive('card');

async function status(ctx: Ctx) {
  const [stripeHook, resendHook] = await Promise.all([setting(ctx, 'stripe.webhook'), setting(ctx, 'resend.webhook')]);
  return {
    passports: !!ctx.config.signingKey, phoneWebhooks: !!ctx.config.webhookSecret,
    resources: Object.fromEntries(KINDS.map((kind: Kind) => [kind, { enabled: ctx.config.liveListed(kind), configured: ctx.config.providers[kind].configured, live: ctx.config.isLive(kind), provider: ctx.config.providers[kind].provider }])),
    verification: { person: ctx.config.kycProvider, business: ctx.config.kybProvider },
    webhooks: {
      stripe: { needed: wantsStripe(ctx), registered: !!ctx.config.env('AGENT_ID_STRIPE_WEBHOOK_SECRET') || !!stripeHook?.secret, url: `${ctx.config.publicUrl}/webhooks/stripe` },
      resend: { needed: ctx.config.isLive('mail'), registered: !!ctx.config.env('AGENT_ID_RESEND_WEBHOOK_SECRET') || !!resendHook?.secret, url: `${ctx.config.publicUrl}/webhooks/resend` },
    },
  };
}

async function registerStripe(ctx: Ctx) {
  if (!wantsStripe(ctx) || ctx.config.env('AGENT_ID_STRIPE_WEBHOOK_SECRET')) return 'not_needed';
  const events = [...(ctx.config.kycProvider === 'stripe_identity' ? STRIPE_IDENTITY_EVENTS : []), ...(ctx.config.isLive('card') ? STRIPE_CARD_EVENTS : [])];
  const current = await setting(ctx, 'stripe.webhook');
  if (current?.id) {
    // Still there with the right events: nothing to do. Otherwise it's replaced.
    const existing = await stripe(ctx, 'GET', `/v1/webhook_endpoints/${encodeURIComponent(current.id)}`).catch(() => null);
    if (existing && existing.status !== 'disabled' && events.every(event => existing.enabled_events?.includes(event))) return 'kept';
    if (existing) await stripe(ctx, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(current.id)}`).catch(() => null);
  }
  const created = await stripe(ctx, 'POST', '/v1/webhook_endpoints', { url: `${ctx.config.publicUrl}/webhooks/stripe`, enabled_events: events, description: 'Timewarp Agent ID' });
  if (!created?.id || !created?.secret) throw fail(502, 'stripe_error', 'Stripe did not return the webhook\'s signing secret.');
  await putSetting(ctx, 'stripe.webhook', { id: created.id, secret: created.secret, events });
  return 'registered';
}

async function registerResend(ctx: Ctx) {
  if (!ctx.config.isLive('mail') || ctx.config.env('AGENT_ID_RESEND_WEBHOOK_SECRET')) return 'not_needed';
  if ((await setting(ctx, 'resend.webhook'))?.secret) return 'kept';
  const response = await ctx.fetch('https://api.resend.com/webhooks', {
    method: 'POST', headers: { Authorization: `Bearer ${ctx.config.env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: `${ctx.config.publicUrl}/webhooks/resend`, events: RESEND_EVENTS }), signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || !payload?.signing_secret) throw fail(502, 'mail_failed', String(payload?.message || 'Resend did not register the webhook.').slice(0, 300));
  await putSetting(ctx, 'resend.webhook', { id: payload.id, secret: payload.signing_secret, events: RESEND_EVENTS });
  return 'registered';
}

// The same setup, on the first request after a deploy: registers whatever
// isn't registered yet and remembers it was done for this configuration.
export async function autoSetup(ctx: Ctx) {
  const wanted = JSON.stringify({ stripe: wantsStripe(ctx) && !ctx.config.env('AGENT_ID_STRIPE_WEBHOOK_SECRET'), card: ctx.config.isLive('card'), resend: ctx.config.isLive('mail') && !ctx.config.env('AGENT_ID_RESEND_WEBHOOK_SECRET'), url: ctx.config.publicUrl });
  const done = await setting(ctx, 'setup.auto');
  if (done?.wanted === wanted && done?.ok) return;
  const result: Record<string, string> = {};
  let ok = true;
  for (const [name, register] of [['stripe', registerStripe], ['resend', registerResend]] as const) {
    try { result[name] = await register(ctx); } catch (error) { ok = false; result[name] = 'failed'; console.error(`[agent-id] auto setup ${name}`, (error as Error)?.message); }
  }
  await putSetting(ctx, 'setup.auto', { wanted, ok, result, at: new Date(ctx.now()).toISOString() });
}

export const adminRoutes: Route<Owner>[] = [
  ['GET', '/v1/admin/status', async (ctx, owner) => { operator(ctx, owner); return status(ctx); }],
  ['POST', '/v1/admin/setup', async (ctx, owner) => {
    operator(ctx, owner);
    const result = { stripe: await registerStripe(ctx), resend: await registerResend(ctx) };
    await audit(ctx, owner.userId, null, 'owner', 'admin.setup', result);
    return { setup: result, status: await status(ctx) };
  }],
];
