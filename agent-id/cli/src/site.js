// Agent ID's website, for the links people open (the dashboard): what the
// Agent ID in use says about itself, so a local one links to its local site.
import { SITE } from './config.js';

// "https://timewarpdev.com" from a link on it (a claim page, the terms).
export const siteFrom = url => /^(https?:\/\/[^?#\s]+?)\/(?:agent-id|legal)\//.exec(String(url || ''))?.[1] || null;

export async function siteOf(ctx) {
  if (ctx.site) return ctx.site;
  let config = null;
  try { config = await ctx.api.get('/v1/config'); } catch { /* production's, then */ }
  const named = String(config?.siteUrl || config?.site || '').replace(/\/+$/, '');
  ctx.site = (/^https?:\/\//.test(named) && named) || siteFrom(config?.legal?.termsUrl) || SITE;
  return ctx.site;
}

export const dashboardOf = site => `${site}/agent-id/dashboard`;
