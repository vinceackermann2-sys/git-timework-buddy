"use strict";
// A local, network-free extension lets the source browser read cookies that
// its OS encryption intentionally prevents another application from reading.
const fs = require("node:fs");
const path = require("node:path");
const { readCookieExport } = require("./browser-cookies.cjs");

function writeHelper(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Timewarp cookie import", version: "1.0.0",
    description: "Export your cookies locally for import into Timewarp. No data is sent over the network.",
    permissions: ["cookies", "downloads"], host_permissions: ["<all_urls>"],
    action: { default_popup: "popup.html" },
  }, null, 2));
  fs.writeFileSync(path.join(directory, "popup.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Timewarp cookie import</title><body style="font:14px system-ui;width:300px;padding:20px"><h2>Import into Timewarp</h2><p>Export this browser profile’s cookies and signed-in sessions to a local file, then choose that file in Timewarp.</p><button id="export" type="button">Export cookies</button><p id="status" role="status"></p><p>You can remove this extension and delete the export after importing.</p><script src="popup.js"></script></body></html>`);
  fs.writeFileSync(path.join(directory, "popup.js"), `"use strict";
document.getElementById("export").addEventListener("click", async () => {
  const button = document.getElementById("export"), status = document.getElementById("status");
  button.disabled = true;
  try {
    const cookies = await chrome.cookies.getAll({});
    const url = URL.createObjectURL(new Blob([JSON.stringify({ cookies })], { type: "application/json" }));
    try { await chrome.downloads.download({ url, filename: "timewarp-cookies.json", saveAs: true }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
    status.textContent = "Choose timewarp-cookies.json in Timewarp to finish importing.";
  } catch { status.textContent = "Cookies could not be exported. Try again from the browser profile you want to import."; }
  finally { button.disabled = false; }
});
`);
  fs.writeFileSync(path.join(directory, "IMPORT.txt"), "In the browser profile you selected in Timewarp:\n1. Open chrome://extensions (edge://extensions for Edge).\n2. Enable Developer mode, click Load unpacked and select this folder.\n3. Open Timewarp cookie import from the browser's Extensions menu and click Export cookies.\n4. Choose timewarp-cookies.json in Timewarp's file picker.\nYou can remove the extension and delete the exported JSON after importing.\n");
  return directory;
}

function createBrowserImportHelper({ profile, dialog, shell }) {
  return async source => {
    const directory = writeHelper(path.join(profile, "browser-import-helper"));
    const result = await dialog.showMessageBox({
      type: "info", title: "Import signed-in sessions", message: `${source.browser} needs to export its protected cookies.`,
      detail: `Use ${source.label} in ${source.browser}:\n\n1. Open ${source.source.browserId === "edge" ? "edge" : "chrome"}://extensions and enable Developer mode.\n2. Click Load unpacked and select the helper folder that opens next.\n3. Open “Timewarp cookie import” from Extensions and click Export cookies.\n4. Choose timewarp-cookies.json in Timewarp’s file picker.\n\nThe helper works entirely on this device. You can remove it and delete the export afterwards.`,
      buttons: ["Open helper folder", "Cancel"], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (result.response !== 0) return null;
    const error = await shell.openPath(directory);
    if (error) throw new Error("The browser import helper folder could not be opened.");
    const selected = await dialog.showOpenDialog({ title: "Choose timewarp-cookies.json exported by the browser helper", properties: ["openFile"], filters: [{ name: "Browser cookies", extensions: ["json"] }] });
    return selected.canceled || !selected.filePaths[0] ? null : readCookieExport(selected.filePaths[0]);
  };
}

module.exports = { createBrowserImportHelper, writeHelper };
