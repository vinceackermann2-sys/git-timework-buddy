// Bridge (bridge.xyz, a Stripe company) moves money between banks and
// stablecoins. Agent ID uses it for bank transfers in and out of live
// wallets: Bridge verifies the owner itself (a hosted KYC link with its terms),
// keeps their bank accounts, gives a wallet bank details whose deposits arrive
// as USDC on Base (virtual accounts), and pays USDC sent to it out to a bank
// (transfers). Keys that start with sk-test use Bridge's sandbox.
import { fail, fromBase64 } from '../util.ts';
import type { Ctx } from '../context.ts';

export function bridgeUrl(ctx: Ctx) {
  const override = ctx.config.env('BRIDGE_API_URL').replace(/\/+$/, '');
  if (override) return override;
  return ctx.config.env('BRIDGE_API_KEY').startsWith('sk-test') ? 'https://api.sandbox.bridge.xyz/v0' : 'https://api.bridge.xyz/v0';
}

export async function bridge(ctx: Ctx, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string) {
  const key = ctx.config.env('BRIDGE_API_KEY');
  if (!key) throw fail(503, 'provider_unavailable', 'Bank transfers are not set up on this deployment.');
  const response = await ctx.fetch(`${bridgeUrl(ctx)}${path}`, {
    method,
    headers: {
      'Api-Key': key, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // Bridge asks for one on every POST (and only there); a retry with the same key is answered once.
      ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey || crypto.randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    console.error('[agent-id] bridge', response.status, payload?.code, payload?.message);
    const message = String(payload?.message || 'The bank partner could not complete the request.').slice(0, 300);
    // Bridge's own checks of what was entered (an IBAN, a routing number) go back as they are.
    if (response.status === 400 || response.status === 422) throw fail(400, 'invalid', message);
    if (response.status === 404) throw fail(404, 'not_found', message);
    throw fail(response.status >= 500 ? 503 : 502, 'bank_failed', message);
  }
  return payload;
}

// --- Verifying the owner -----------------------------------------------------------

export type BridgeKyc = { id: string; customerId: string | null; kycLink: string | null; tosLink: string | null; kycStatus: string; tosStatus: string; rejection: string | null };
const kycView = (link: any): BridgeKyc => ({
  id: String(link.id), customerId: link.customer_id ? String(link.customer_id) : null,
  kycLink: link.kyc_link ? String(link.kyc_link) : null, tosLink: link.tos_link ? String(link.tos_link) : null,
  kycStatus: String(link.kyc_status || 'not_started'), tosStatus: String(link.tos_status || 'pending'),
  rejection: Array.isArray(link.rejection_reasons) && link.rejection_reasons.length
    ? link.rejection_reasons.map((r: any) => String(r?.reason || r || '')).filter(Boolean).join('; ').slice(0, 500) || null
    : null,
});

// Endorsements are the rails Bridge checks the customer for: "base" (US
// dollars) always, "sepa" (euros) when euro transfers are on.
// The person types their name on Bridge's page when Agent ID doesn't know it.
export async function createKycLink(ctx: Ctx, input: { userId: string; fullName: string | null; email: string; type: 'individual' | 'business'; redirectUri: string; endorsements: string[] }) {
  const link = await bridge(ctx, 'POST', '/kyc_links', {
    ...(input.fullName ? { full_name: input.fullName } : {}), email: input.email, type: input.type, endorsements: input.endorsements, redirect_uri: input.redirectUri,
  }, `agent-id-kyc-${input.userId}`);
  return kycView(link);
}
export const kycLink = async (ctx: Ctx, id: string) => kycView(await bridge(ctx, 'GET', `/kyc_links/${encodeURIComponent(id)}`));

// Bridge's countries (ISO 3166 alpha-3) in Agent ID's two letters.
const ALPHA2: Record<string, string> = {
  AND: 'AD', AUT: 'AT', BEL: 'BE', BGR: 'BG', CHE: 'CH', CYP: 'CY', CZE: 'CZ', DEU: 'DE', DNK: 'DK', EST: 'EE', ESP: 'ES', FIN: 'FI',
  FRA: 'FR', GBR: 'GB', GRC: 'GR', HRV: 'HR', HUN: 'HU', IRL: 'IE', ISL: 'IS', ITA: 'IT', LIE: 'LI', LTU: 'LT', LUX: 'LU', LVA: 'LV',
  MCO: 'MC', MLT: 'MT', NLD: 'NL', NOR: 'NO', POL: 'PL', PRT: 'PT', ROU: 'RO', SWE: 'SE', SVN: 'SI', SVK: 'SK', SMR: 'SM',
  USA: 'US', CAN: 'CA', MEX: 'MX', BRA: 'BR', ARG: 'AR', COL: 'CO', AUS: 'AU', NZL: 'NZ', JPN: 'JP', SGP: 'SG', IND: 'IN', ZAF: 'ZA', ARE: 'AE',
};

// What Bridge knows of an approved customer: the rails it approved them for
// (endorsement name → approved, incomplete or revoked), their name and country.
export async function customerDetails(ctx: Ctx, customerId: string) {
  const customer = await bridge(ctx, 'GET', `/customers/${encodeURIComponent(customerId)}`);
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim().slice(0, 200) || null;
  const code = String(customer?.residential_address?.country || customer?.address?.country || '').toUpperCase();
  return {
    endorsements: Object.fromEntries((customer?.endorsements || []).map((e: any) => [String(e?.name), String(e?.status)])) as Record<string, string>,
    name, country: code.length === 2 ? code : ALPHA2[code] || null,
  };
}

// --- Bank accounts -----------------------------------------------------------------

// The holder's address goes with every account (Bridge checks it for payouts).
export type HolderAddress = { line1: string; city: string; state: string | null; postalCode: string; country: string };
export type NewAccount =
  | { kind: 'iban'; ownerName: string; firstName: string; lastName: string; iban: string; bic: string | null; country: string; address: HolderAddress }
  | { kind: 'us'; ownerName: string; firstName: string; lastName: string; accountNumber: string; routingNumber: string; checkingOrSavings: 'checking' | 'savings'; address: HolderAddress };
const addressBody = (a: HolderAddress) => ({ street_line_1: a.line1, city: a.city, ...(a.state ? { state: a.state } : {}), postal_code: a.postalCode, country: a.country });

export async function addExternalAccount(ctx: Ctx, customerId: string, input: NewAccount, idempotencyKey: string) {
  const holder = { account_owner_name: input.ownerName, account_owner_type: 'individual', first_name: input.firstName, last_name: input.lastName, address: addressBody(input.address) };
  const body = input.kind === 'iban'
    ? { currency: 'eur', account_type: 'iban', ...holder, iban: { account_number: input.iban, country: input.country, ...(input.bic ? { bic: input.bic } : {}) } }
    : { currency: 'usd', account_type: 'us', ...holder, account: { account_number: input.accountNumber, routing_number: input.routingNumber, checking_or_savings: input.checkingOrSavings } };
  const account = await bridge(ctx, 'POST', `/customers/${encodeURIComponent(customerId)}/external_accounts`, body, idempotencyKey);
  if (!account?.id) throw fail(502, 'bank_failed', 'The bank partner did not save the account.');
  const last4 = String(account.last_4 || account.account?.last_4 || account.iban?.last_4 || '').replace(/[^0-9A-Za-z]/g, '').slice(-4)
    || (input.kind === 'iban' ? input.iban : input.accountNumber).slice(-4);
  return { id: String(account.id), last4, bankName: account.bank_name ? String(account.bank_name).slice(0, 200) : null };
}

export async function removeExternalAccount(ctx: Ctx, customerId: string, accountId: string) {
  await bridge(ctx, 'DELETE', `/customers/${encodeURIComponent(customerId)}/external_accounts/${encodeURIComponent(accountId)}`).catch(error => {
    // Already gone at Bridge is fine.
    if ((error as any)?.status !== 404) throw error;
  });
}

// --- Deposits: a wallet's own bank details ---------------------------------------------

export type DepositInstructions = {
  currency: 'usd' | 'eur'; rails: string[]; beneficiary: string | null; bankName: string | null; bankAddress: string | null;
  accountNumber: string | null; routingNumber: string | null; iban: string | null; bic: string | null; reference: string | null;
};
const text = (value: unknown) => value === undefined || value === null || value === '' ? null : String(value).slice(0, 300);

export async function createVirtualAccount(ctx: Ctx, customerId: string, currency: 'usd' | 'eur', address: string, idempotencyKey: string) {
  const account = await bridge(ctx, 'POST', `/customers/${encodeURIComponent(customerId)}/virtual_accounts`, {
    source: { currency }, destination: { payment_rail: 'base', currency: 'usdc', address },
  }, idempotencyKey);
  const i = account?.source_deposit_instructions || {};
  if (!account?.id) throw fail(502, 'bank_failed', 'The bank partner did not open deposit details.');
  const instructions: DepositInstructions = {
    currency, rails: Array.isArray(i.payment_rails) ? i.payment_rails.map(String) : i.payment_rail ? [String(i.payment_rail)] : [],
    beneficiary: text(i.bank_beneficiary_name || i.account_holder_name),
    bankName: text(i.bank_name), bankAddress: text(i.bank_address),
    accountNumber: text(i.bank_account_number), routingNumber: text(i.bank_routing_number),
    iban: text(i.iban), bic: text(i.bic), reference: text(i.deposit_message),
  };
  return { id: String(account.id), instructions };
}

// --- Payouts: USDC sent to Bridge, paid to a bank ---------------------------------------

// A fixed amount from the wallet's own address, so Bridge matches the deposit
// (and returns it there if the bank refuses it).
export async function createPayout(ctx: Ctx, input: { customerId: string; accountId: string; rail: string; currency: 'usd' | 'eur'; amount: string; fromAddress: string; reference: string; idempotencyKey: string }) {
  const transfer = await bridge(ctx, 'POST', '/transfers', {
    on_behalf_of: input.customerId, amount: input.amount, client_reference_id: input.reference,
    source: { payment_rail: 'base', currency: 'usdc', from_address: input.fromAddress },
    destination: { payment_rail: input.rail, currency: input.currency, external_account_id: input.accountId },
  }, input.idempotencyKey);
  const to = String(transfer?.source_deposit_instructions?.to_address || '');
  if (!transfer?.id || !/^0x[0-9a-fA-F]{40}$/.test(to)) throw fail(502, 'bank_failed', 'The bank partner did not start the payout.');
  return { id: String(transfer.id), state: String(transfer.state || 'awaiting_funds'), to };
}
export async function payoutState(ctx: Ctx, id: string) {
  const transfer = await bridge(ctx, 'GET', `/transfers/${encodeURIComponent(id)}`);
  return String(transfer?.state || '');
}
// Only while it still waits for the USDC.
export async function cancelPayout(ctx: Ctx, id: string) {
  await bridge(ctx, 'DELETE', `/transfers/${encodeURIComponent(id)}`).catch(() => null);
}

// --- Webhooks ------------------------------------------------------------------------

export const BRIDGE_EVENTS = ['kyc_link', 'customer', 'transfer'];

// A new endpoint starts disabled at Bridge; it's switched on once saved.
export async function registerBridgeWebhook(ctx: Ctx, url: string) {
  const hook = await bridge(ctx, 'POST', '/webhooks', { url, event_epoch: 'webhook_creation', event_categories: BRIDGE_EVENTS });
  if (!hook?.id || !hook?.public_key) throw fail(502, 'bank_failed', 'Bridge did not return the webhook\'s public key.');
  await bridge(ctx, 'PUT', `/webhooks/${encodeURIComponent(hook.id)}`, { status: 'active' });
  return { id: String(hook.id), publicKey: String(hook.public_key) };
}

// X-Webhook-Signature: t=<ms>,v0=<base64 RSA signature of SHA-256("t.body")>,
// signed with SHA-256 (so the body is hashed twice). Within 10 minutes.
export async function bridgeSigned(publicKeyPem: string, header: string, body: string, now: number) {
  const parts = Object.fromEntries(header.split(',').map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; }));
  const timestamp = Number(parts.t);
  if (!publicKeyPem || !parts.v0 || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > 600_000) return false;
  try {
    const key = await crypto.subtle.importKey('spki', spki(publicKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${parts.t}.${body}`)));
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64(parts.v0), digest);
  } catch {
    return false;
  }
}

// A PEM public key as SPKI bytes; a bare PKCS#1 RSA key is wrapped first.
function spki(pem: string) {
  const der = fromBase64(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  if (!/BEGIN RSA PUBLIC KEY/.test(pem)) return der;
  const length = (n: number) => n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  const bits = [0x03, ...length(der.length + 1), 0x00, ...der];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array([0x30, ...length(algorithm.length + bits.length), ...algorithm, ...bits]);
}
