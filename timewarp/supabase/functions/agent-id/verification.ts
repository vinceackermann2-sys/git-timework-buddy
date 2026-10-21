// Who is responsible for an agent. A person verifies their identity (KYC)
// once: with Bridge where it moves money to and from banks (bank.ts), else
// with Stripe Identity. Either checks a document and a matching selfie;
// Agent ID keeps only the outcome, the name and the country. A business
// (KYB) is checked by Bridge too where it's on (its registration, owners and
// documents), else reviewed by Timewarp from its registration details. Without
// a provider, people are reviewed by hand too. 'test' verifies at once and is
// for development deployments only.
import { checked, CORS, EMAIL, fail, str } from './util.ts';
import type { Owner } from './app.ts';
import type { Ctx } from './context.ts';
import { audit, membership, personOf } from './shared.ts';
import { stripe } from './providers/stripe.ts';
import { completeClaims } from './claims.ts';
import { startBridgeBusinessCheck, startBridgeCheck } from './bank.ts';
import { BUCKET } from './files.ts';

const COUNTRY = /^[A-Z]{2}$/;
const country = (value: unknown, field = 'country') => { const code = str(value, 2, field, { required: true }).toUpperCase(); if (!COUNTRY.test(code)) throw fail(400, 'invalid', `${field} must be a two-letter country code.`); return code; };

export function personView(row: any) {
  return row ? { status: row.status, provider: row.provider, legalName: row.legal_name, country: row.country, verifiedAt: row.verified_at, lastError: row.last_error, consentAt: row.consent_at } : { status: 'unverified' };
}
export function businessView(row: any, link?: string | null) {
  return row ? { status: row.status, provider: row.provider || 'manual', ...(link ? { link } : {}), legalName: row.legal_name, registrationNumber: row.registration_number, vatNumber: row.vat_number || null, country: row.country, website: row.website, representativeRole: row.representative_role, document: row.document_name ? { name: row.document_name } : null, checks: row.checks || {}, verifiedAt: row.verified_at, note: row.review_note } : { status: 'unverified' };
}

async function savePerson(ctx: Ctx, userId: string, fields: Record<string, unknown>) {
  return checked(await ctx.admin.from('agent_id_people').upsert({ user_id: userId, ...fields, updated_at: new Date(ctx.now()).toISOString() }, { onConflict: 'user_id' }).select('*').single());
}

export async function startVerification(ctx: Ctx, owner: Owner, input: any, options: { returnUrl?: string } = {}) {
  if (input.kind === 'business') return submitBusiness(ctx, owner, input);
  if (input.kind !== 'person') throw fail(400, 'invalid', 'kind is person or business.');
  const current = await personOf(ctx, owner.userId);
  if (current?.status === 'verified') return { person: personView(current) };
  // Bridge's own page asks for its terms and consent, and checks the ID and selfie.
  if (ctx.config.kycProvider === 'bridge') {
    const { link } = await startBridgeCheck(ctx, owner);
    return { person: personView(await personOf(ctx, owner.userId)), ...(link ? { url: link } : {}) };
  }
  // The check involves biometric data: explicit consent comes first, and is recorded.
  if (input.consent !== true) throw fail(400, 'consent_required', 'Agree to the identity check (your ID document and a selfie) first.');
  await savePerson(ctx, owner.userId, { consent_version: ctx.config.termsVersion, consent_at: new Date(ctx.now()).toISOString() });
  await audit(ctx, owner.userId, null, 'owner', 'verification.person.consent', { version: ctx.config.termsVersion });
  const provider = ctx.config.kycProvider;
  if (provider === 'stripe_identity') {
    const session = await stripe(ctx, 'POST', '/v1/identity/verification_sessions', {
      type: 'document',
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      metadata: { agent_id_user: owner.userId },
      ...(owner.email ? { provided_details: { email: owner.email } } : {}),
      return_url: options.returnUrl || `${ctx.config.siteUrl}/agent-id/verify?done=1`,
    }, `agent-id-kyc-${owner.userId}-${Math.floor(ctx.now() / 600_000)}`);
    const row = await savePerson(ctx, owner.userId, { status: 'pending', provider, provider_ref: String(session.id), last_error: null });
    await audit(ctx, owner.userId, null, 'owner', 'verification.person.start', { provider });
    return { person: personView(row), url: String(session.url) };
  }
  const legalName = str(input.legalName, 200, 'legalName', { required: true });
  const code = country(input.country);
  const verified = provider === 'test';
  const row = await savePerson(ctx, owner.userId, { status: verified ? 'verified' : 'pending', provider, legal_name: legalName, country: code, verified_at: verified ? new Date(ctx.now()).toISOString() : null, last_error: null });
  await audit(ctx, owner.userId, null, 'owner', 'verification.person.submit', { provider });
  if (verified) await completeClaims(ctx, owner.userId);
  return { person: personView(row) };
}

