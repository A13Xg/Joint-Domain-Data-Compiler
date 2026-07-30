const { contextBridge, ipcRenderer } = require('electron')
const { IPC_CHANNELS } = require('./security.cjs')

contextBridge.exposeInMainWorld('jointDomainCompiler', {
  platform: process.platform,
  isDesktop: true,
  kmlLibrary: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.list),
    save: (name, bytes) => ipcRenderer.invoke(IPC_CHANNELS.save, name, bytes),
    readText: (name) => ipcRenderer.invoke(IPC_CHANNELS.readText, name),
    remove: (name) => ipcRenderer.invoke(IPC_CHANNELS.remove, name),
    reseed: () => ipcRenderer.invoke(IPC_CHANNELS.reseed),
    reveal: () => ipcRenderer.invoke(IPC_CHANNELS.reveal),
  },
  diagnostics: {
    save: (text) => ipcRenderer.invoke(IPC_CHANNELS.saveDiagnostics, text),
  },
})
