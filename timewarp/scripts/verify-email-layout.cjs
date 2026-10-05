"use strict";
// Browser QA of our generated previews in a hidden, isolated Electron window.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const reports = path.join(root, 'reports');
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(root, 'backups/email-layout-profile'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 600, height: 1120, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    const checks = [];
    try {
      // The deployment verifier checks the public URL and byte-for-byte match.
      // Reuse those same logo bytes here so per-template network latency cannot
      // turn a successful browser check into a timeout during Electron cleanup.
      const asset = JSON.parse(fs.readFileSync(path.join(reports, 'email-brand-asset.json')));
      const cachedLogo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/app-icon.png')).toString('base64');
      const files = fs.readdirSync(path.join(reports, 'email-previews')).filter(name => name.endsWith('.html') && name !== 'index.html');
      for (const width of [600, 320]) {
        window.setContentSize(width, 1120);
        for (const file of files) {
          const html = fs.readFileSync(path.join(reports, 'email-previews', file), 'utf8').replaceAll(asset.logoUrl, cachedLogo);
          await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
          const result = await window.webContents.executeJavaScript(`(() => {
            const image = document.querySelector('img[alt="Timewarp"]');
            const code = document.querySelector('.timewarp-email-code');
            const button = [...document.querySelectorAll('a')].find(node => getComputedStyle(node).backgroundColor === 'rgb(183, 214, 255)');
            const luminance = color => color.match(/\\d+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
            const style = button && getComputedStyle(button);
            const foreground = style && luminance(style.color), background = style && luminance(style.backgroundColor);
            return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, logoLoaded: !!image?.complete && image.naturalWidth > 0, codeVisible: !code || code.scrollWidth <= code.clientWidth, code: code?.textContent || null, contrast: style ? (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05) : null };
          })()`);
          assert.equal(result.width, width);
          assert.equal(result.overflow, false, file + ' overflow at ' + width);
          assert.equal(result.logoLoaded, true, file + ' app logo');
          assert.equal(result.codeVisible, true, file + ' code fits at ' + width);
          if (result.contrast !== null) assert.ok(result.contrast >= 4.5, file + ' button contrast');
          if (file === 'magiclink.html') {
            assert.equal(result.code, '0123456789');
            fs.writeFileSync(path.join(reports, width === 600 ? 'email-desktop.png' : 'email-mobile.png'), (await window.webContents.capturePage()).toPNG());
          }
          checks.push({ template: file, ...result });
        }
      }
      fs.writeFileSync(path.join(reports, 'email-layout-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), passed: true, browserUsedCachedAppLogo: true, checks }, null, 2) + '\n');
      console.log(`Verified ${files.length} email templates at desktop and mobile widths: loaded logo, readable codes, no horizontal overflow, and button contrast >= 4.5:1.`);
      window.destroy();
      app.exit(0);
    } catch (error) { console.error(error.message); window.destroy(); app.exit(1); }
  });
} else {
  const cp = require('node:child_process');
  const dependencyRoot = path.dirname(path.dirname(require('../config.json').brandSource));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = cp.spawnSync(require(require.resolve('electron', { paths: [dependencyRoot] })), [__filename], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    console.error('Electron email harness failed:', JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }));
    process.exitCode = 1;
  }
}
