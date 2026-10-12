"use strict";
// A window smaller than the screen shows the maximized layout, scaled down.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { bindWindowZoom, fitFor, MIN_FIT } = require("../app/main/window-zoom.cjs");

// A 4K screen at 150%, less the taskbar.
const WORK_AREA = { x: 0, y: 0, width: 2560, height: 1392 };
function fakeScreen(workArea = WORK_AREA) {
  const screen = new EventEmitter();
  screen.workArea = workArea;
  screen.getDisplayMatching = () => ({ workArea: screen.workArea });
  return screen;
}
function fakeWindow({ width = 1800, height = 1000, frame = { width: 0, height: 0 } } = {}) {
  const window = new EventEmitter();
  Object.assign(window, {
    width, height, frame, maximized: false, fullScreen: false, minimized: false, destroyed: false,
    isMaximized: () => window.maximized, isFullScreen: () => window.fullScreen, isMinimized: () => window.minimized, isDestroyed: () => window.destroyed,
    getBounds: () => ({ x: 0, y: 0, width: window.width, height: window.height }),
    getContentBounds: () => ({ x: 0, y: 0, width: window.width - window.frame.width, height: window.height - window.frame.height }),
    resize(next) { Object.assign(window, next); window.emit("resize"); },
  });
  window.webContents = Object.assign(new EventEmitter(), { zoom: 1, setZoomFactor(value) { this.zoom = value; } });
  return window;
}

test("the fit is the window's share of the screen, the smaller of width and height", () => {
  const screen = fakeScreen();
  assert.equal(fitFor(fakeWindow(), screen), 0.7, "1800 of 2560 wide, 1000 of 1392 high");
  assert.equal(fitFor(fakeWindow({ width: 2200, height: 800 }), screen), 0.57, "a short window fits by its height");
  assert.equal(fitFor(fakeWindow({ width: 2540, height: 1380 }), screen), 1, "nearly the screen's size shows at full size");
  assert.equal(MIN_FIT, 0.5);
  assert.equal(fitFor(fakeWindow({ width: 1200, height: 800 }), screen), MIN_FIT, "0.47 of the screen stops at half size, where text stays readable");
  assert.equal(fitFor(fakeWindow({ width: 1000, height: 1392 }), screen), MIN_FIT);
  const maximized = fakeWindow({ width: 2576, height: 1408 });
  maximized.maximized = true;
  assert.equal(fitFor(maximized, screen), 1);
  const fullScreen = fakeWindow({ width: 900, height: 600 });
  fullScreen.fullScreen = true;
  assert.equal(fitFor(fullScreen, screen), 1);
  // A window frame (Linux) counts as part of a maximized window, not of the app.
  assert.equal(fitFor(fakeWindow({ width: 2560, height: 1392, frame: { width: 0, height: 30 } }), screen), 1);
});

test("the zoom follows the window as it's resized and moves to another screen", () => {
  const screen = fakeScreen(), window = fakeWindow(), fits = [], zooms = [];
  bindWindowZoom(window, { screen, onFit: fit => fits.push(fit), onZoom: factor => zooms.push(factor) });
  // The app's page commits: its zoom is set.
  window.webContents.emit("did-navigate");
  assert.equal(window.webContents.zoom, 0.7);
  window.resize({ width: 2100, height: 1200 });
  assert.equal(window.webContents.zoom, 0.82);
  window.maximized = true;
  window.emit("maximize");
  assert.equal(window.webContents.zoom, 1);
  window.maximized = false;
  window.emit("unmaximize");
  // A bigger screen: the same window is a smaller share of it.
  screen.workArea = { x: 2560, y: 0, width: 3840, height: 2112 };
  screen.emit("display-metrics-changed");
  assert.equal(window.webContents.zoom, 0.55);
  assert.deepEqual(fits, [0.7, 0.82, 1, 0.82, 0.55]);
  assert.deepEqual(zooms, fits);
  // A minimized window keeps its zoom until it's restored.
  window.minimized = true;
  window.resize({ width: 600, height: 500 });
  assert.equal(window.webContents.zoom, 0.55);
  // Once closed, screen changes are no longer followed.
  window.emit("closed");
  assert.equal(screen.listenerCount("display-metrics-changed"), 0);
});

test("Ctrl/⌘ +, - and 0 zoom on top of the fit, in Chromium's steps", () => {
  const window = fakeWindow(), zoom = bindWindowZoom(window, { screen: fakeScreen() });
  window.webContents.emit("did-navigate");
  zoom.step(1);
  assert.equal(window.webContents.zoom.toFixed(3), (0.7 * 1.2 ** 0.5).toFixed(3));
  window.resize({ width: 2100, height: 1200 });
  assert.equal(window.webContents.zoom.toFixed(3), (0.82 * 1.2 ** 0.5).toFixed(3), "The step holds as the window is resized");
  zoom.step(-1); zoom.step(-1);
  assert.equal(window.webContents.zoom.toFixed(3), (0.82 / 1.2 ** 0.5).toFixed(3));
  zoom.step(0);
  assert.equal(window.webContents.zoom, 0.82);
  assert.equal(zoom.fit(), 0.82);
  for (let i = 0; i < 30; i++) zoom.step(1);
  assert.equal(window.webContents.zoom.toFixed(3), (0.82 * 1.2 ** 5).toFixed(3), "Up to five levels");
});
