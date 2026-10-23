// Bank transfers for owners, through Bridge (providers/bridge.ts): verifying
// once with Bridge, the owner's bank accounts, a wallet's own bank details for
// deposits, and withdrawals to a bank. Bank numbers go to Bridge and aren't
// kept here; Agent ID keeps the bank's name and the last four characters.
import { checked, fail, randomId, str } from './util.ts';
import { bankAvailable } from './config.ts';
import type { Owner } from './app.ts';
import type { AgentRow, Ctx, ResourceRow } from './context.ts';
import { audit, personOf, rateLimit, resourceFor } from './shared.ts';
import { withdraw } from './agent.ts';
import { liveBalance } from './providers/wallet.ts';
import {
  addExternalAccount, cancelPayout, createKycLink, createPayin, createPayout, createVirtualAccount, customerDetails, kycLink,
  type NewAccount, payoutState, removeExternalAccount,
} from './providers/bridge.ts';

type Currency = 'usd' | 'eur';
const iso = (ctx: Ctx) => new Date(ctx.now()).toISOString();

// --- The owner, as Bridge's customer -----------------------------------------------------

async function customerRow(ctx: Ctx, userId: string) {
  return checked(await ctx.admin.from('agent_id_bank_customers').select('*').eq('user_id', userId).maybeSingle()) as any;
}

function statusOf(row: any): 'not_started' | 'pending' | 'approved' | 'rejected' {
  if (!row?.kyc_link_ref) return 'not_started';
  if (['rejected', 'offboarded'].includes(row.kyc_status)) return 'rejected';
  if (row.kyc_status === 'approved' && row.tos_status === 'approved') return 'approved';
  return 'pending';
}
// US dollars ride Bridge's "base" endorsement (ACH and wire), euros its "sepa"
// one; each only where this deployment offers it (AGENT_ID_BANK_CURRENCIES).
const ENDORSEMENT: Record<Currency, string> = { usd: 'base', eur: 'sepa' };
const currenciesOf = (ctx: Ctx, row: any): Currency[] =>
  ctx.config.bank.currencies.filter(currency => row?.endorsements?.[ENDORSEMENT[currency]] === 'approved');

// Asks Bridge again while it's still checking (every few seconds at most),
// and now and then once approved, for rails it opens later.
async function refreshed(ctx: Ctx, row: any, { force = false } = {}) {
  if (!row?.kyc_link_ref) return row;
  const status = statusOf(row), age = ctx.now() - (Date.parse(row.updated_at) || 0);
  // Approved without its rails known yet: ask again soon, as while checking.
  const settled = status === 'approved' && Object.keys(row.endorsements || {}).length > 0;
  if (!force && (status === 'rejected' || age < (settled ? 10 * 60_000 : 5_000))) return row;
  try {
    const link = await kycLink(ctx, row.kyc_link_ref);
    const customer = link.customerId || row.customer_ref;
    const details = customer && link.kycStatus === 'approved' ? await customerDetails(ctx, customer) : null;
    const next = {
      customer_ref: customer, kyc_status: link.kycStatus, tos_status: link.tosStatus, kyc_link: link.kycLink, tos_link: link.tosLink,
      rejection: link.rejection, endorsements: details?.endorsements || row.endorsements || {}, updated_at: iso(ctx),
    };
    await ctx.admin.from('agent_id_bank_customers').update(next).eq('user_id', row.user_id);
    const updated = { ...row, ...next };
    await syncPerson(ctx, updated, details);
    return updated;
  } catch (error) {
    console.error('[agent-id] bank status', (error as Error).message);
    return row;
  }
}

