"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("timewarp", {
  request: (action, input) => ipcRenderer.invoke("timewarp:request", action, input),
  onExecutionChanged: callback => { const listener=()=>callback();ipcRenderer.on('timewarp:executionChanged',listener);return()=>ipcRenderer.removeListener('timewarp:executionChanged',listener); },
});
