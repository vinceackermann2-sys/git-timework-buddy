// Shared Stripe client for the edge functions.
//
// The secret key selects the mode: an sk_test_... key talks to test mode, an
// sk_live_... key to live mode. The TimeWarpDev products are live, so a test
// deploy also needs STRIPE_PRICE_* / STRIPE_PRODUCT_* pointed at test objects
// (see _shared/plans.ts).
import Stripe from 'npm:stripe@22.6.1';

export { Stripe };

let cached: Stripe | null = null;

// Stripe issues secret keys (sk_) and restricted keys (rk_). Anything else is
// some other product's credential, and handing one to the SDK gets it forwarded
// to api.stripe.com, which answers "Invalid API Key provided: <masked>" — an
// error that then surfaces to whoever clicked Upgrade. Checking the shape here
// turns that into one clear server-side failure naming the secret at fault.
const KEY_PREFIXES = ['sk_live_', 'sk_test_', 'rk_live_', 'rk_test_'];

const readKey = (): string => {
  const key = Deno.env.get('STRIPE_SECRET_KEY') || '';
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  if (!KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    // Report the leading tag only. The value never reaches a log or a caller.
    const tag = key.slice(0, key.indexOf('_') + 1) || key.slice(0, 3);
    throw new Error(
      `STRIPE_SECRET_KEY holds a "${tag}..." value, which Stripe does not accept. ` +
      'It must be a secret key (sk_live_... / sk_test_...) or a restricted key ' +
      '(rk_...) belonging to the same Stripe account as the STRIPE_PRICE_* objects.',
    );
  }
  return key;
};

export const getStripe = (): Stripe => {
  if (cached) return cached;
  // Validate before caching, so a misconfigured key fails every call instead of
  // parking a permanently broken client on a warm isolate.
  const key = readKey();
  // No apiVersion pin: the SDK sends the version it was built against, which is
  // what its own types describe. Deno has no Node crypto/http, so Stripe's fetch
  // client is required.
  cached = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  return cached;
};

type StripeV2Method = 'GET' | 'POST';

export class StripeConnectError extends Error {
  constructor(public code: string, public requestId: string | null, public status: number) {
    super('Stripe could not complete account setup.');
  }
}

/** Accounts v2 is newer than the pinned Stripe SDK used by the rest of the
 * billing functions. Keep the preview call server-side and use Stripe's JSON
 * transport directly until the SDK exposes the same surface. */
export const stripeV2Request = async <T>(
  path: string,
  options: { method?: StripeV2Method; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> => {
  if (!path.startsWith('/v2/')) throw new Error('Stripe v2 requests must use a /v2/ path.');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${readKey()}`,
    'Stripe-Version': Deno.env.get('STRIPE_CONNECT_API_VERSION') || '2026-08-26.preview',
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : payload;
    const code = typeof error.code === 'string' && /^[a-z_]{1,120}$/.test(error.code) ? error.code : 'stripe_request_failed';
    throw new StripeConnectError(code, response.headers.get('request-id'), response.status);
  }
  return payload as T;
};

// Both key kinds have live variants. A key that matches neither is not "test
// mode" — readKey rejects it before anything can be charged.
export const isLiveKey = (): boolean => {
  const key = Deno.env.get('STRIPE_SECRET_KEY') || '';
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
};

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Where Stripe sends the browser back to after checkout / portal. The bridge
 *  page at this URL hands off to the timewarp:// deep link so the desktop app
 *  refocuses and refreshes its plan. */
export const getSiteUrl = (): string =>
  (Deno.env.get('TIMEWARP_SITE_URL') || 'https://timewarpdev.com').replace(/\/+$/, '');
