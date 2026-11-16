/**
 * Bridge between the web app and the desktop shell. Only what the overlay controls need is exposed;
 * pages get no direct access to Node or Electron.
 */
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("atiDesktop", {
  overlay: {
    toggle: () => ipcRenderer.send("overlay:toggle"),
    close: () => ipcRenderer.send("overlay:close"),
    setLocked: (locked) => ipcRenderer.send("overlay:lock", Boolean(locked)),
    isOpen: () => ipcRenderer.invoke("overlay:is-open"),
    onOpenChange: (callback) => subscribe("overlay:open", callback),
    onLockChange: (callback) => subscribe("overlay:locked", callback),
  },
});
