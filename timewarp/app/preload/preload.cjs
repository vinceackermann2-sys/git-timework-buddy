"use strict";
// The only bridge between Timewarp's interface and the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tw", {
  async call(method, input) {
    const reply = await ipcRenderer.invoke("tw:call", method, input);
    if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || "Request failed."), { status: reply?.error?.status });
    return reply.value;
  },
  on(name, callback) {
    const listener = (_event, event, payload) => { if (name === "*" || event === name) callback(payload, event); };
    ipcRenderer.on("tw:event", listener);
    return () => ipcRenderer.removeListener("tw:event", listener);
  },
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
