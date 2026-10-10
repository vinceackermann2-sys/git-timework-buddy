"use strict";
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { checkRelease: validateRelease } = require('./release-config.cjs');
const { requireSignature } = require('./signing.cjs');
const root = path.resolve(__dirname,'..');
function verifyManifest(manifest, release, directory) {
  assert.equal(manifest.version,release.version,'Update metadata version matches the app');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length===1,'One x64 installer is expected');
  const entry=manifest.files[0],expected=`Timewarp-Setup-${release.version}-x64.exe`;
  assert.equal(entry.url,expected,'Update file is the local signed installer');
  const file=path.join(directory,expected),bytes=fs.readFileSync(file);
  assert.equal(entry.size,bytes.length);assert.equal(entry.sha512,crypto.createHash('sha512').update(bytes).digest('base64'));
  return file;
}
async function verify() {
  const release=validateRelease(JSON.parse(fs.readFileSync(process.env.TIMEWARP_RELEASE_CONFIG||path.join(root,'release.json'),'utf8')));
  assert.ok(release.enabled,'Public release configuration is required');
  const stage=path.join(root,'build/native'),output=path.join(root,'build/release');
  const asar=await import('@electron/asar');
  const embedded=JSON.parse(asar.extractFile(path.join(stage,'resources/app.asar'),'out/main/timewarp/release.json').toString());
  assert.deepEqual(embedded,release,'The signed app embeds the requested feed and publisher');
  const metadata=require('js-yaml').load(fs.readFileSync(path.join(output,'latest.yml'),'utf8'));
  const installer=verifyManifest(metadata,release,output);
  const appSignature=requireSignature(path.join(stage,'Timewarp.exe'),release.publisherNames),installerSignature=requireSignature(installer,release.publisherNames);
  fs.writeFileSync(path.join(output,'release-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),version:release.version,updateUrl:release.updateUrl,appSignature,installerSignature,installer:path.basename(installer),sha256:crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),liveAcceptanceRequired:true},null,2));
  console.log('Valid timestamped app/installer signatures and update metadata verified. Live acceptance is still required.');
}
module.exports={verifyManifest};
if(require.main===module)verify().catch(error=>{console.error(error.message);process.exitCode=1;});
