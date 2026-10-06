"use strict";
const { validateRelease } = require('../shared/release.cjs');
function configureUpdates({ app, autoUpdater, release, readUpdateConfig, notify, logger = console, interval = setInterval, clear = clearInterval }) {
  const disable = () => {
    autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.checkForUpdates = async () => null;
    autoUpdater.checkForUpdatesAndNotify = async () => null;
    return { enabled: false };
  };
  let settings;
  try {
    settings = validateRelease(release || { enabled: false });
    if (!settings.enabled || !app.isPackaged || process.platform !== 'win32') return disable();
    const feed = readUpdateConfig();
    if (feed.provider !== 'generic' || feed.url !== settings.updateUrl || feed.channel !== 'latest' || JSON.stringify(feed.publisherName) !== JSON.stringify(settings.publisherNames) || app.getVersion() !== settings.version) throw new Error('Packaged update configuration does not match this release.');
  } catch { logger.error('[timewarp] Release update configuration is invalid; updates are disabled.'); return disable(); }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false; autoUpdater.allowPrerelease = false;
  // The inherited verifier skips validation when PowerShell is unavailable.
  autoUpdater.verifyUpdateCodeSignature = (_publishers,file) => require('../shared/authenticode.cjs').verifyInstaller(file,settings.publisherNames);
  autoUpdater.on('error', () => logger.error('[timewarp] Update check or signature verification failed.'));
  autoUpdater.on('update-downloaded', () => notify(() => autoUpdater.quitAndInstall(false, true)));
  // The existing desktop also calls checkForUpdates; share the in-flight check.
  const original = autoUpdater.checkForUpdates.bind(autoUpdater);
  let pending = null;
  autoUpdater.checkForUpdates = () => pending || (pending = Promise.resolve().then(original).catch(() => null).finally(() => { pending = null; }));
  const timer = interval(() => { void autoUpdater.checkForUpdates(); }, 6 * 60 * 60 * 1000);
  timer.unref?.(); app.once('will-quit', () => clear(timer));
  void app.whenReady().then(() => autoUpdater.checkForUpdates());
  return { enabled: true };
}
module.exports = { configureUpdates };
