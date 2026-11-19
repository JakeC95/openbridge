import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("modelThumbnail", {
  manifest: () => ipcRenderer.invoke("model-thumbnail:manifest"),
  ready: () => ipcRenderer.send("model-thumbnail:ready"),
  error: (message: string) => ipcRenderer.send("model-thumbnail:error", String(message).slice(0, 1000))
});