// Bridge's check is the person's identity check on Agent ID too, so they
// verify once. A person already verified another way keeps that.
async function syncPerson(ctx: Ctx, row: any, details: { name: string | null; country: string | null } | null) {
  if (ctx.config.kycProvider !== 'bridge') return;
  const person = await personOf(ctx, row.user_id);
  if (person?.status === 'verified' && person.provider !== 'bridge') return;
  const status = statusOf(row);
  const fields = status === 'approved'
    ? { status: 'verified', legal_name: details?.name || person?.legal_name || null, country: details?.country || person?.country || null, verified_at: person?.verified_at || iso(ctx), last_error: null }
    : status === 'rejected' ? { status: 'rejected', last_error: (row.rejection || 'Bridge couldn\'t verify you.').slice(0, 300) }
    : { status: 'pending', last_error: null };
  if (person?.status === fields.status && person?.provider === 'bridge' && (fields.status !== 'verified' || person.legal_name)) return;
  checked(await ctx.admin.from('agent_id_people').upsert({ user_id: row.user_id, provider: 'bridge', provider_ref: row.customer_ref || row.kyc_link_ref, ...fields, updated_at: iso(ctx) }, { onConflict: 'user_id' }).select('user_id'));
  if (fields.status !== 'pending') await audit(ctx, row.user_id, null, 'provider', `verification.person.${fields.status}`, { provider: 'bridge' });
}

// Starts Bridge's identity check (its terms, then an ID and a selfie on its
// page), or picks up the one already started. Returns where to finish it.
export async function startBridgeCheck(ctx: Ctx, owner: Owner, { returnTo = '/agent-id/verify?done=1' } = {}) {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Verify on the Agent ID website.');
  needBank(ctx);
  let row = await customerRow(ctx, owner.userId);
  if (!row?.kyc_link_ref) {
    const person = await personOf(ctx, owner.userId);
    const email = owner.email || (await ctx.admin.auth.admin.getUserById(owner.userId)).data?.user?.email;
    if (!email) throw fail(409, 'email_required', 'Your account needs an email address to verify.');
    const link = await createKycLink(ctx, {
      userId: owner.userId, fullName: String(person?.legal_name || '').trim() || null, email, type: 'individual',
      redirectUri: `${ctx.config.siteUrl}${returnTo}`, endorsements: ctx.config.bank.currencies.map(currency => ENDORSEMENT[currency]),
    });
    checked(await ctx.admin.from('agent_id_bank_customers').upsert({
      user_id: owner.userId, type: 'individual', kyc_link_ref: link.id, customer_ref: link.customerId, kyc_link: link.kycLink, tos_link: link.tosLink,
      kyc_status: link.kycStatus, tos_status: link.tosStatus, rejection: link.rejection, updated_at: iso(ctx),
    }, { onConflict: 'user_id' }));
    await audit(ctx, owner.userId, null, 'owner', 'verification.person.start', { provider: 'bridge' });
    row = await customerRow(ctx, owner.userId);
    await syncPerson(ctx, row, null);
  }
  if (statusOf(row) === 'rejected') throw fail(409, 'verification_rejected', 'Bridge couldn\'t verify you. Contact support if you think this is wrong.');
  return { row, link: linkOf(row) };
}
const linkOf = (row: any) => statusOf(row) === 'pending' ? (row.tos_status !== 'approved' && row.kyc_status === 'approved' ? row.tos_link : row.kyc_link || row.tos_link) || null : null;

// The person's Bridge check, looked at again (from the account page).
export async function refreshBridgeCheck(ctx: Ctx, userId: string) {
  if (ctx.config.kycProvider !== 'bridge') return;
  const row = await customerRow(ctx, userId);
  if (row) await refreshed(ctx, row);
}

// --- A business, checked by Bridge too (KYB) ------------------------------------------

async function businessRow(ctx: Ctx, workspaceId: string) {
  return checked(await ctx.admin.from('agent_id_bank_businesses').select('*').eq('workspace_id', workspaceId).maybeSingle()) as any;
}

