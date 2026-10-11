"use strict";
// Timewarp's updates, and the state Settings → General and the sidebar's
// Update button show. Kinds:
//   auto   signed Windows installer builds (release.json's feed, Authenticode
//          checked) and signed Mac builds (macUpdates, GitHub's latest release)
//   store  the Microsoft Store app; the Store installs its updates
//   none   development, preview and unsigned builds
const { validateRelease, validateMacFeed } = require('../shared/release.cjs');
// Timewarp's Microsoft Store page (storeId in store.json).
const STORE_PAGE = 'ms-windows-store://pdp/?ProductId=9N6WRN6GN0KR';
const slash = url => String(url || '').replace(/\/?$/, '/');
function configureUpdates({ app, autoUpdater, release, macUpdates, readUpdateConfig, notify, confirm = install => { install(); return true; }, openExternal = null, onChange = () => {},
  logger = console, interval = setInterval, clear = clearInterval, ready = () => app.whenReady(), platform = process.platform, windowsStore = process.windowsStore === true }) {
  let state = { kind: 'none', status: 'idle', version: app.getVersion(), available: null, progress: 0 };
  const snapshot = () => ({ ...state });
  const set = patch => {
    if (Object.keys(patch).every(key => state[key] === patch[key])) return;
    state = { ...state, ...patch };
    onChange(snapshot());
  };
  const disable = kind => {
    state.kind = kind;
    // The previous desktop calls checkForUpdates itself; those calls do nothing.
    if (autoUpdater && typeof autoUpdater === 'object') {
      autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.checkForUpdates = async () => null;
      autoUpdater.checkForUpdatesAndNotify = async () => null;
    }
    return {
      enabled: false, state: snapshot,
      // Check for updates opens Timewarp's page in the Store.
      check: async () => { if (kind === 'store') await openExternal?.(STORE_PAGE); return snapshot(); },
      install: async () => false,
    };
  };
  // A Store app never updates itself.
  if (windowsStore && app.isPackaged) return disable('store');
  let settings;
  try {
    // Windows: the signed installer's feed and publishers; macOS: the signed
    // build's feed. Either must match the app-update.yml packaged with the app.
    settings = platform === 'darwin' ? validateMacFeed(macUpdates || { enabled: false }) : validateRelease(release || { enabled: false });
    if (!settings.enabled || !app.isPackaged || !['win32', 'darwin'].includes(platform)) return disable('none');
    const feed = readUpdateConfig();
    const matches = platform === 'darwin' ? feed.provider === 'generic' && slash(feed.url) === settings.updateUrl
      : feed.provider === 'generic' && feed.url === settings.updateUrl && feed.channel === 'latest' && JSON.stringify(feed.publisherName) === JSON.stringify(settings.publisherNames);
    if (!matches || app.getVersion() !== settings.version) throw new Error('Packaged update configuration does not match this release.');
  } catch { logger.error('[timewarp] Release update configuration is invalid; updates are disabled.'); return disable('none'); }
  state.kind = 'auto';
  let updater = null, pending = null, installing = false;
  const installNow = () => { installing = true; updater.quitAndInstall(false, true); };
  // Set up at the first check, so builds without updates never load electron-updater.
  const setup = () => {
    if (updater) return updater;
    updater = typeof autoUpdater === 'function' ? autoUpdater() : autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false; updater.allowPrerelease = false;
    // The inherited verifier skips validation when PowerShell is unavailable.
    if (platform === 'win32') updater.verifyUpdateCodeSignature = (_publishers,file) => require('../shared/authenticode.cjs').verifyInstaller(file,settings.publisherNames);
    // GitHub's latest release doesn't have the previous release's block maps,
    // so a Mac downloads the whole update. Squirrel.Mac checks its signature.
    else updater.disableDifferentialDownload = true;
    // A downloaded update stays ready; later checks don't change what's shown.
    const on = (event, patch) => updater.on(event, value => { if (state.status !== 'ready') set(patch(value)); });
    on('checking-for-update', () => ({ status: 'checking' }));
    on('update-available', info => ({ status: 'downloading', available: info?.version || null, progress: 0 }));
    on('download-progress', progress => ({ status: 'downloading', progress: Math.max(0, Math.min(99, Math.floor(Number(progress?.percent) || 0))) }));
    on('update-not-available', () => ({ status: 'upToDate', available: null, progress: 0 }));
    updater.on('error', () => {
      logger.error('[timewarp] Update check or signature verification failed.');
      if (state.status !== 'ready' || installing) { installing = false; set({ status: 'error' }); }
    });
    updater.on('update-downloaded', info => { set({ status: 'ready', available: info?.version || state.available, progress: 100 }); notify(installNow); });
    // The existing desktop also calls checkForUpdates; share the in-flight check.
    const original = updater.checkForUpdates.bind(updater);
    updater.checkForUpdates = () => pending || (pending = Promise.resolve().then(original).catch(() => null).finally(() => { pending = null; }));
    return updater;
  };
  if (typeof autoUpdater !== 'function') setup();
  const check = () => setup().checkForUpdates();
  const timer = interval(() => { void check(); }, 6 * 60 * 60 * 1000);
  timer.unref?.(); app.once('will-quit', () => clear(timer));
  void Promise.resolve().then(ready).then(check).catch(() => {});
  return {
    enabled: true, state: snapshot,
    check: async () => { if (state.status !== 'ready') await check(); return snapshot(); },
    // Restarting asks first (confirm); nothing happens until an update is ready.
    install: async () => state.status === 'ready' && !!(await confirm(installNow)),
  };
}
module.exports = { configureUpdates, STORE_PAGE };
