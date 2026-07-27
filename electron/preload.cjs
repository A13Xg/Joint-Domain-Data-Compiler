const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jointDomainCompiler', {
  platform: process.platform,
  isDesktop: true,
  kmlLibrary: {
    list: () => ipcRenderer.invoke('kml-library:list'),
    save: (name, bytes) => ipcRenderer.invoke('kml-library:save', name, bytes),
    readText: (name) => ipcRenderer.invoke('kml-library:read-text', name),
    remove: (name) => ipcRenderer.invoke('kml-library:remove', name),
    reveal: () => ipcRenderer.invoke('kml-library:reveal'),
  },
})