// Starts Bridge's business check for an organization (its registration,
// owners and documents, on Bridge's page), or picks up the one started.
export async function startBridgeBusinessCheck(ctx: Ctx, owner: Owner, input: { workspaceId: string; legalName: string; email: string | null }) {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Verify on the Agent ID website.');
  needBank(ctx);
  let row = await businessRow(ctx, input.workspaceId);
  if (!row?.kyc_link_ref) {
    const email = input.email || owner.email || (await ctx.admin.auth.admin.getUserById(owner.userId)).data?.user?.email;
    if (!email) throw fail(409, 'email_required', 'Enter the business\'s email address.');
    const link = await createKycLink(ctx, {
      userId: `business-${input.workspaceId}`, fullName: input.legalName, email, type: 'business',
      redirectUri: `${ctx.config.siteUrl}/agent-id/verify?done=1`, endorsements: ctx.config.bank.currencies.map(currency => ENDORSEMENT[currency]),
    });
    checked(await ctx.admin.from('agent_id_bank_businesses').upsert({
      workspace_id: input.workspaceId, started_by: owner.userId, kyc_link_ref: link.id, customer_ref: link.customerId, kyc_link: link.kycLink, tos_link: link.tosLink,
      kyc_status: link.kycStatus, tos_status: link.tosStatus, rejection: link.rejection, updated_at: iso(ctx),
    }, { onConflict: 'workspace_id' }));
    row = await businessRow(ctx, input.workspaceId);
  }
  if (statusOf(row) === 'rejected') throw fail(409, 'verification_rejected', 'Bridge couldn\'t verify this business. Contact support if you think this is wrong.');
  return { row, link: linkOf(row) };
}

// Bridge's answer moved onto Agent ID's record of the business.
async function syncBusiness(ctx: Ctx, row: any) {
  const business = checked(await ctx.admin.from('agent_id_businesses').select('*').eq('workspace_id', row.workspace_id).maybeSingle()) as any;
  if (!business || business.provider !== 'bridge') return;
  const status = statusOf(row);
  const next = status === 'approved' ? { status: 'verified', verified_at: business.verified_at || iso(ctx), review_note: null }
    : status === 'rejected' ? { status: 'rejected', verified_at: null, review_note: (row.rejection || 'Bridge couldn\'t verify the business.').slice(0, 1000) }
    : { status: 'pending', verified_at: null, review_note: null };
  if (business.status === next.status) return;
  await ctx.admin.from('agent_id_businesses').update({ ...next, provider_ref: row.customer_ref || row.kyc_link_ref, updated_at: iso(ctx) }).eq('workspace_id', row.workspace_id);
  if (business.submitted_by && next.status !== 'pending') await audit(ctx, business.submitted_by, null, 'provider', `verification.business.${next.status}`, { organization: row.workspace_id, provider: 'bridge' });
}

// A business's Bridge check, looked at again while it runs. Returns where to finish it.
export async function refreshBusinessCheck(ctx: Ctx, workspaceId: string, { force = false } = {}) {
  let row = await businessRow(ctx, workspaceId);
  if (!row?.kyc_link_ref) return null;
  const status = statusOf(row);
  if (force || (status === 'pending' && ctx.now() - (Date.parse(row.updated_at) || 0) >= 5_000)) {
    try {
      const link = await kycLink(ctx, row.kyc_link_ref);
      const next = { customer_ref: link.customerId || row.customer_ref, kyc_status: link.kycStatus, tos_status: link.tosStatus, kyc_link: link.kycLink, tos_link: link.tosLink, rejection: link.rejection, updated_at: iso(ctx) };
      await ctx.admin.from('agent_id_bank_businesses').update(next).eq('workspace_id', workspaceId);
      row = { ...row, ...next };
    } catch (error) {
      console.error('[agent-id] business check', (error as Error).message);
    }
  }
  await syncBusiness(ctx, row);
  return linkOf(row);
}

const accountView = (row: any) => ({
  id: row.id, currency: row.currency, rail: row.rail, bankName: row.bank_name || null, last4: row.last4,
  ownerName: row.owner_name || null, createdAt: row.created_at,
});
export const bankLabel = (row: { bank_name?: string | null; last4: string }) => `${row.bank_name || 'Bank'} ••${row.last4}`;

