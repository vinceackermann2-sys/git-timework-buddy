"use strict";
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const { checkRelease: validateRelease } = require('./release-config.cjs');
const { signFile, requireSignature } = require('./signing.cjs');
const root = path.resolve(__dirname, '..');
async function installer() {
  const draft = process.argv.includes('--draft');
  const release = draft ? { enabled: false } : validateRelease(JSON.parse(fs.readFileSync(process.env.TIMEWARP_RELEASE_CONFIG || path.join(root, 'release.json'), 'utf8')));
  if (!draft && !release.enabled) throw new Error('Public installers require an enabled release configuration.');
  if (draft && process.env.TIMEWARP_RELEASE_CONFIG) throw new Error('Remove TIMEWARP_RELEASE_CONFIG when building a draft.');
  if (!draft && !process.env.TIMEWARP_CERT_SHA1 && !process.env.WIN_CSC_LINK && !process.env.TIMEWARP_SIGN_SCRIPT) throw new Error('Release signing credentials/service have not been configured.');
  const env = { ...process.env, ...(draft ? {} : { TIMEWARP_RELEASE_CONFIG: process.env.TIMEWARP_RELEASE_CONFIG || path.join(root,'release.json') }) };
  cp.execFileSync(process.execPath, [path.join(__dirname,'build.cjs'),'--stage'], { env, stdio: 'inherit', windowsHide: true });
  cp.execFileSync(process.execPath, [path.join(__dirname,'verify-build.cjs'),'--staged'], { stdio: 'inherit', windowsHide: true });
  cp.execFileSync(process.execPath, [path.join(__dirname,'audit-runtime.cjs')], { stdio: 'inherit', windowsHide: true });
  const stage = path.join(root,'build/native');
  const metadata = JSON.parse((await import('@electron/asar')).extractFile(path.join(stage,'resources/app.asar'),'package.json').toString());
  if (!draft) { await signFile(path.join(stage,'Timewarp.exe')); requireSignature(path.join(stage,'Timewarp.exe'),release.publisherNames); }
  if (draft) {
    fs.renameSync(path.join(stage,'Timewarp.exe'),path.join(stage,'Timewarp Preview.exe'));
    const reportPath=path.join(root,'reports/staged-build.json'),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));report.exe=path.join(stage,'Timewarp Preview.exe');fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  }
  const output = path.join(root, draft ? 'build/installer-draft' : 'build/release');
  const nsisInclude=require('./nsis.cjs').generateInclude(path.join(root,'build/native-uninstaller.nsh'),stage);
  // Draft and public outputs are separate; no command here uploads or installs.
  const artifacts = await build({ projectDir: root, prepackaged: stage, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'],Arch.x64), config: {
    appId: draft ? 'com.timewarp.desktop.preview' : 'com.timewarp.desktop', productName: draft ? 'Timewarp Preview' : 'Timewarp', executableName: draft ? 'Timewarp Preview' : 'Timewarp',
    electronVersion: require('electron/package.json').version, forceCodeSigning: !draft,
    extraMetadata: { name: draft ? 'timewarp-preview' : 'timewarp-desktop', version: metadata.version, description: 'Timewarp desktop with a local agent harness', author: 'Timewarp' },
    directories: { output, buildResources: path.join(root,'assets') }, npmRebuild: false,
    publish: draft ? null : [{ provider: 'generic', url: release.updateUrl, channel: 'latest' }],
    win: { target: 'nsis', icon: path.join(root,'assets/app-icon.ico'), signExecutable: !draft, verifyUpdateCodeSignature: true,
      signtoolOptions: { signingHashAlgorithms: ['sha256'], ...(draft ? {} : { publisherName: release.publisherNames, sign: async options => { await signFile(options.path); requireSignature(options.path,release.publisherNames); } }) } },
    nsis: { include: nsisInclude, oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, runAfterFinish: false,
      shortcutName: draft ? 'Timewarp Preview' : 'Timewarp', artifactName: draft ? 'Timewarp-Preview-${version}-${arch}.${ext}' : 'Timewarp-Setup-${version}-${arch}.${ext}' }
  } });
  if (draft) { console.log('Unsigned preview installer built for local acceptance: ' + output); return; }
  cp.execFileSync(process.execPath,[path.join(__dirname,'verify-release.cjs')],{env,stdio:'inherit',windowsHide:true});
  console.log('Verified signed artifacts prepared at ' + output + '. Publish only after live acceptance.');
}
installer().catch(error=>{console.error(error.message);process.exitCode=1;process.once('exit',()=>{process.exitCode=1;});});
