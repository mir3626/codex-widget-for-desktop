import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("widgetShell", {
  hide: () => ipcRenderer.invoke("widget:hide"),
  quit: () => ipcRenderer.invoke("widget:quit"),
  togglePin: () => ipcRenderer.invoke("widget:toggle-pin")
});
