// MoonPay sells USDC on Base by card (and Apple Pay or Google Pay) straight
// into a wallet, in Europe and the US. Agent ID signs the page's address with
// the secret key, so the wallet can't be swapped on the way, and binds it to
// the buyer's IP address. MoonPay checks the buyer itself. Keys that start
// with pk_test use its sandbox.
import { hmac, toBase64 } from '../util.ts';
import type { Ctx } from '../context.ts';

export function moonpayOn(ctx: Ctx) {
  const apiKey = ctx.config.env('MOONPAY_API_KEY'), secret = ctx.config.env('MOONPAY_SECRET_KEY');
  const mode = /^pk_(live|test)_/.exec(apiKey)?.[1];
  return !!mode && secret.startsWith(`sk_${mode}_`) && ctx.config.env('AGENT_ID_CARD_PAYMENTS') !== 'off';
}

// The buyer pays in their own money: euros in the euro area, crowns in
// Sweden, and so on; US dollars elsewhere.
const EURO = new Set(['AD', 'AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'PT', 'SI', 'SK', 'SM', 'VA']);
const LOCAL: Record<string, string> = { SE: 'sek', NO: 'nok', DK: 'dkk', GB: 'gbp', PL: 'pln', CH: 'chf', CZ: 'czk', HU: 'huf', RO: 'ron' };
export const cardCurrency = (country: string | null | undefined) =>
  EURO.has(String(country || '').toUpperCase()) ? 'eur' : LOCAL[String(country || '').toUpperCase()] || 'usd';

const encode = (value: string) => encodeURIComponent(value);

// MoonPay's signature: base64 HMAC-SHA256 of the query string, "?" included,
// with the values already encoded; it goes last.
export async function signedQuery(secret: string, params: [string, string][]) {
  const query = `?${params.map(([key, value]) => `${key}=${encode(value)}`).join('&')}`;
  return `${query}&signature=${encode(toBase64(await hmac(secret, query)))}`;
}

export async function moonpayUrl(ctx: Ctx, input: {
  address: string; currency: string; amount: number | null; email: string | null; customer: string;
  reference: string; ip: string | null; returnTo: string | null;
}) {
  const apiKey = ctx.config.env('MOONPAY_API_KEY'), secret = ctx.config.env('MOONPAY_SECRET_KEY');
  const base = apiKey.startsWith('pk_test_') ? 'https://buy-sandbox.moonpay.com' : 'https://buy.moonpay.com';
  const params: [string, string][] = [
    ['apiKey', apiKey], ['currencyCode', 'usdc_base'], ['walletAddress', input.address], ['baseCurrencyCode', input.currency],
    ...(input.amount ? [['baseCurrencyAmount', (input.amount / 100).toFixed(input.amount % 100 ? 2 : 0)] as [string, string]] : []),
    ...(input.email ? [['email', input.email] as [string, string]] : []),
    // Traceable both ways: MoonPay's order names the Agent ID account and this purchase.
    ['externalCustomerId', input.customer], ['externalTransactionId', input.reference],
    // MoonPay only takes https pages to come back to.
    ...(input.returnTo?.startsWith('https://') ? [['redirectURL', input.returnTo] as [string, string]] : []),
    // The page only opens for the person who asked for it.
    ...(input.ip ? [['allowedIpAddress', toBase64(await hmac(secret, input.ip))] as [string, string]] : []),
  ];
  return `${base}/${await signedQuery(secret, params)}`;
}
