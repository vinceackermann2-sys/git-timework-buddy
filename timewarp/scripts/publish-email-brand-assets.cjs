"use strict";
// Publishes only the public app logo. CLI credentials stay in process memory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { keys, root } = require('./live-client.cjs');
const config = require('../config.json');

async function main() {
  const credential = keys();
  const bucket = 'timewarp-brand-assets';
  const filename = 'timewarp-email-logo.png';
  const bytes = fs.readFileSync(path.join(root, 'assets/app-icon.png'));
  const headers = { apikey: config.publishableKey, Authorization: `Bearer ${credential}` };
  const request = (route, options = {}) => fetch(config.supabaseUrl + '/storage/v1/' + route, {
    ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000),
  });
  const existing = await request('bucket/' + bucket);
  if (existing.ok) {
    const settings = await existing.json();
    if (!settings.public) throw Error('The email asset bucket must be public.');
  } else if (existing.status === 404 || existing.status === 400) {
    const created = await request('bucket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true, allowed_mime_types: ['image/png'], file_size_limit: 1048576 }),
    });
    if (!created.ok) throw Error('Email asset bucket creation failed: ' + created.status);
  } else throw Error('Could not inspect email asset bucket: ' + existing.status);

  const upload = await request(`object/${bucket}/${filename}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png', 'x-upsert': 'true', 'cache-control': 'max-age=3600' }, body: bytes,
  });
  if (!upload.ok) throw Error('Email logo upload failed: ' + upload.status);
  const logoUrl = `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
  const publicLogo = await fetch(logoUrl, { signal: AbortSignal.timeout(30000) });
  if (!publicLogo.ok || !publicLogo.headers.get('content-type')?.startsWith('image/png')) throw Error('Public email logo is unavailable.');
  const downloaded = Buffer.from(await publicLogo.arrayBuffer());
  if (!downloaded.equals(bytes)) throw Error('Public email logo differs from the app logo.');
  const report = { logoUrl, public: true, matchesApp: true, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join(root, 'reports/email-brand-asset.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
