const { app, BrowserWindow, ipcMain, globalShortcut, dialog, Menu, screen, Tray, nativeImage } = require('electron');
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
    autoMonitor: true,
    respawnDelay: 200 // milliseconds delay before returning to live scene
  }
});

let mainWindow;
let tray = null;
let obs = new ObsClient();
let uiohook = null; // optional global keyboard hook

async function createWindow() {
  // Use PNG for window icon (better cross-platform, works in dev and production)
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    autoHideMenuBar: true
  });

  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use ICO for tray icon on Windows (better compatibility with system tray)
  const iconPath = path.join(__dirname, '../../assets/icon.ico');
  tray = new Tray(iconPath);
  
  tray.setToolTip('Rust OBS Scene Toggle');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Double-click tray icon to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // Try to load uiohook-napi for G key hold
  try {
    const mod = require('uiohook-napi');
    uiohook = mod && (mod.uIOhook || mod);
  } catch (_) { uiohook = null; }
  // Remove default menu bar
  try { Menu.setApplicationMenu(null); } catch (_) {}
  
  createTray();
  await createWindow();
  // Open DevTools only in development mode
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (_) {}
  }
  // Wire OBS events to renderer for live feedback
  try {
    obs.obs.on('ConnectionOpened', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'connected' }));
    obs.obs.on('ConnectionClosed', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'disconnected' }));
    obs.obs.on('ConnectionError', (err) => mainWindow && mainWindow.webContents.send('obs:state', { state: 'error', error: String(err && err.message || err) }));
    obs.obs.on('Identified', () => mainWindow && mainWindow.webContents.send('obs:state', { state: 'identified' }));
  } catch (_) {}
});

app.on('window-all-closed', () => {
  // Don't quit when window is closed - keep running in tray
  // Only quit when user explicitly selects Quit from tray menu
});

app.on('before-quit', () => {
  app.isQuitting = true;
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

// IPC: Desktop sources
const { desktopCapturer } = require('electron');
ipcMain.handle('desktop:getSources', async (_e, opts) => {
  try {
    const sources = await desktopCapturer.getSources(opts || { types: ['screen', 'window'] });
    const displays = screen.getAllDisplays();
    
    // Log display info for debugging
    console.log('Displays detected:', displays.map(d => ({
      id: d.id,
      label: d.label,
      size: d.size,
      bounds: d.bounds,
      workArea: d.workArea
    })));
    
    return sources.map((s) => {
      // Try to match source to display
      // Extract display ID from source id (format: "screen:0:0", "screen:1:0", etc.)
      const match = s.id.match(/screen:(\d+):/);
      const displayIndex = match ? parseInt(match[1]) : null;
      const display = displayIndex !== null ? displays[displayIndex] : null;
      
      return {
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
        // Use bounds instead of size to get full screen including taskbar
        width: display ? display.bounds.width : (s.thumbnail ? s.thumbnail.getSize().width : null),
        height: display ? display.bounds.height : (s.thumbnail ? s.thumbnail.getSize().height : null),
        displayName: display ? (display.label || `Display ${displayIndex + 1}`) : s.name
      };
    });
  } catch (err) {
    console.error('desktopCapturer error:', err);
    return [];
  }
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

// Key monitoring in main; renderer requests start/stop
let monitoring = false; let mapOpen = false; let delayInProgress = false;
const isG = (e) => {
  const c = e && (e.keycode ?? e.rawcode ?? e.keyCode ?? e.keychar);
  return c === 34 || c === 71 || c === 103 || c === 0x47;
};

// IPC: Check if uiohook is available
ipcMain.handle('monitor:hasUiohook', async () => {
  return { available: !!uiohook };
});

function startKeyMonitoring() {
  if (!uiohook || monitoring) return;
  monitoring = true;
  const down = (e) => { 
    if (isG(e) && !mapOpen && !delayInProgress) { 
      mapOpen = true; 
      mainWindow.webContents.send('monitor:mapOpen'); 
      mainWindow.webContents.send('monitor:mapOpenSwitch'); 
    } 
  };
  const up = (e) => { 
    if (isG(e) && mapOpen) {
      mapOpen = false;
      if (!delayInProgress) {
        mainWindow.webContents.send('monitor:mapClosed'); 
        mainWindow.webContents.send('monitor:mapClosedSwitch');
      }
      // If delay is in progress, just reset mapOpen flag but don't trigger scene switch
    } 
  };
  uiohook.on('keydown', down); uiohook.on('keyup', up);
  try { uiohook.start(); } catch (_) {}
}
function stopKeyMonitoring() {
  if (!uiohook) return; monitoring = false;
  try { uiohook.removeAllListeners('keydown'); uiohook.removeAllListeners('keyup'); uiohook.stop(); } catch (_) {}
}
ipcMain.on('monitor:start', startKeyMonitoring);
ipcMain.on('monitor:stop', stopKeyMonitoring);

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
  const delay = store.get('respawnDelay') || 200;
  if (cfg && cfg.live) {
    // Set delay flag to block G key during transition
    delayInProgress = true;
    // Delay before returning to live to prevent coordinate leaks
    setTimeout(async () => {
      try { await obs.switchScene(cfg.live); } catch (_) {}
      // Clear delay flag after scene switch completes
      delayInProgress = false;
    }, delay);
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
