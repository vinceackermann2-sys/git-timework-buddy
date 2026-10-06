"use strict";
// Check production OAuth routing without signing in or touching a desktop profile.
// Only public identifiers and check results are written to the report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.json');
if(config.googleAuthBridgeUrl){
  const child=require('node:child_process').spawnSync(process.execPath,[require.resolve('./verify-branded-google.cjs')],{stdio:'inherit',windowsHide:true});
  process.exit(child.status??1);
}
const { createAuth } = require('../desktop/auth.cjs');
const report = { verifiedAt: new Date().toISOString(), passed: false, checks: {} };
const output = path.join(__dirname, '../reports/google-oauth-verification.json');
const check = (name, value, message) => {
  report.checks[name] = Boolean(value);
  assert.ok(value, message);
};
const request = (url, options = {}) => fetch(url, {
  ...options, signal: AbortSignal.timeout(30000),
});

(async () => {
  const auth = createAuth({ config, storage: {
    load: () => ({ session: null, capability: null }),
    save: () => {}, saveFlow: () => {}, loadFlow: () => null,
  } });
  await auth.init();
  check('googleProviderEnabled', (await auth.providers()).google,
    'Enable Google in the authentication provider configuration.');
  const authorize = new URL(await auth.beginOAuth('google'));
  const desktopCallback = authorize.searchParams.get('redirect_to');
  const response = await request(authorize, { redirect: 'manual' });
  check('supabaseStartsOAuth', response.status === 302,
    'Supabase did not start Google OAuth.');
  const google = new URL(response.headers.get('location'));
  check('usesGoogleProvider', google.origin === 'https://accounts.google.com',
    'OAuth did not redirect to the Google provider.');
  report.clientId = google.searchParams.get('client_id');
  report.providerCallback = google.searchParams.get('redirect_uri');
  check('usesSupabaseCallback', report.providerCallback === `${config.supabaseUrl}/auth/v1/callback`,
    'Google OAuth is using an unexpected provider callback.');

  const signIn = await request(google);
  const signInUrl = new URL(signIn.url);
  const html = await signIn.text();
  const mismatch = html.includes('redirect_uri_mismatch');

  // Cancel only this diagnostic flow to verify Supabase's desktop allowlist.
  const cancel = new URL(`${config.supabaseUrl}/auth/v1/callback`);
  cancel.search = new URLSearchParams({ error: 'access_denied',
    error_description: 'Diagnostic cancellation', state: google.searchParams.get('state') });
  const cancelled = await request(cancel, { redirect: 'manual' });
  const target = cancelled.headers.get('location');
  report.desktopCallback = target ? new URL(target).origin + new URL(target).pathname : null;
  check('desktopCallbackAllowed', cancelled.status === 302 && report.desktopCallback === desktopCallback,
    'Add the desktop callback to the Supabase redirect URL allowlist.');
  check('googleAcceptsCallback', !mismatch && signIn.ok &&
    signInUrl.origin === 'https://accounts.google.com' &&
    signInUrl.pathname.includes('/signin/') && !signInUrl.pathname.includes('/oauth/error'),
    'Google rejected the callback. Register the provider callback on the configured Google OAuth client.');
  report.googleSignInPath = signInUrl.pathname;
  report.passed = true;
})().catch(error => {
  report.error = error.message;
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
});
