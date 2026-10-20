// Agent wallets. Live wallets are Privy server wallets on Base holding
// stablecoins (USDC and USDT, shown together as US dollars): Privy keeps the
// keys in its secure enclaves and Timewarp asks it to send, so an agent pays
// headlessly without a key reaching Timewarp's database or the agent. With
// gas sponsorship on in Privy, sends need no ETH. Test wallets are a ledger
// inside Agent ID with test dollars.
import { fail, randomId } from '../util.ts';
import type { AgentRow, Ctx, ResourceRow } from '../context.ts';

const API = 'https://api.privy.io/v1';
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const ASSETS = ['usdc', 'usdt'] as const;
export type Asset = typeof ASSETS[number];

async function privy(ctx: Ctx, method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string) {
  const appId = ctx.config.env('PRIVY_APP_ID'), secret = ctx.config.env('PRIVY_APP_SECRET');
  if (!appId || !secret) throw fail(503, 'provider_unavailable', 'Live wallets are not set up on this deployment.');
  const response = await ctx.fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${appId}:${secret}`)}`, 'privy-app-id': appId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'privy-idempotency-key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    console.error('[agent-id] privy', response.status, payload?.code || payload?.error, payload?.message);
    throw fail(response.status >= 500 ? 503 : 502, 'wallet_failed', String(payload?.message || payload?.error || 'The wallet provider could not complete the request.').slice(0, 300));
  }
  return payload;
}

const chainOf = (ctx: Ctx, resource?: ResourceRow) => String(resource?.state?.chain || ctx.config.walletChain);
const assetQuery = (chain: string) => ASSETS.map(asset => `asset=${asset}`).join('&') + `&chain=${encodeURIComponent(chain)}`;
// Stablecoin units to cents, rounded down.
export function toCents(raw: string | number, decimals: number) {
  const units = BigInt(String(raw ?? '0').replace(/\D/g, '') || '0');
  return Number(units * 100n / 10n ** BigInt(Math.max(0, Math.min(36, Number(decimals) || 0))));
}
const decimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
export const explorerUrl = (chain: string, hash: string) => chain === 'base_sepolia' ? `https://sepolia.basescan.org/tx/${hash}` : `https://basescan.org/tx/${hash}`;

export async function provisionWallet(ctx: Ctx, agent: AgentRow, mode: 'live' | 'test', attempt: string) {
  if (mode === 'test') return { provider: 'test', address: `test_${randomId(26)}`, providerRef: null as string | null, label: 'Test dollars', currency: 'USD', state: { network: 'test' } };
  const chain = ctx.config.walletChain;
  const wallet = await privy(ctx, 'POST', '/wallets', { chain_type: 'ethereum', display_name: `${agent.name} · Agent ID`.slice(0, 100) }, `agent-id-wallet-${attempt}`);
  if (!wallet?.id || !EVM_ADDRESS.test(String(wallet.address || ''))) throw fail(502, 'wallet_failed', 'The wallet provider did not return a wallet.');
  return { provider: 'privy', address: String(wallet.address), providerRef: String(wallet.id), label: chain === 'base' ? 'USD · USDC and USDT on Base' : 'USD · USDC and USDT on Base Sepolia (testnet)', currency: 'USD', state: { chain, network: chain } };
}

// A live wallet's balance in cents: each stablecoin, and together as USD.
export async function liveBalance(ctx: Ctx, resource: ResourceRow) {
  const result = await privy(ctx, 'GET', `/wallets/${encodeURIComponent(resource.provider_ref!)}/balance?${assetQuery(chainOf(ctx, resource))}`);
  const assets = ASSETS.map(asset => {
    const entries = (result?.balances || []).filter((b: any) => String(b?.asset).toLowerCase() === asset);
    return { asset: asset.toUpperCase(), amount: entries.reduce((sum: number, b: any) => sum + toCents(b.raw_value, b.raw_value_decimals), 0) };
  });
  return { total: assets.reduce((sum, a) => sum + a.amount, 0), assets };
}

// Sends stablecoins; Privy answers at once with an action that finishes on
// chain a few seconds later.
export async function sendStablecoin(ctx: Ctx, resource: ResourceRow, to: string, cents: number, asset: Asset, idempotencyKey: string) {
  if (!EVM_ADDRESS.test(to)) throw fail(400, 'invalid', 'Live wallets send to an 0x address, another agent or a contact.');
  const action = await privy(ctx, 'POST', `/wallets/${encodeURIComponent(resource.provider_ref!)}/transfer`, {
    source: { asset, chain: chainOf(ctx, resource) }, destination: { address: to }, amount: decimal(cents),
  }, idempotencyKey);
  if (!action?.id) throw fail(502, 'wallet_failed', 'The wallet provider did not start the transfer.');
  return { actionId: String(action.id), status: String(action.status || 'pending') };
}

export async function actionStatus(ctx: Ctx, resource: ResourceRow, actionId: string) {
  const action = await privy(ctx, 'GET', `/wallets/${encodeURIComponent(resource.provider_ref!)}/actions/${encodeURIComponent(actionId)}?include=steps`);
  const hash = (action?.steps || []).map((step: any) => step?.transaction_hash || step?.bundle_transaction_hash).find(Boolean) || null;
  const status = String(action?.status || 'pending');
  return { status: status === 'created' ? 'pending' : status, hash: hash ? String(hash) : null, reason: action?.failure_reason ? String(action.failure_reason).slice(0, 300) : null };
}

// Recent stablecoin transfers in and out, newest first.
export async function liveTransactions(ctx: Ctx, resource: ResourceRow) {
  const result = await privy(ctx, 'GET', `/wallets/${encodeURIComponent(resource.provider_ref!)}/transactions?${assetQuery(chainOf(ctx, resource))}&limit=50`);
  return (result?.transactions || []).map((tx: any) => ({
    hash: tx.transaction_hash ? String(tx.transaction_hash) : null, status: String(tx.status || ''), at: Number(tx.created_at) || null,
    direction: tx.details?.type === 'transfer_received' ? 'in' as const : 'out' as const,
    counterparty: String((tx.details?.type === 'transfer_received' ? tx.details?.sender : tx.details?.recipient) || ''),
    asset: String(tx.details?.asset || '').toUpperCase(), amount: toCents(tx.details?.raw_value, tx.details?.raw_value_decimals),
  }));
}
