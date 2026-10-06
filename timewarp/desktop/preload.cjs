"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("timewarp", {
  request: (action, input) => ipcRenderer.invoke("timewarp:request", action, input),
});