async function submitBusiness(ctx: Ctx, owner: Owner, input: any) {
  const workspaceId = str(input.organizationId, 60, 'organizationId', { required: true });
  const role = await membership(ctx, owner.userId, workspaceId);
  if (role !== 'owner' && role !== 'admin') throw fail(403, 'forbidden', 'Only an owner or admin of the organization can verify it.');
  const existing = checked(await ctx.admin.from('agent_id_businesses').select('status,checks').eq('workspace_id', workspaceId).maybeSingle()) as any;
  if (existing?.status === 'verified') throw fail(409, 'already_verified', 'This organization is already verified.');
  // A real, verified person stands behind every business.
  if ((await personOf(ctx, owner.userId))?.status !== 'verified') throw fail(403, 'person_verification_required', 'Verify your own identity first; a verified person submits the business.');
  const representativeRole = str(input.representativeRole, 100, 'representativeRole', { required: true });
  if (input.attestation !== true) throw fail(400, 'attestation_required', 'Confirm that you may act for this business and that the details are correct.');
  const verified = ctx.config.kybProvider === 'test';
  const website = input.website ? str(input.website, 300, 'website') : null;
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) throw fail(400, 'invalid', 'website must be a web address.');
  const code = country(input.country);
  const vatNumber = input.vatNumber ? str(input.vatNumber, 30, 'vatNumber').toUpperCase().replace(/[\s.-]/g, '') : null;
  if (vatNumber && !/^[A-Z0-9]{4,20}$/.test(vatNumber)) throw fail(400, 'invalid', 'vatNumber must be a VAT number like SE556000000001.');
  const checks: Record<string, unknown> = { ...(existing?.checks || {}) };
  if (vatNumber) checks.vat = await viesCheck(ctx, vatNumber, code);
  if (ctx.config.kybProvider === 'bridge') {
    // Bridge's page asks for the registration, the owners and the documents.
    const legalName = str(input.legalName, 200, 'legalName', { required: true });
    const email = input.email ? str(input.email, 254, 'email') : null;
    if (email && !EMAIL.test(email)) throw fail(400, 'invalid', 'Enter a valid email address for the business.');
    const { row: check, link } = await startBridgeBusinessCheck(ctx, owner, { workspaceId, legalName, email });
    const row = checked(await ctx.admin.from('agent_id_businesses').upsert({
      workspace_id: workspaceId, status: 'pending', provider: 'bridge', provider_ref: check.customer_ref || check.kyc_link_ref,
      legal_name: legalName, registration_number: input.registrationNumber ? str(input.registrationNumber, 100, 'registrationNumber') : null,
      vat_number: vatNumber, checks, country: code, website, submitted_by: owner.userId, representative_role: representativeRole,
      attested_at: new Date(ctx.now()).toISOString(), review_note: null, verified_at: null, updated_at: new Date(ctx.now()).toISOString(),
    }, { onConflict: 'workspace_id' }).select('*').single());
    await audit(ctx, owner.userId, null, 'owner', 'verification.business.start', { organization: workspaceId, provider: 'bridge' });
    return { business: businessView(row, link), ...(link ? { url: link } : {}) };
  }
  const row = checked(await ctx.admin.from('agent_id_businesses').upsert({
    workspace_id: workspaceId, status: verified ? 'verified' : 'pending', provider: ctx.config.kybProvider,
    legal_name: str(input.legalName, 200, 'legalName', { required: true }),
    registration_number: str(input.registrationNumber, 100, 'registrationNumber', { required: true }),
    vat_number: vatNumber, checks,
    country: code, website, submitted_by: owner.userId, representative_role: representativeRole, attested_at: new Date(ctx.now()).toISOString(), review_note: null,
    verified_at: verified ? new Date(ctx.now()).toISOString() : null, updated_at: new Date(ctx.now()).toISOString(),
  }, { onConflict: 'workspace_id' }).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'verification.business.submit', { organization: workspaceId });
  return { business: businessView(row) };
}

