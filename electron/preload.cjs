const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('jointDomainCompiler', {
  platform: process.platform,
  isDesktop: true,
})
