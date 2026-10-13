"use strict";
// A window smaller than the screen shows the app as it looks maximized, scaled
// down to fit: the page zoom is the window's share of the screen's work area
// (the smaller of its width and height share), so the layout stays the
// maximized one. It stops at half size (MIN_FIT), where text is still
// readable; a smaller window narrows the layout from there, as before.
// Ctrl/⌘ +, - and 0 zoom on top of it in Chromium's steps (a level is a
// factor of 1.2).
const MIN_FIT = 0.5;
// A window this close to the screen's size shows at full size, not blurred a little.
const SNAP = 0.98;
const LEVELS = { min: -5, max: 5 };

function fitFor(window, screen) {
  if (window.isFullScreen() || window.isMaximized()) return 1;
  const outer = window.getBounds(), inner = window.getContentBounds();
  const area = screen.getDisplayMatching(outer).workArea;
  // What the app gets in a maximized window: the work area less the window's frame.
  const width = area.width - (outer.width - inner.width), height = area.height - (outer.height - inner.height);
  if (!(width > 0 && height > 0 && inner.width > 0 && inner.height > 0)) return 1;
  const share = Math.min(inner.width / width, inner.height / height);
  return share >= SNAP ? 1 : Math.max(MIN_FIT, Math.round(share * 100) / 100);
}

const factorOf = (fit, level) => Math.min(5, Math.max(0.25, fit * 1.2 ** level));

// Keeps a window's zoom fitted while it's resized, moved to another screen or
// a screen changes. onFit hears the fit alone (pages in the pane follow it),
// onZoom the window's zoom (the interface's sizes kept to the window's own buttons).
function bindWindowZoom(window, { screen, onFit = () => {}, onZoom = () => {} }) {
  let level = 0, fit = null, applied = 0;
  function update(force = false) {
    if (window.isDestroyed() || window.isMinimized()) return;
    const next = fitFor(window, screen);
    if (next !== fit) { fit = next; onFit(fit); }
    const factor = factorOf(fit, level);
    if (!force && Math.abs(factor - applied) < 0.001) return;
    applied = factor;
    window.webContents.setZoomFactor(factor);
    onZoom(factor);
  }
  const changed = () => update();
  for (const name of ["resize", "maximize", "unmaximize", "restore", "enter-full-screen", "leave-full-screen", "moved"]) window.on(name, changed);
  const screens = ["display-metrics-changed", "display-added", "display-removed"];
  for (const name of screens) screen.on(name, changed);
  window.once("closed", () => { for (const name of screens) screen.removeListener(name, changed); });
  // A page's zoom is Chromium's for its site, set again as each page commits.
  window.webContents.on("did-navigate", () => update(true));
  return {
    fit: () => fit ?? 1,
    // 1 zooms in, -1 out, 0 back to the fitted size.
    step(direction) {
      level = direction ? Math.min(LEVELS.max, Math.max(LEVELS.min, level + direction * 0.5)) : 0;
      update(true);
    },
  };
}

module.exports = { bindWindowZoom, fitFor, MIN_FIT };
