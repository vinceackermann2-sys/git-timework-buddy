// Stripe's REST API, form encoded, for Identity (KYC) and Issuing (cards).
// Raw requests keep this function free of the SDK and easy to test.
import { fail, hex, hmac, sameText } from '../util.ts';
import type { Ctx } from '../context.ts';

export function form(value: Record<string, unknown>, prefix = '', out: string[] = []) {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(item)) item.forEach((entry, index) => typeof entry === 'object' && entry !== null ? form(entry as Record<string, unknown>, `${name}[${index}]`, out) : out.push(`${encodeURIComponent(`${name}[]`)}=${encodeURIComponent(String(entry))}`));
    else if (typeof item === 'object') form(item as Record<string, unknown>, name, out);
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(item))}`);
  }
  return out.join('&');
}

export async function stripe(ctx: Ctx, method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, idempotencyKey?: string) {
  const key = ctx.config.env('STRIPE_SECRET_KEY');
  if (!/^(sk|rk)_(live|test)_/.test(key)) throw fail(503, 'provider_unavailable', 'Stripe is not set up on this deployment.');
  const response = await ctx.fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body ? { body: form(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    console.error('[agent-id] stripe', response.status, payload?.error?.code, payload?.error?.message);
    throw fail(response.status >= 500 ? 503 : 502, payload?.error?.code || 'stripe_error', String(payload?.error?.message || 'Stripe could not complete the request.').slice(0, 300));
  }
  return payload;
}

// Stripe-Signature: t=<seconds>,v1=<hex HMAC of "t.body">. Within 5 minutes.
export async function verifyStripeSignature(secret: string, header: string, body: string, now: number) {
  if (!secret) return false;
  const parts = Object.fromEntries(header.split(',').map(part => part.split('=', 2) as [string, string]).filter(([, value]) => value !== undefined).map(([key, value]) => [key.trim(), value]));
  const signatures = header.split(',').filter(part => part.trim().startsWith('v1=')).map(part => part.trim().slice(3));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300 || !signatures.length) return false;
  const expected = hex(await hmac(secret, `${parts.t}.${body}`));
  return signatures.some(signature => sameText(signature, expected));
}