// The EU's VAT register (VIES): whether the number is real, and the name and
// address it's registered to, for the reviewer to compare. Outside the EU, or
// when VIES can't be reached, the reviewer checks the registry by hand.
const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
async function viesCheck(ctx: Ctx, vatNumber: string, countryCode: string) {
  const prefixed = /^[A-Z]{2}/.test(vatNumber);
  const prefix = prefixed ? vatNumber.slice(0, 2) : (countryCode === 'GR' ? 'EL' : countryCode);
  const number = prefixed ? vatNumber.slice(2) : vatNumber;
  const at = new Date(ctx.now()).toISOString();
  if (!EU.has(prefix)) return { source: 'vies', status: 'not_applicable', at };
  try {
    const response = await ctx.fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${prefix}/vat/${encodeURIComponent(number)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok || typeof body?.isValid !== 'boolean') return { source: 'vies', status: 'unavailable', at };
    const clean = (value: unknown) => { const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200); return text && text !== '---' ? text : null; };
    return { source: 'vies', status: body.isValid ? 'valid' : 'invalid', number: `${prefix}${number}`, name: clean(body.name), address: clean(body.address), at };
  } catch {
    return { source: 'vies', status: 'unavailable', at };
  }
}

// The business's registration document (a certificate or registry extract),
// kept privately for reviewers. The file is the request body.
export async function uploadBusinessDocument(ctx: Ctx, owner: Owner, req: Request, organizationId: string) {
  const workspaceId = str(organizationId, 60, 'organization', { required: true });
  const role = await membership(ctx, owner.userId, workspaceId);
  if (role !== 'owner' && role !== 'admin') throw fail(403, 'forbidden', 'Only an owner or admin of the organization can verify it.');
  if (Number(req.headers.get('content-length')) > 10 * 1024 * 1024) throw fail(413, 'too_large', 'The document can be at most 10 MB.');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) throw fail(400, 'invalid', 'Send the document as the request body.');
  if (bytes.byteLength > 10 * 1024 * 1024) throw fail(413, 'too_large', 'The document can be at most 10 MB.');
  const type = String(req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(type)) throw fail(400, 'invalid', 'Send a PDF or a photo (PNG, JPEG or WebP).');
  let name = req.headers.get('x-filename') || 'document';
  try { name = decodeURIComponent(name); } catch { /* as given */ }
  name = name.replace(/[\\/\u0000-\u001f<>:"|?*]+/g, '_').slice(0, 200) || 'document';
  const existing = checked(await ctx.admin.from('agent_id_businesses').select('status,document_path').eq('workspace_id', workspaceId).maybeSingle()) as any;
  if (existing?.status === 'verified') throw fail(409, 'already_verified', 'This organization is already verified.');
  const path = `business/${workspaceId}/${crypto.randomUUID()}`;
  const { error } = await ctx.admin.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) { console.error('[agent-id] business document', error.message); throw fail(503, 'unavailable', 'The document could not be stored. Try again.'); }
  if (existing?.document_path) await ctx.admin.storage.from(BUCKET).remove([existing.document_path]);
  const row = checked(await ctx.admin.from('agent_id_businesses').upsert({ workspace_id: workspaceId, ...(existing ? {} : { status: 'unverified' }), document_path: path, document_name: name, updated_at: new Date(ctx.now()).toISOString() }, { onConflict: 'workspace_id' }).select('*').single());
  await audit(ctx, owner.userId, null, 'owner', 'verification.business.document', { organization: workspaceId });
  return { business: businessView(row) };
}

