const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getConfigPath: () => ipcRenderer.invoke('config:path'),

  // OBS
  connectOBS: (opts) => ipcRenderer.invoke('obs:connect', opts),
  disconnectOBS: () => ipcRenderer.invoke('obs:disconnect'),
  getScenes: () => ipcRenderer.invoke('obs:getScenes'),
  switchScene: (sceneName) => ipcRenderer.invoke('obs:switchScene', sceneName),
  onObsState: (cb) => ipcRenderer.on('obs:state', (_e, data) => cb(data)),

  // Scene toggles from renderer detection
  notifyDeathDetected: () => ipcRenderer.send('monitor:deathDetected'),
  switchOnMapOpen: () => ipcRenderer.send('monitor:mapOpenSwitch'),
  switchOnMapClosed: () => ipcRenderer.send('monitor:mapClosedSwitch'),
  saveLog: (content) => ipcRenderer.invoke('log:save', content)
});

// Desktop capture helper (fallback when getDisplayMedia is denied)
contextBridge.exposeInMainWorld('desktop', {
  getSources: (opts) => desktopCapturer.getSources(opts || { types: ['screen', 'window'] })
});
