"use strict";
// The only bridge between Timewarp's interface and the main process.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// One IPC listener serves every subscriber (the chat, its cards and panels
// each subscribe), instead of one listener each.
const subscribers = new Set();
ipcRenderer.on("tw:event", (_event, name, payload) => {
  for (const subscriber of [...subscribers]) {
    if (subscriber.name !== "*" && subscriber.name !== name) continue;
    try { subscriber.callback(payload, name); } catch (error) { console.error(error); }
  }
});

contextBridge.exposeInMainWorld("tw", {
  async call(method, input) {
    const reply = await ipcRenderer.invoke("tw:call", method, input);
    if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || "Request failed."), { status: reply?.error?.status });
    return reply.value;
  },
  on(name, callback) {
    const subscriber = { name, callback };
    subscribers.add(subscriber);
    return () => { subscribers.delete(subscriber); };
  },
  // The file a dropped or pasted file came from ("" for a pasted image).
  getPathForFile: file => { try { return webUtils.getPathForFile(file) || ""; } catch { return ""; } },
  platform: process.platform,
});

// Contract of Timewarp's account, organization, billing and onboarding screens.
contextBridge.exposeInMainWorld("timewarp", {
  request: (action, input) => ipcRenderer.invoke("timewarp:request", action, input),
  onExecutionChanged(callback) {
    const listener = () => callback();
    ipcRenderer.on("timewarp:executionChanged", listener);
    return () => ipcRenderer.removeListener("timewarp:executionChanged", listener);
  },
});
