"use strict";
// Exercise the packaged browser and the harness launcher against a local page.
// The copied application, browser profile, and actor IDs are disposable; no
// account, model request, existing browser session, or installed app is used.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  (async () => {
    const argument = process.argv.indexOf('--app-dir');
    const appDirectory = argument < 0 ? path.join(root, 'build/native') : path.resolve(process.argv[argument + 1] || '');
    const resources = path.join(appDirectory, process.platform === 'darwin' ? 'Contents/Resources' : 'resources');
    const archive = path.join(resources, 'app.asar');
    assert.ok(fs.existsSync(archive), 'Build the staged app before verifying its browser.');
    fs.mkdirSync(path.join(root, '.temp'), { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, '.temp/browser-verification-'));
    // Snapshot the ASAR so another build cannot replace it during acceptance.
    fs.copyFileSync(archive, path.join(directory, 'app.asar'));
    fs.cpSync(path.join(resources, 'agent-browser'), path.join(directory, 'agent-browser'), { recursive: true });
    const launcher = path.join(resources, 'openai-codex/codex-path', process.platform === 'win32' ? 'browser.exe' : 'browser');
    assert.ok(fs.existsSync(launcher), 'The packaged harness browser launcher is present.');
    const skill = fs.readFileSync(path.join(resources, 'packages/codex-marketplaces/defaults/plugins/energy-defaults/skills/browser-use/SKILL.md'), 'utf8');
    assert.match(skill, /browser \[--profile <id>\] <command>/, 'The browser-use skill is packaged for agents.');
    const launcherDirectory = require('../desktop/harness-path.cjs').prepareHarnessPath(path.join(resources,'openai-codex'),path.join(directory,'harness-home'));
    fs.writeFileSync(path.join(directory,'launcher.json'),JSON.stringify({launcherDirectory}));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const logPath = path.join(directory, 'acceptance.log'), log = fs.openSync(logPath, 'w');
    const child = cp.spawn(require('electron'), [__filename, '--fixture', directory], {
      env, windowsHide: true, stdio: ['ignore', log, log]
    });
    fs.closeSync(log);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') cp.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
    }, 120000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timeout));
    const reportPath = path.join(directory, 'result.json');
    if (timedOut || code !== 0 || !fs.existsSync(reportPath)) {
      process.stderr.write(fs.readFileSync(logPath, 'utf8'));
      throw new Error(timedOut ? 'Native browser acceptance timed out.' : 'Native browser acceptance failed.');
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.passed, true);
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports/browser-native.json'), JSON.stringify({ ...report, checks: { ...report.checks, browserSkillPackaged: true },
      archive, asarSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'app.asar'))).digest('hex') }, null, 2));
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(path.join(root, '.temp')));
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    fs.rmSync(directory, { recursive: true, maxRetries: 5, retryDelay: 200 });
    console.log('Verified packaged browser UI, harness browser command, shared tab state, navigation, interaction, hidden-page access, and profile isolation.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, clipboard, protocol } = require('electron');
  const directory = process.argv[process.argv.indexOf('--fixture') + 1];
  assert.ok(directory && path.dirname(path.resolve(directory)) === path.join(root, '.temp'), 'Acceptance uses its own fixture directory.');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(directory, 'profile'));
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const filename = path.join(directory, 'app.asar/out/main/index.js');
  const source = fs.readFileSync(filename, 'utf8');
  // Load production declarations without calling startApp. Keep the module's
  // ASAR location so its real preload and dependencies resolve normally.
  const Module = require('node:module'), native = new Module(filename, module);
  native.filename = filename; native.paths = Module._nodeModulePaths(path.dirname(filename));
  native._compile(source + '\nmodule.exports.browserAcceptance={UAe,Txe,WSe,FSe,OSe,JSe,KSe,JEe,Gke};', filename);
  const { UAe, Txe, WSe, FSe, OSe, JSe, KSe, JEe, Gke } = native.exports.browserAcceptance;
  const checks = {};
  const pass = (name, value) => { assert.ok(value, name); checks[name] = true; };
  app.whenReady().then(async () => {
    let manager, gateway, server, window;
    const executable = OSe({ isPackaged: true, resourcesPath: directory });
    let code = 0;
    try {
      // The full app owns this protocol in production. Only the native surface
      // host's empty overlay is needed by this isolated browser acceptance.
      protocol.handle('app', () => new Response('<!doctype html><title>Browser overlay fixture</title>'));
      server = require('node:http').createServer((request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>Native browser check</title><h1>Browser ready</h1><input aria-label="Message"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Verify browser</button>');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port;
      const ownerId = crypto.randomUUID(), profileId = crypto.randomUUID();
      const threadId = crypto.randomUUID(), turnId = crypto.randomUUID();
      const trace = new JEe(), telemetry = { capture() {}, captureException(error) { throw error; } };
      manager = new UAe({ getOperational: async id => id === profileId ? { id, source: { type: 'energy' } } : null },
        { browserTabsPath: path.join(directory, 'tabs.json') }, {
          telemetry, traceStore: trace, resolvePersistedBrowserOwnerId: async id => id,
          downloadPath: directory, passwordAutofill: { closeOwner() {}, registerWebContents() {} },
          closeAgentBrowserSession: key => JSe(executable, key)
        });
      await manager.activate({ ownerId, profileId, url });
      const originalTab = manager.runtimes.getState(ownerId).tabs[0];
      pass('nativeBrowserCreatesTab', originalTab?.profileId === profileId);
      window = new BrowserWindow({ width: 900, height: 700, show: false });
      const layout = { pageBounds: { x: 0, y: 75, width: 900, height: 625 }, surfaceBounds: { x: 0, y: 35, width: 900, height: 665 } };
      await manager.show(window, ownerId, layout);
      pass('nativePageAttachedToAppWindow', window.contentView.children.length > 0);
      const runner = Txe(manager, clipboard,
        (argv, cwd, options) => WSe(argv, { cwd, executablePath: executable, ...options }),
        (argv, connection, cwd, options) => FSe(argv, connection.endpoint, {
          cdpIdentity: connection.identity, cwd, executablePath: executable,
          sessionKey: connection.sessionKey, tabId: connection.tabId, ...options
        }), trace, () => {}, async () => ownerId, async () => null);
      gateway = await Gke({ browser: { run: runner } });
      const { launcherDirectory } = JSON.parse(fs.readFileSync(path.join(directory,'launcher.json'),'utf8'));
      const env = { ...process.env, ...gateway.browser.env, PATH: launcherDirectory + path.delimiter + (process.env.PATH || ''), CODEX_THREAD_ID: threadId, CODEX_TURN_ID: turnId };
      pass('launcherUsesPreparedHarnessPath',process.platform!=='win32'||launcherDirectory.startsWith(path.join(directory,'harness-home')+path.sep));
      const command = argv => new Promise((resolve, reject) => {
        const child = cp.spawn(process.platform === 'win32' ? 'browser.exe' : 'browser', argv, {
          cwd: directory, env: { ...env, CODEX_TOOL_CALL_ID: crypto.randomUUID() },
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', reject); child.once('close', exitCode => resolve({ exitCode, stdout: stdout.trim(), stderr }));
      });
      const run = async argv => {
        console.log('Checking browser ' + argv[0]);
        const result = await command(argv);
        assert.equal(result.exitCode, 0, argv.join(' ') + ': ' + result.stderr);
        return result.stdout;
      };
      const unauthorized = await fetch(gateway.browser.env.BROWSER_RUNTIME_URL, { method: 'POST', body: '{}' });
      pass('browserBridgeRequiresAuthentication', unauthorized.status === 401);
      const inventory = JSON.parse(await run(['tab']));
      pass('harnessDiscoversExistingAppTab', inventory.some(tab => tab.id === originalTab.id && tab.profileId === profileId));
      await run(['--profile', profileId, 'tab', originalTab.id]);
      await run(['wait', '--text', 'Browser ready']);
      pass('harnessReadsAppBrowser', (await run(['get', 'title'])) === 'Native browser check');
      const snapshot=await run(['snapshot','-i']);
      pass('harnessSnapshotsPage', snapshot.includes('Verify browser'));
      await run(['fill', 'input', 'Browser works']);
      pass('harnessTypesInPage', (await run(['get', 'value', 'input'])) === 'Browser works');
      if(process.platform==='win32'){
        const ref=snapshot.match(/button "Verify browser" \[ref=(e\d+)\]/)?.[1];assert.ok(ref,'The live browser snapshot supplies the button ref.');
        await new Promise((resolve,reject)=>cp.execFile('powershell.exe',['-NoProfile','-Command',`browser click '@${ref}'`],{cwd:directory,env:{...env,CODEX_TOOL_CALL_ID:crypto.randomUUID()},windowsHide:true},error=>error?reject(error):resolve()));
        pass('powerShellQuotedBrowserRefWorks',true);
      }else await run(['click', 'button']);
      pass('harnessClicksInPage', (await run(['get', 'text', 'h1'])) === 'Clicked');
      const page = manager.runtimes.requireTab(ownerId, originalTab.id).session.getPage(originalTab.id);
      pass('appAndHarnessShareSamePage', await page.webContents.executeJavaScript('document.querySelector("h1").textContent === "Clicked"'));
      await run(['open', url + '/next']);
      await run(['wait', '--text', 'Browser ready']);
      pass('harnessNavigationUpdatesAppTab', manager.runtimes.getState(ownerId).tabs.find(tab => tab.id === originalTab.id).url === url + '/next');
      await run(['back']);
      pass('browserBackWorks', (await run(['get', 'url'])) === url + '/');
      await run(['forward']);
      pass('browserForwardWorks', (await run(['get', 'url'])) === url + '/next');
      await run(['reload']); await run(['wait', '--text', 'Browser ready']);
      pass('browserReloadWorks', (await run(['get', 'title'])) === 'Native browser check');
      manager.hide(ownerId);
      pass('harnessWorksWhileAgentOrFilesVisible', (await run(['get', 'title'])) === 'Native browser check');
      const missing = await command(['--profile', crypto.randomUUID(), 'open', url]);
      pass('unavailableProfileDoesNotFallBack', missing.exitCode !== 0 && manager.runtimes.getState(ownerId).tabs.length === 1);
      await run(['tab', 'release']);
      pass('browserControlReleased', !manager.runtimes.getState(ownerId).tabs[0].activeAgent);
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), passed: true, checks }, null, 2));
    } catch (error) { console.error(error.stack); code = 1; }
    finally {
      await gateway?.stop().catch(() => {});
      await manager?.dispose().catch(error => { console.error(error.message); code = 1; });
      await KSe(executable).catch(() => {});
      window?.destroy(); server?.close(); app.exit(code);
    }
  }).catch(error => { console.error(error.stack); app.exit(1); });
}
