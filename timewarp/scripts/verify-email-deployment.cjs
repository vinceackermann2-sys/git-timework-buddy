"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process'), assert = require('node:assert/strict');
const config = require('../config.json'), root = path.resolve(__dirname, '..');
const cliJson = command => JSON.parse(cp.execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 }));
async function main() {
  const functions = cliJson('npx --yes supabase functions list --project-ref mrqoeywofslgnquvzhuf --output json');
  const names = ['auth-email-hook', 'contact', 'timewarp-workspaces'];
  const deployed = functions.filter(row => names.includes(row.slug)).map(({ slug, status, version, verify_jwt }) => ({ slug, status, version, verify_jwt }));
  assert.equal(deployed.length, 3);
  for (const row of deployed) { assert.equal(row.status, 'ACTIVE'); assert.equal(row.verify_jwt, false); }
  const secrets = cliJson('npx --yes supabase secrets list --project-ref mrqoeywofslgnquvzhuf --output json');
  const senderHash = crypto.createHash('sha256').update('Timewarp <noreply@agents.timewarpdev.com>').digest('hex');
  assert.equal(secrets.find(row => row.name === 'TIMEWARP_EMAIL_FROM')?.value, senderHash, 'Live sender has the Timewarp name');
  const checks = [];
  for (const [slug, method, expected] of [['auth-email-hook', 'GET', 405], ['auth-email-hook', 'POST', 401], ['contact', 'POST', 400], ['timewarp-workspaces', 'POST', 401]]) {
    const response = await fetch(config.supabaseUrl + '/functions/v1/' + slug, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, expected, slug + ' live request validation');
    checks.push({ function: slug, method, status: response.status });
  }
  const directory = path.join(root, 'backups/email-branding-after/supabase/functions');
  const files = ['auth-email-hook/index.ts', 'auth-email-hook/messages.ts', 'contact/index.ts', 'timewarp-workspaces/index.ts', ...fs.readdirSync(path.join(root, 'supabase/functions/_shared/email-templates')).filter(file => file.endsWith('.tsx')).map(file => '_shared/email-templates/' + file)];
  for (const file of files) {
    const normalize = value => value.replaceAll('\r\n', '\n').trim();
    assert.equal(normalize(fs.readFileSync(path.join(directory, file), 'utf8')), normalize(fs.readFileSync(path.join(root, 'supabase/functions', file), 'utf8')), 'Deployed source matches: ' + file);
  }
  const logoReport = JSON.parse(fs.readFileSync(path.join(root, 'reports/email-brand-asset.json')));
  const logo = await fetch(logoReport.logoUrl, { signal: AbortSignal.timeout(30000) });
  assert.equal(logo.status, 200);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await logo.arrayBuffer())).digest('hex'), logoReport.sha256);
  const report = { verifiedAt: new Date().toISOString(), passed: true, deployed, senderBranded: true, publicLogoMatchesApp: true, deployedFilesMatched: files.length, checks, inboxDeliveryTested: false };
  fs.writeFileSync(path.join(root, 'reports/email-deployment-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
