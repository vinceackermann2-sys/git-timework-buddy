// Agent virtual cards. Live cards are Stripe Issuing virtual cards issued to
// the verified owner as cardholder; every payment is decided in real time by
// Agent ID's spend rules (webhooks.ts) on top of Stripe's own limits. Test
// cards are Stripe's public test number and only pay test charges.
import { fail, randomBytes } from '../util.ts';
import { stripe } from './stripe.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';

const testCvc = () => String(100 + (((randomBytes(2)[0] << 8) | randomBytes(1)[0]) % 900));

// Stripe's spending limits from Agent ID's settings.
export function spendingControls(settings: Record<string, any>) {
  const limits = [['perTransaction', 'per_authorization'], ['daily', 'daily'], ['monthly', 'monthly']]
    .filter(([key]) => Number.isSafeInteger(settings?.[key]) && settings[key] > 0)
    .map(([key, interval]) => ({ amount: settings[key], interval }));
  return { spending_limits: limits };
}

export type Billing = { line1: string; line2?: string; city: string; postal_code: string; state?: string; country: string };
export type Person = { user_id: string; legal_name: string | null; country: string | null; cardholder_ref: string | null };

export async function provisionCard(ctx: Ctx, agent: AgentRow, mode: 'live' | 'test', options: { person: Person | null; email: string; billing?: Billing; currency?: string; settings: Record<string, any> }) {
  const year = new Date(ctx.now()).getUTCFullYear() + 3;
  if (mode === 'test') return {
    provider: 'test', providerRef: null as string | null, label: 'Test Visa •••• 4242', currency: 'USD',
    state: { brand: 'Visa', last4: '4242', expMonth: 12, expYear: year, cvc: testCvc() }, cardholder: null as string | null,
  };
  const person = options.person;
  if (!person?.legal_name) throw fail(403, 'verification_required', 'A live card is issued to its verified owner. Verify your identity first.');
  let cardholder = person.cardholder_ref;
  if (!cardholder) {
    const billing = options.billing;
    if (!billing?.line1 || !billing.city || !billing.postal_code || !/^[A-Z]{2}$/.test(billing.country || '')) throw fail(400, 'billing_required', 'A live card needs the owner\'s billing address (line1, city, postal_code, country).');
    const [first, ...rest] = person.legal_name.split(' ');
    const created = await stripe(ctx, 'POST', '/v1/issuing/cardholders', {
      type: 'individual', name: person.legal_name.slice(0, 24), email: options.email, status: 'active',
      individual: { first_name: first, last_name: rest.join(' ') || first },
      billing: { address: billing },
      metadata: { agent_id_user: person.user_id },
    }, `agent-id-cardholder-${person.user_id}`);
    cardholder = String(created.id);
  }
  const currency = /^[a-z]{3}$/.test(String(options.currency || '').toLowerCase()) ? String(options.currency).toLowerCase() : 'usd';
  const card = await stripe(ctx, 'POST', '/v1/issuing/cards', {
    cardholder, currency, type: 'virtual', status: 'active',
    spending_controls: spendingControls(options.settings),
    metadata: { agent_id: agent.id },
  }, `agent-id-card-${agent.id}-${crypto.randomUUID()}`);
  return {
    provider: 'stripe_issuing', providerRef: String(card.id), label: `${card.brand || 'Card'} •••• ${card.last4}`, currency: currency.toUpperCase(),
    state: { brand: card.brand || 'Card', last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year }, cardholder,
  };
}

// The full card details, for the agent to pay with.
export async function revealCard(ctx: Ctx, resource: ResourceRow, cardholderName: string) {
  if (resource.mode === 'test') return { number: '4242424242424242', cvc: resource.state.cvc, expMonth: resource.state.expMonth, expYear: resource.state.expYear, name: cardholderName, test: true };
  const card = await stripe(ctx, 'GET', `/v1/issuing/cards/${encodeURIComponent(resource.provider_ref!)}?expand[]=number&expand[]=cvc`);
  if (!card?.number) throw fail(403, 'reveal_unavailable', 'Stripe did not return the card number. Retrieving card numbers by API needs Stripe\'s approval for this account.');
  return { number: String(card.number), cvc: String(card.cvc), expMonth: card.exp_month, expYear: card.exp_year, name: cardholderName, test: false };
}

export async function updateCard(ctx: Ctx, resource: ResourceRow, change: { status?: 'active' | 'inactive' | 'canceled'; settings?: Record<string, any> }) {
  if (resource.mode !== 'live' || !resource.provider_ref) return;
  await stripe(ctx, 'POST', `/v1/issuing/cards/${encodeURIComponent(resource.provider_ref)}`, {
    ...(change.status ? { status: change.status } : {}),
    ...(change.settings ? { spending_controls: spendingControls(change.settings) } : {}),
  });
}
