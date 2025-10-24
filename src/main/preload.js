const { contextBridge, ipcRenderer } = require('electron');

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

// Desktop capture helper (using IPC instead of direct desktopCapturer)
contextBridge.exposeInMainWorld('desktop', {
  getSources: (opts) => ipcRenderer.invoke('desktop:getSources', opts || { types: ['screen', 'window'] })
});

// Optional monitoring start/stop (for key hooks in main if enabled)
contextBridge.exposeInMainWorld('monitor', {
  start: () => ipcRenderer.send('monitor:start'),
  stop: () => ipcRenderer.send('monitor:stop'),
  hasUiohook: () => ipcRenderer.invoke('monitor:hasUiohook'),
  onMapOpen: (cb) => ipcRenderer.on('monitor:mapOpen', () => cb()),
  onMapClosed: (cb) => ipcRenderer.on('monitor:mapClosed', () => cb())
});