async function accountsOf(ctx: Ctx, userId: string) {
  return (checked(await ctx.admin.from('agent_id_bank_accounts').select('*').eq('user_id', userId).is('removed_at', null).order('created_at')) || []) as any[];
}

export async function bankStatus(ctx: Ctx, owner: Owner) {
  if (!bankAvailable(ctx.config)) return { available: false, status: 'unavailable', currencies: [], accounts: [] };
  const row = await refreshed(ctx, await customerRow(ctx, owner.userId));
  const status = statusOf(row);
  // Euros first for people who live where they're paid in euros.
  const currencies = status === 'approved' ? currenciesOf(ctx, row) : [];
  if (SEPA[(await personOf(ctx, owner.userId))?.country || '']) currencies.sort((a, b) => Number(b === 'eur') - Number(a === 'eur'));
  const link = linkOf(row);
  return {
    available: true, status,
    // Bridge's page: its terms, then its identity check.
    ...(link ? { link } : {}),
    ...(status === 'rejected' && row.rejection ? { rejection: row.rejection } : {}),
    currencies,
    accounts: status === 'approved' ? (await accountsOf(ctx, owner.userId)).map(accountView) : [],
  };
}

function needBank(ctx: Ctx) {
  if (!bankAvailable(ctx.config)) throw fail(409, 'bank_unavailable', 'Bank transfers aren\'t available on this deployment.');
}
async function approvedCustomer(ctx: Ctx, owner: Owner) {
  needBank(ctx);
  const row = await refreshed(ctx, await customerRow(ctx, owner.userId));
  if (statusOf(row) !== 'approved' || !row.customer_ref) throw fail(409, 'bank_not_verified', 'Verify with Bridge first to use your bank.');
  return row;
}

// From the wallet: the same single check, back on the dashboard after.
export async function startBankVerification(ctx: Ctx, owner: Owner) {
  await startBridgeCheck(ctx, owner, { returnTo: '/agent-id/dashboard' });
  return bankStatus(ctx, owner);
}

// --- Bank accounts -----------------------------------------------------------------------

