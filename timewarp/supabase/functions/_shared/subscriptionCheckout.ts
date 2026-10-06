import type { AdminSupabaseClient } from './auth.ts';
import type { Stripe } from './stripe.ts';

interface CheckoutAttempt {
  attempt_id: string;
  request: Stripe.Checkout.SessionCreateParams;
  created_at: string;
  expires_at: string;
  session_id: string | null;
}

const fail = (message: string, status = 503) => Object.assign(new Error(message), { status });
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};

/** A database-owned attempt keeps the Stripe parameters and retry key stable
 * across instances, lost responses and the 24-hour Stripe retry-key lifetime. */
export async function subscriptionCheckout(
  admin: AdminSupabaseClient,
  stripe: Stripe,
  userId: string,
  workspaceId: string | null,
  request: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  const prepare = async (previous: string | null = null): Promise<CheckoutAttempt> => {
    const { data, error } = await admin.rpc('timewarp_prepare_subscription_checkout', {
      p_user_id: userId, p_workspace_id: workspaceId, p_request: request, p_previous_attempt: previous,
    });
    if (error) throw fail('Could not verify the pending checkout. No new checkout was started.');
    if (data?.subscription_exists) throw fail('Your subscription changed. Refresh Billing before trying again.', 409);
    if (!data?.attempt_id || data.request?.mode !== 'subscription'
      || !Number.isFinite(Date.parse(data.created_at)) || !Number.isFinite(Date.parse(data.expires_at))) {
      throw fail('The pending checkout record is unavailable. No new checkout was started.');
    }
    return data as CheckoutAttempt;
  };
  const save = async (attempt: CheckoutAttempt, session: Stripe.Checkout.Session) => {
    const { data, error } = await admin.rpc('timewarp_save_subscription_checkout', {
      p_user_id: userId, p_workspace_id: workspaceId, p_attempt_id: attempt.attempt_id, p_session_id: session.id,
    });
    if (error || data !== true) throw fail('Could not save the checkout. Retry to recover the same payment session.');
  };
  const verify = (attempt: CheckoutAttempt, session: Stripe.Checkout.Session) => {
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (session.mode !== 'subscription' || customer !== attempt.request.customer
      || session.client_reference_id !== attempt.request.client_reference_id
      || session.metadata?.timewarp_checkout_attempt !== attempt.attempt_id) {
      throw fail('The pending payment session could not be verified.');
    }
  };
  const recover = async (attempt: CheckoutAttempt): Promise<Stripe.Checkout.Session | null> => {
    if (attempt.session_id) return await stripe.checkout.sessions.retrieve(attempt.session_id);
    // Recover a successful Stripe create whose response or database write was
    // lost. Inspect every page before deciding that an old attempt never ran.
    let cursor: string | undefined;
    const cursors = new Set<string>();
    while (true) {
      const sessions = await stripe.checkout.sessions.list({
        customer: attempt.request.customer as string,
        created: { gte: Math.floor(Date.parse(attempt.created_at) / 1000) - 60 },
        limit: 100, ...(cursor ? { starting_after: cursor } : {}),
      });
      const existing = sessions.data.find(session => session.metadata?.timewarp_checkout_attempt === attempt.attempt_id);
      if (existing) return existing;
      if (!sessions.has_more) return null;
      const next = sessions.data.at(-1)?.id;
      if (!next || cursors.has(next)) throw fail('Could not finish checking existing payment sessions. Retry later.');
      cursors.add(next); cursor = next;
    }
  };
  const verifyLegacyBilling = async (attempt: CheckoutAttempt) => {
    // Old versions did not record a pending attempt. Check open sessions first,
    // then subscriptions, so a legacy payment completed between these reads
    // is still detected. The old customer creation path could leave payable
    // sessions on a customer that was never saved, so owner metadata matters
    // even for personal scopes. Workspace scopes can have different payers.
    const sameScope = (metadata: Stripe.Metadata | null, customer: string | null, reference?: string | null) =>
      (metadata?.workspace_id || '') === (workspaceId || '')
      && (!!workspaceId || metadata?.supabase_user_id === userId || reference === userId || customer === request.customer);
    let cursor: string | undefined;
    const cursors = new Set<string>();
    while (true) {
      const sessions = await stripe.checkout.sessions.list({ status: 'open', limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (sessions.data.some(session => session.mode === 'subscription'
        && sameScope(session.metadata, typeof session.customer === 'string' ? session.customer : session.customer?.id || null, session.client_reference_id)
        && session.metadata?.timewarp_checkout_attempt !== attempt.attempt_id)) {
        throw fail('A previous checkout is still open. Finish or cancel it before starting another.', 409);
      }
      if (!sessions.has_more) break;
      const next = sessions.data.at(-1)?.id;
      if (!next || cursors.has(next)) throw fail('Could not finish verifying previous checkouts. Retry later.');
      cursors.add(next); cursor = next;
    }
    cursor = undefined; cursors.clear();
    while (true) {
      // Stripe's default list includes every non-cancelled status in one pass.
      // Avoid scanning cancelled history or missing a transition between separate status queries.
      const subscriptions = await stripe.subscriptions.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (subscriptions.data.some(subscription => sameScope(subscription.metadata, typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null)
        && !['canceled', 'incomplete_expired'].includes(subscription.status))) {
        throw fail('A subscription already exists. Refresh Billing while its payment is confirmed.', 409);
      }
      if (!subscriptions.has_more) break;
      const next = subscriptions.data.at(-1)?.id;
      if (!next || cursors.has(next)) throw fail('Could not finish verifying existing subscriptions. Retry later.');
      cursors.add(next); cursor = next;
    }
  };

  let attempt = await prepare();
  for (let tries = 0; tries < 3; tries++) {
    const session = await recover(attempt);
    if (session) {
      verify(attempt, session);
      if (session.status === 'expired') {
        attempt = await prepare(attempt.attempt_id);
        continue;
      }
      if (session.status === 'complete') {
        const id = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const subscription = id ? await stripe.subscriptions.retrieve(id) : null;
        if (subscription && ['canceled', 'incomplete_expired'].includes(subscription.status)) {
          attempt = await prepare(attempt.attempt_id);
          continue;
        }
        throw fail('Checkout has completed. Refresh Billing while the payment is confirmed.', 409);
      }
      if (session.status !== 'open' || !session.url) throw fail('The pending checkout is not available. Retry later.');
      if (canonical(attempt.request) !== canonical(request)) {
        throw fail('Finish or cancel the existing checkout before choosing a different plan.', 409);
      }
      if (!attempt.session_id) await save(attempt, session);
      return session;
    }
    const expiresAt = Math.floor(Date.parse(attempt.expires_at) / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt <= now) {
      // All sessions for the old attempt have been checked, and its fixed
      // creation deadline is past. A late old request cannot create a payable session.
      attempt = await prepare(attempt.attempt_id);
      continue;
    }
    if (canonical(attempt.request) !== canonical(request)) {
      throw fail('A checkout is being prepared. Retry the original plan or wait for it to expire.', 409);
    }
    // Stripe requires at least 30 minutes until expiry when creating a session.
    // Keep the immutable deadline; never silently extend an ambiguous attempt.
    if (expiresAt < now + 1800) throw fail('The previous checkout is expiring. Retry after it expires.', 409);
    await verifyLegacyBilling(attempt);
    const created = await stripe.checkout.sessions.create({
      ...attempt.request, expires_at: expiresAt,
      metadata: { ...attempt.request.metadata, timewarp_checkout_attempt: attempt.attempt_id },
      subscription_data: {
        ...attempt.request.subscription_data,
        metadata: { ...attempt.request.subscription_data?.metadata, timewarp_checkout_attempt: attempt.attempt_id },
      },
    }, { idempotencyKey: 'timewarp-subscription-checkout-' + attempt.attempt_id });
    verify(attempt, created);
    await save(attempt, created);
    return created;
  }
  throw fail('Checkout changed while it was being prepared. Retry later.', 409);
}
