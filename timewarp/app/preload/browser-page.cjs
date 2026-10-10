"use strict";
// Runs before every page in the built-in browser, sandboxed and apart from the
// page's own scripts. A page's alert, confirm and prompt go to Timewarp
// (browser.cjs), which asks the user or lets the agent answer, so a dialog
// never freezes a page the agent works in. It also says when the page is
// first edited, so a tab with input not yet sent isn't put to sleep.
const { contextBridge, ipcRenderer } = require("electron");

const DIALOG = "timewarp-browser:dialog", EDITED = "timewarp-browser:edited";
// The page waits for the answer, as it does for a browser's own dialog.
const ask = (type, message, value) => {
  try { return ipcRenderer.sendSync(DIALOG, { type, message: String(message), value: String(value) }); } catch { return null; }
};
try {
  contextBridge.executeInMainWorld({
    func: ask => {
      const text = value => value === undefined ? "" : String(value);
      const replace = (name, run) => Object.defineProperty(window, name, { value: { [name]: (...args) => run(...args) }[name], writable: true, configurable: true, enumerable: true });
      replace("alert", message => { ask("alert", text(message), ""); });
      replace("confirm", message => ask("confirm", text(message), "") === true);
      replace("prompt", (message, value) => { const answer = ask("prompt", text(message), text(value)); return typeof answer === "string" ? answer : null; });
    },
    args: [ask],
  });
} catch {}

let edited = false;
const onEdit = event => { if (event.isTrusted && !edited) { edited = true; ipcRenderer.send(EDITED); } };
for (const type of ["input", "change", "drop"]) addEventListener(type, onEdit, true);