// --- Reviews (Timewarp staff named in AGENT_ID_REVIEWERS) --------------------
function reviewer(ctx: Ctx, owner: Owner) {
  if (owner.via !== 'session' || !ctx.config.reviewers.has(owner.userId)) throw fail(403, 'forbidden', 'Only Agent ID reviewers can do this.');
}
export async function listReviews(ctx: Ctx, owner: Owner) {
  reviewer(ctx, owner);
  const [people, businesses] = await Promise.all([
    ctx.admin.from('agent_id_people').select('*').eq('status', 'pending').eq('provider', 'manual').order('updated_at').limit(100),
    ctx.admin.from('agent_id_businesses').select('*').eq('status', 'pending').order('updated_at').limit(100),
  ]);
  return {
    people: (checked(people) || []).map((row: any) => ({ userId: row.user_id, ...personView(row), submittedAt: row.updated_at })),
    businesses: (checked(businesses) || []).map((row: any) => ({ organizationId: row.workspace_id, submittedBy: row.submitted_by, ...businessView(row), submittedAt: row.updated_at })),
  };
}
// A business's document, for reviewers.
export async function reviewDocument(ctx: Ctx, owner: Owner, workspaceId: string) {
  reviewer(ctx, owner);
  const row = /^[0-9a-f-]{36}$/.test(workspaceId) ? checked(await ctx.admin.from('agent_id_businesses').select('document_path,document_name').eq('workspace_id', workspaceId).maybeSingle()) as any : null;
  if (!row?.document_path) throw fail(404, 'not_found', 'This business sent no document.');
  const { data, error } = await ctx.admin.storage.from(BUCKET).download(row.document_path);
  if (error || !data) throw fail(503, 'unavailable', 'The document could not be read. Try again.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  return new Response(bytes, { headers: { ...CORS, 'content-type': data.type || 'application/octet-stream', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.document_name || 'document')}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
export async function decideReview(ctx: Ctx, owner: Owner, kind: string, id: string, input: any) {
  reviewer(ctx, owner);
  if (input.decision !== 'approve' && input.decision !== 'reject') throw fail(400, 'invalid', 'decision is approve or reject.');
  const note = str(input.note, 1000, 'note', { multiline: true }) || null;
  const now = new Date(ctx.now()).toISOString();
  const status = input.decision === 'approve' ? 'verified' : 'rejected';
  if (kind === 'person') {
    const rows = checked(await ctx.admin.from('agent_id_people').update({ status, verified_at: status === 'verified' ? now : null, last_error: status === 'rejected' ? note : null, updated_at: now }).eq('user_id', id).eq('status', 'pending').select('*')) as any[];
    if (!rows?.length) throw fail(404, 'not_found', 'No pending verification for that person.');
    await audit(ctx, id, null, 'system', `verification.person.${status}`, { reviewer: owner.userId });
    if (status === 'verified') await completeClaims(ctx, id);
    return { person: personView(rows[0]) };
  }
  if (kind === 'business') {
    const rows = checked(await ctx.admin.from('agent_id_businesses').update({ status, verified_at: status === 'verified' ? now : null, review_note: note, updated_at: now }).eq('workspace_id', id).eq('status', 'pending').select('*')) as any[];
    if (!rows?.length) throw fail(404, 'not_found', 'No pending verification for that organization.');
    if (rows[0].submitted_by) await audit(ctx, rows[0].submitted_by, null, 'system', `verification.business.${status}`, { organization: id, reviewer: owner.userId });
    return { business: businessView(rows[0]) };
  }
  throw fail(404, 'not_found', 'Reviews are for a person or a business.');
}

// Stripe Identity's answer (webhooks.ts). The name and country come from the
// checked document; the document itself stays with Stripe.
export async function identityEvent(ctx: Ctx, event: any) {
  const session = event?.data?.object;
  const userId = session?.metadata?.agent_id_user;
  if (!session?.id || !userId) return;
  const current = await personOf(ctx, userId);
  if (current?.provider_ref && current.provider_ref !== session.id) return; // An older attempt.
  if (event.type === 'identity.verification_session.verified') {
    const full = await stripe(ctx, 'GET', `/v1/identity/verification_sessions/${encodeURIComponent(session.id)}?expand[]=verified_outputs`);
    const out = full?.verified_outputs || {};
    const name = [out.first_name, out.last_name].filter(Boolean).join(' ').trim() || null;
    const code = String(out.address?.country || full?.last_verification_report?.document?.issuing_country || '').toUpperCase();
    await savePerson(ctx, userId, { status: 'verified', provider: 'stripe_identity', provider_ref: session.id, legal_name: name, country: COUNTRY.test(code) ? code : null, verified_at: new Date(ctx.now()).toISOString(), last_error: null });
    await audit(ctx, userId, null, 'provider', 'verification.person.verified', { provider: 'stripe_identity' });
    await completeClaims(ctx, userId);
  } else if (event.type === 'identity.verification_session.requires_input') {
    await savePerson(ctx, userId, { status: 'unverified', provider: 'stripe_identity', provider_ref: session.id, last_error: String(session.last_error?.reason || session.last_error?.code || 'The check did not pass. Try again.').slice(0, 300) });
    await audit(ctx, userId, null, 'provider', 'verification.person.failed', { code: session.last_error?.code || null });
  } else if (event.type === 'identity.verification_session.canceled') {
    await savePerson(ctx, userId, { status: 'unverified', provider: 'stripe_identity', provider_ref: session.id });
  }
}
