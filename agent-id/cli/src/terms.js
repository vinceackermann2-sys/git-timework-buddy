// Agent ID's terms of service: creating agents needs them accepted
// (POST /v1/account/terms with the version GET /v1/config names).
import { ApiError, CliError } from './errors.js';

export async function currentTerms(ctx) {
  const legal = (await ctx.api.get('/v1/config'))?.legal || {};
  return legal.termsVersion ? { version: legal.termsVersion, url: legal.termsUrl || null } : null;
}

// Shows the terms and asks; `yes` accepts without asking (an explicit
// `timewarp-id terms --yes`). Returns the accepted version, or null.
export async function acceptTerms(ctx, { yes = false } = {}) {
  const terms = await currentTerms(ctx);
  if (!terms) return null;
  ctx.err(`Agent ID's terms of service (version ${terms.version})${terms.url ? `: ${terms.url}` : ''}`);
  const accepted = yes || (ctx.interactive && /^y(es)?$/i.test((await ctx.ask('Do you accept them? [y/N] ')).trim()));
  if (!accepted) return null;
  await ctx.owner.post('/v1/account/terms', { version: terms.version });
  return terms.version;
}

// Runs `create`; when Agent ID asks for the terms first, offers them in a
// terminal and tries again once they are accepted. Elsewhere the error's
// hint says to run `timewarp-id terms`.
export async function withTerms(ctx, create) {
  try { return await create(); }
  catch (error) {
    if (!(error instanceof ApiError && error.code === 'terms_required') || !ctx.interactive || ctx.json) throw error;
    ctx.err('Creating agents needs Agent ID\'s terms of service accepted first.');
    if (!(await acceptTerms(ctx))) throw error;
    return create();
  }
}

export async function terms(ctx) {
  const current = await currentTerms(ctx);
  if (!current) return ctx.print({ terms: null }, () => 'This Agent ID has no terms to accept.');
  const version = await acceptTerms(ctx, { yes: ctx.flags.yes === true });
  if (!version) {
    throw new CliError('The terms are not accepted.', { hint: `Read them${current.url ? ` at ${current.url}` : ''}, then run \`timewarp-id terms --yes\` to accept them.` });
  }
  ctx.print({ terms: { ...current, accepted: true } }, () => `Accepted Agent ID's terms of service (version ${version}).`);
}