// SEPA countries, as Bridge names them (ISO 3166 alpha-3).
const SEPA: Record<string, string> = {
  AD: 'AND', AT: 'AUT', BE: 'BEL', BG: 'BGR', CH: 'CHE', CY: 'CYP', CZ: 'CZE', DE: 'DEU', DK: 'DNK', EE: 'EST', ES: 'ESP', FI: 'FIN',
  FR: 'FRA', GB: 'GBR', GI: 'GIB', GR: 'GRC', HR: 'HRV', HU: 'HUN', IE: 'IRL', IS: 'ISL', IT: 'ITA', LI: 'LIE', LT: 'LTU', LU: 'LUX',
  LV: 'LVA', MC: 'MCO', MT: 'MLT', NL: 'NLD', NO: 'NOR', PL: 'POL', PT: 'PRT', RO: 'ROU', SE: 'SWE', SI: 'SVN', SK: 'SVK', SM: 'SMR', VA: 'VAT',
};
// An IBAN's own check digits (ISO 13616, mod 97).
export function ibanValid(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest === 1;
}
// ABA routing numbers carry a 3-7-1 weighted checksum.
export function routingValid(routing: string) {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = [...routing].map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

// The holder's home address; its country (two letters) defaults to the bank's.
function holderAddress(input: any, country: string, { state = false } = {}) {
  const a = input.address || {};
  const line1 = str(a.line1, 35, 'address.line1', { required: true }).trim();
  if (line1.length < 4) throw fail(400, 'invalid', 'Enter the street and number of the account holder\'s address.');
  const code = a.country ? str(a.country, 2, 'address.country').toUpperCase() : null;
  return {
    line1, city: str(a.city, 100, 'address.city', { required: true }).trim(),
    state: state ? str(a.state, 50, 'address.state', { required: true }).trim().toUpperCase() : (a.state ? str(a.state, 50, 'address.state').trim() : null),
    postalCode: str(a.postalCode, 20, 'address.postalCode', { required: true }).trim(),
    country: code === 'US' ? 'USA' : (code && SEPA[code]) || country,
  };
}

function accountInput(input: any, currencies: Currency[]): NewAccount & { currency: Currency; rail: 'ach' | 'sepa' } {
  const ownerName = str(input.ownerName, 200, 'ownerName', { required: true }).replace(/\s+/g, ' ').trim();
  const parts = ownerName.split(' ');
  if (parts.length < 2) throw fail(400, 'invalid', 'Enter the account holder\'s first and last name.');
  const [firstName, lastName] = [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
  if (input.kind === 'iban') {
    if (!currencies.includes('eur')) throw fail(409, 'currency_unavailable', 'Bridge hasn\'t opened euro payouts for you.');
    const iban = str(input.iban, 40, 'iban', { required: true }).replace(/\s+/g, '').toUpperCase();
    if (!ibanValid(iban)) throw fail(400, 'invalid', 'That IBAN isn\'t valid. Check it against your bank app.');
    const country = SEPA[iban.slice(0, 2)];
    if (!country) throw fail(400, 'invalid', 'Bank transfers in euros go to an IBAN in a SEPA country.');
    const bic = input.bic ? str(input.bic, 11, 'bic').replace(/\s+/g, '').toUpperCase() : null;
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw fail(400, 'invalid', 'That BIC isn\'t valid.');
    return { kind: 'iban', ownerName, firstName, lastName, iban, bic, country, address: holderAddress(input, country), currency: 'eur', rail: 'sepa' };
  }
  if (input.kind === 'us') {
    if (!currencies.includes('usd')) throw fail(409, 'currency_unavailable', 'Bridge hasn\'t opened US dollar payouts for you.');
    const routingNumber = str(input.routingNumber, 9, 'routingNumber', { required: true }).trim();
    const accountNumber = str(input.accountNumber, 17, 'accountNumber', { required: true }).trim();
    if (!routingValid(routingNumber)) throw fail(400, 'invalid', 'That routing number isn\'t valid.');
    if (!/^\d{4,17}$/.test(accountNumber)) throw fail(400, 'invalid', 'An account number is 4 to 17 digits.');
    const address = holderAddress(input, 'USA', { state: true });
    return { kind: 'us', ownerName, firstName, lastName, accountNumber, routingNumber, checkingOrSavings: input.checkingOrSavings === 'savings' ? 'savings' : 'checking', address, currency: 'usd', rail: 'ach' };
  }
  throw fail(400, 'invalid', 'kind is iban or us.');
}

export async function addBankAccount(ctx: Ctx, owner: Owner, input: any) {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Add bank accounts on the Agent ID website.');
  const customer = await approvedCustomer(ctx, owner);
  const account = accountInput(input, currenciesOf(ctx, customer));
  await rateLimit(ctx, owner.userId, 'bank-account', 5, 20, 'bank accounts');
  const id = `bnk_${randomId(24)}`;
  const saved = await addExternalAccount(ctx, customer.customer_ref, account, `agent-id-bank-${id}`);
  const row = checked(await ctx.admin.from('agent_id_bank_accounts').insert({
    id, user_id: owner.userId, provider_ref: saved.id, currency: account.currency, rail: account.rail,
    bank_name: saved.bankName, last4: saved.last4, owner_name: account.ownerName,
  }).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'bank.account_added', { account: id, currency: account.currency, last4: saved.last4 });
  return { account: accountView(row) };
}

async function ownAccount(ctx: Ctx, owner: Owner, id: string) {
  const row = /^bnk_[a-z0-9]{24}$/.test(id) ? checked(await ctx.admin.from('agent_id_bank_accounts').select('*').eq('id', id).eq('user_id', owner.userId).is('removed_at', null).maybeSingle()) as any : null;
  if (!row) throw fail(404, 'not_found', 'That bank account isn\'t on your account.');
  return row;
}

export async function removeBankAccount(ctx: Ctx, owner: Owner, id: string) {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Remove bank accounts on the Agent ID website.');
  const row = await ownAccount(ctx, owner, id);
  const customer = await customerRow(ctx, owner.userId);
  if (customer?.customer_ref) await removeExternalAccount(ctx, customer.customer_ref, row.provider_ref);
  await ctx.admin.from('agent_id_bank_accounts').update({ removed_at: iso(ctx) }).eq('id', row.id);
  await audit(ctx, owner.userId, null, 'owner', 'bank.account_removed', { account: row.id });
  return { removed: true };
}

// --- Deposits: the wallet's own bank details -------------------------------------------

function liveBaseWallet(ctx: Ctx, wallet: ResourceRow) {
  if (wallet.mode !== 'live' || wallet.status !== 'active' || String(wallet.state?.chain || ctx.config.walletChain) !== 'base' || !wallet.address) {
    throw fail(409, 'bank_unavailable', 'Bank transfers work with live wallets on Base.');
  }
  return wallet;
}

export async function bankDeposit(ctx: Ctx, owner: Owner, agent: AgentRow, input: any) {
  const currency = input.currency === 'eur' ? 'eur' : input.currency === 'usd' ? 'usd' : null;
  if (!currency) throw fail(400, 'invalid', 'currency is usd or eur.');
  const customer = await approvedCustomer(ctx, owner);
  if (!currenciesOf(ctx, customer).includes(currency)) throw fail(409, 'currency_unavailable', `Bridge hasn't opened ${currency === 'eur' ? 'euro' : 'US dollar'} deposits for you.`);
  const wallet = liveBaseWallet(ctx, await resourceFor(ctx, agent.id, 'wallet'));
  const existing = checked(await ctx.admin.from('agent_id_bank_deposits').select('*').eq('resource_id', wallet.id).eq('currency', currency).maybeSingle()) as any;
  if (existing) return { deposit: existing.instructions };
  const created = await createVirtualAccount(ctx, customer.customer_ref, currency, wallet.address!, `agent-id-deposit-${wallet.id}-${currency}`);
  checked(await ctx.admin.from('agent_id_bank_deposits').upsert({ resource_id: wallet.id, currency, user_id: owner.userId, provider_ref: created.id, instructions: created.instructions }, { onConflict: 'resource_id,currency' }));
  await audit(ctx, owner.userId, agent.id, 'owner', 'bank.deposit_details', { currency });
  return { deposit: created.instructions };
}

// --- Pay-ins: adding money with one SEPA transfer ----------------------------------------

const decimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
// Waiting for the person's transfer; the rest are on their way or done.
const PAYIN_OPEN = new Set(['awaiting_funds', 'funds_received', 'in_review', 'payment_submitted']);
const PAYIN_MIN = 100, PAYIN_MAX = 10_000_000; // €1 to €100,000

const payinView = (row: any) => ({
  id: row.id, currency: row.currency, amount: Number(row.amount_minor), state: row.state,
  instructions: row.instructions, createdAt: row.created_at,
});

// The person enters an amount; Bridge opens one transfer for it, to this
// wallet, and they send exactly that with its reference from their bank.
export async function startBankPayin(ctx: Ctx, owner: Owner, agent: AgentRow, input: any) {
  if (owner.via !== 'session') throw fail(403, 'session_required', 'Add money on the Agent ID website.');
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < PAYIN_MIN || amount > PAYIN_MAX) throw fail(400, 'invalid', 'Enter an amount from €1 to €100,000.');
  const customer = await approvedCustomer(ctx, owner);
  if (!currenciesOf(ctx, customer).includes('eur')) throw fail(409, 'currency_unavailable', 'SEPA transfers aren\'t open for you yet.');
  const wallet = liveBaseWallet(ctx, await resourceFor(ctx, agent.id, 'wallet'));
  await rateLimit(ctx, owner.userId, 'bank-payin', 10, 40, 'bank transfers');
  const id = `pay_${randomId(24)}`;
  const payin = await createPayin(ctx, { customerId: customer.customer_ref, amount: decimal(amount), toAddress: wallet.address!, reference: id, idempotencyKey: `agent-id-payin-${id}` });
  const row = checked(await ctx.admin.from('agent_id_bank_payins').insert({
    id, resource_id: wallet.id, user_id: owner.userId, provider_ref: payin.id, currency: 'eur', amount_minor: amount, state: payin.state, instructions: payin.instructions,
    created_at: iso(ctx), updated_at: iso(ctx),
  }).select('*').single());
  await audit(ctx, owner.userId, agent.id, 'owner', 'bank.payin_started', { payin: id, currency: 'eur', amount });
  return { payin: payinView(row) };
}

// The wallet's recent pay-ins, open ones looked at again now and then.
export async function bankPayins(ctx: Ctx, owner: Owner, agent: AgentRow) {
  if (!bankAvailable(ctx.config)) return { payins: [] };
  const wallet = await resourceFor(ctx, agent.id, 'wallet');
  const rows = (checked(await ctx.admin.from('agent_id_bank_payins').select('*').eq('resource_id', wallet.id).eq('user_id', owner.userId).order('created_at', { ascending: false }).limit(10)) || []) as any[];
  for (const row of rows.filter(r => PAYIN_OPEN.has(r.state) && ctx.now() - (Date.parse(r.updated_at) || 0) > 30_000).slice(0, 3)) {
    const state = await payoutState(ctx, row.provider_ref).catch(() => null);
    const next = { state: state || row.state, updated_at: iso(ctx) };
    await ctx.admin.from('agent_id_bank_payins').update(next).eq('id', row.id);
    Object.assign(row, next);
  }
  return { payins: rows.filter(r => r.state !== 'canceled').map(payinView) };
}

// Changed their mind before sending: the transfer is closed at Bridge too.
export async function cancelBankPayin(ctx: Ctx, owner: Owner, agent: AgentRow, id: string) {
  const wallet = await resourceFor(ctx, agent.id, 'wallet');
  const row = /^pay_[a-z0-9]{24}$/.test(id) ? checked(await ctx.admin.from('agent_id_bank_payins').select('*').eq('id', id).eq('resource_id', wallet.id).eq('user_id', owner.userId).maybeSingle()) as any : null;
  if (!row) throw fail(404, 'not_found', 'No such bank transfer.');
  if (row.state !== 'awaiting_funds') throw fail(409, 'too_late', 'The money is already on its way.');
  await cancelPayout(ctx, row.provider_ref);
  await ctx.admin.from('agent_id_bank_payins').update({ state: 'canceled', updated_at: iso(ctx) }).eq('id', row.id);
  await audit(ctx, owner.userId, agent.id, 'owner', 'bank.payin_canceled', { payin: row.id });
  return { canceled: true };
}

export async function setPayinState(ctx: Ctx, transferId: string, state: string) {
  const rows = (checked(await ctx.admin.from('agent_id_bank_payins').update({ state, updated_at: iso(ctx) }).eq('provider_ref', transferId).neq('state', state).select('id')) || []) as any[];
  return rows.length;
}

// --- Withdrawals to a bank -------------------------------------------------------------

// Bridge takes USDC on Base: the payout opens at Bridge, then the wallet sends
// it the USDC, and Bridge pays the bank. Not sent means not paid: the payout
// is cancelled.
export async function withdrawToBank(ctx: Ctx, owner: Owner, agent: AgentRow, input: { bankAccount: string; amount: number; memo?: string }) {
  const customer = await approvedCustomer(ctx, owner);
  const account = await ownAccount(ctx, owner, input.bankAccount);
  const wallet = liveBaseWallet(ctx, await resourceFor(ctx, agent.id, 'wallet'));
  const usdc = (await liveBalance(ctx, wallet)).assets.find(a => a.asset === 'USDC')?.amount || 0;
  if (usdc < input.amount) throw fail(402, 'insufficient', `Bank withdrawals pay out USDC, and the wallet has $${decimal(usdc)} in USDC.`);
  const payout = await createPayout(ctx, {
    customerId: customer.customer_ref, accountId: account.provider_ref, rail: account.rail, currency: account.currency,
    amount: decimal(input.amount), fromAddress: wallet.address!, reference: `agent-id-${randomId(16)}`, idempotencyKey: `agent-id-payout-${randomId(20)}`,
  });
  try {
    const result = await withdraw(ctx, agent, {
      to: payout.to, amount: input.amount, asset: 'usdc', memo: input.memo || 'Withdrawal to bank', label: bankLabel(account),
      data: { bank: { account: account.id, currency: account.currency, last4: account.last4, bankName: account.bank_name || null, transfer: payout.id, state: payout.state } },
    });
    return { ...result, bank: { account: accountView(account), state: payout.state } };
  } catch (error) {
    await cancelPayout(ctx, payout.id);
    throw error;
  }
}

// --- Keeping payouts current (webhooks, and a look when the history is read) -------------

const PAYOUT_DONE = new Set(['payment_processed', 'returned', 'refunded', 'canceled', 'error', 'undeliverable']);

export async function setPayoutState(ctx: Ctx, transferId: string, state: string) {
  const rows = (checked(await ctx.admin.from('agent_id_events').select('id,data').eq('kind', 'wallet').eq('data->bank->>transfer', transferId)) || []) as any[];
  for (const row of rows) {
    if (row.data?.bank?.state === state) continue;
    await ctx.admin.from('agent_id_events').update({ data: { ...row.data, bank: { ...row.data.bank, state, checkedAt: iso(ctx) } } }).eq('id', row.id);
  }
  return rows.length;
}

export async function refreshPayouts(ctx: Ctx, agentId: string) {
  if (!bankAvailable(ctx.config)) return;
  const rows = (checked(await ctx.admin.from('agent_id_events').select('id,data').eq('agent_id', agentId).eq('kind', 'wallet').not('data->bank', 'is', null).order('occurred_at', { ascending: false }).limit(10)) || []) as any[];
  const open = rows.filter(row => row.data?.bank?.transfer && !PAYOUT_DONE.has(row.data.bank.state) && ctx.now() - (Date.parse(row.data.bank.checkedAt || '') || 0) > 60_000).slice(0, 3);
  for (const row of open) {
    const state = await payoutState(ctx, row.data.bank.transfer).catch(() => null);
    await ctx.admin.from('agent_id_events').update({ data: { ...row.data, bank: { ...row.data.bank, ...(state ? { state } : {}), checkedAt: iso(ctx) } } }).eq('id', row.id);
  }
}

// A webhook said a customer or KYC link changed (a person's or a business's): look again now.
export async function refreshCustomer(ctx: Ctx, match: { kycLink?: string; customer?: string }) {
  const find = (table: string, columns: string) => {
    const query = ctx.admin.from(table).select(columns);
    return match.kycLink ? query.eq('kyc_link_ref', match.kycLink) : query.eq('customer_ref', match.customer || '');
  };
  const row = checked(await find('agent_id_bank_customers', '*').maybeSingle()) as any;
  if (row) await refreshed(ctx, row, { force: true });
  const business = checked(await find('agent_id_bank_businesses', 'workspace_id').maybeSingle()) as any;
  if (business) await refreshBusinessCheck(ctx, business.workspace_id, { force: true });
  return !!row || !!business;
}
