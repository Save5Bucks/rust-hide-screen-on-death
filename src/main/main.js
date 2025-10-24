const { app, BrowserWindow, ipcMain, globalShortcut, dialog, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { ObsClient } = require('./obsClient');

const store = new Store({
  name: 'config',
  defaults: {
    obs: { host: '127.0.0.1', port: 4455, password: '' },
    scenes: { live: '', map: '', death: '' },
    deathTemplate: null, // {roi:{x,y,w,h}, imageData: base64}
    monitoring: false,
    autoConnect: true,
    autoMonitor: true
  }
});

let mainWindow;
let obs = new ObsClient();
// No native key hook; detection handled in renderer via screen analysis

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    autoHideMenuBar: true
  });

  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Seed OBS connection with user-provided values for debugging
  try {
    store.set('obs', { host: '192.168.1.23', port: 4455, password: '8sJHVsttK8l4iVWL' });
    store.set('autoConnect', true);
    store.set('autoMonitor', true);
  } catch (_) {}
  // Remove default menu bar
  try { Menu.setApplicationMenu(null); } catch (_) {}
  await createWindow();
  try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (_) {}
  // Wire OBS events to renderer for live feedback
  try {
    obs.obs.on('ConnectionOpened', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'connected' }));
    obs.obs.on('ConnectionClosed', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'disconnected' }));
    obs.obs.on('ConnectionError', (err) => mainWindow && mainWindow.webContents.send('obs:state', { state: 'error', error: String(err && err.message || err) }));
    obs.obs.on('Identified', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'identified' }));
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});

// IPC: Config
ipcMain.handle('config:get', async () => store.store);
ipcMain.handle('config:set', async (_e, patch) => {
  store.set(patch || {});
  return store.store;
});
ipcMain.handle('config:path', async () => {
  try { return { path: store.path, ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// IPC: OBS controls
ipcMain.handle('obs:connect', async (_e, { host, port, password }) => {
  let url;
  try {
    const trimmed = String(host || '').trim();
    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      url = `${trimmed}`;
    } else {
      url = `ws://${trimmed}:${port}`;
    }
  } catch (_) {
    url = `ws://${host}:${port}`;
  }
  try {
    mainWindow && mainWindow.webContents.send('obs:state', { state: 'connecting', url });
    const res = await obs.connect(url, password);
    if (res && res.connected) {
      mainWindow && mainWindow.webContents.send('obs:state', { state: 'connected' });
    } else {
      mainWindow && mainWindow.webContents.send('obs:state', { state: 'error', error: res && res.error });
    }
    return res;
  } catch (err) {
    const msg = String(err && err.message || err);
    mainWindow && mainWindow.webContents.send('obs:state', { state: 'error', error: msg });
    return { connected: false, error: msg };
  }
});

ipcMain.handle('obs:disconnect', async () => {
  return obs.disconnect();
});

ipcMain.handle('obs:getScenes', async () => {
  return obs.getScenes();
});

ipcMain.handle('obs:switchScene', async (_e, sceneName) => {
  return obs.switchScene(sceneName);
});

// No key monitoring in main; renderer requests scene changes via IPC

// Renderer signals that a death event has been detected
ipcMain.on('monitor:deathDetected', async () => {
  const cfg = store.get('scenes');
  if (cfg && cfg.death) {
    try { await obs.switchScene(cfg.death); } catch (_) {}
  }
});

// Renderer signals map open/close to switch scenes
ipcMain.on('monitor:mapOpenSwitch', async () => {
  const cfg = store.get('scenes');
  if (cfg && cfg.map) {
    try { await obs.switchScene(cfg.map); } catch (_) {}
  }
});
ipcMain.on('monitor:mapClosedSwitch', async () => {
  const cfg = store.get('scenes');
  if (cfg && cfg.live) {
    try { await obs.switchScene(cfg.live); } catch (_) {}
  }
});

// Save log to file
const fs = require('fs');
ipcMain.handle('log:save', async (_e, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Log', defaultPath: 'rust-obs-log.txt', filters: [{ name: 'Text', extensions: ['txt'] }]
  });
  if (canceled || !filePath) return { ok: false };
  await fs.promises.writeFile(filePath, String(content || ''), 'utf8');
  return { ok: true, filePath };
});
