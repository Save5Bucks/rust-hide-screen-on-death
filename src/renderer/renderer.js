if (!window.__rendererLoaded) { window.__rendererLoaded = true;

const $ = (id) => document.getElementById(id);

// Graceful fallback if preload failed
const api = window.api || {
  getConfig: async () => JSON.parse(localStorage.getItem('fallbackConfig') || '{}'),
  setConfig: async (patch) => {
    const cur = JSON.parse(localStorage.getItem('fallbackConfig') || '{}');
    const next = { ...cur, ...patch };
    localStorage.setItem('fallbackConfig', JSON.stringify(next));
    return next;
  },
  connectOBS: async () => ({ connected: false, error: 'preload-missing' }),
  disconnectOBS: async () => ({}),
  getScenes: async () => ({ scenes: [] }),
  switchScene: async () => ({}),
  onObsState: () => {},
  startMonitoring: () => {},
  stopMonitoring: () => {},
  onMapOpen: () => {},
  onMapClosed: () => {},
  onIoHookMissing: () => {},
  notifyDeathDetected: () => {},
  switchOnMapOpen: () => {},
  switchOnMapClosed: () => {}
};

let cfg = null;
let scenes = [];
let roi = null; // {x,y,w,h}
let monitoring = false;
let detecting = false;
let detectTimer = null;
// isConnected tracks OBS connection state
let isConnected = false;

const hostEl = $('host');
const portEl = $('port');
const passEl = $('password');
const obsStatusEl = $('obsStatus');
const monStatusEl = $('monStatus');
const roiStatusEl = $('roiStatus');
const deathDetectStatusEl = $('deathDetectStatus');
const iohookStatusEl = $('iohookStatus');
const mapDetectStatusEl = document.getElementById('mapDetectStatus');

const sceneLiveEl = $('sceneLive');
const sceneMapEl = $('sceneMap');
const sceneDeathEl = $('sceneDeath');

const videoEl = $('screenVideo');
const canvasEl = $('preview');
const ctx = canvasEl.getContext('2d');

// Simple logger to on-page panel (falls back to console)
const logEl = document.getElementById('log');
function log(msg) {
  try {
    const t = new Date().toLocaleTimeString();
    if (logEl) {
      logEl.textContent += `[${t}] ${msg}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      console.log(msg);
    }
  } catch (_) { console.log(msg); }
}

function populateScenes(list) {
  const els = [sceneLiveEl, sceneMapEl, sceneDeathEl];
  els.forEach(el => { el.innerHTML = ''; });
  list.forEach(name => {
    els.forEach(el => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name; el.appendChild(opt);
    });
  });
  const s = cfg.scenes || {};
  sceneLiveEl.value = s.live || '';
  sceneMapEl.value = s.map || '';
  sceneDeathEl.value = s.death || '';
}

async function loadConfig() {
  cfg = await api.getConfig() || {};
  const obs = cfg.obs || {};
  hostEl.value = obs.host || '127.0.0.1';
  portEl.value = (obs.port ?? 4455);
  passEl.value = obs.password || '';
  const deathTemplate = cfg.deathTemplate || null;
  roi = deathTemplate && deathTemplate.roi ? deathTemplate.roi : null;
  roiStatusEl.textContent = roi ? `x:${roi.x}, y:${roi.y}, w:${roi.w}, h:${roi.h}` : 'No ROI set';
}

async function saveConfigPartial(patch) {
  cfg = await api.setConfig(patch);
}

// duplicate declaration removed; keep single global isConnected
async function connectOBS() {
  if (isConnected) {
    log('Disconnecting from OBS');
    await api.disconnectOBS();
    isConnected = false;
    setBadge(obsStatusEl, 'Disconnected', 'secondary');
    updateConnectButton();
    return;
  }
  setBadge(obsStatusEl, 'Connecting', 'warning');
  try {
    const res = await api.connectOBS({ host: hostEl.value, port: Number(portEl.value), password: passEl.value });
    if (res && res.connected) {
      isConnected = true;
      setBadge(obsStatusEl, 'Connected', 'success');
      log('Connected to OBS');
      updateConnectButton();
      await refreshScenes();
      await saveConfigPartial({ obs: { host: hostEl.value, port: Number(portEl.value), password: passEl.value } });
      if (cfg && (cfg.autoMonitor ?? true)) {
        doStartMonitoring();
      }
    } else {
      const msg = res && res.error ? String(res.error) : 'Unknown error';
      log('OBS connect failed: ' + msg);
      setBadge(obsStatusEl, 'Failed', 'danger');
    }
  } catch (err) {
    log('OBS connect exception: ' + (err && err.message ? err.message : String(err)));
    setBadge(obsStatusEl, 'Failed', 'danger');
  }
}

async function disconnectOBS() {
  await api.disconnectOBS();
  setBadge(obsStatusEl, 'Disconnected', 'secondary');
}

async function refreshScenes() {
  const res = await api.getScenes();
  scenes = res.scenes || [];
  populateScenes(scenes);
  if (res && res.error) log('GetScenes error: ' + res.error);
  log(`Loaded ${scenes.length} scenes`);
}

function updateSceneSelection() {
  saveConfigPartial({ scenes: { live: sceneLiveEl.value, map: sceneMapEl.value, death: sceneDeathEl.value } });
}

sceneLiveEl.addEventListener('change', updateSceneSelection);
sceneMapEl.addEventListener('change', updateSceneSelection);
sceneDeathEl.addEventListener('change', updateSceneSelection);

const connectBtn = $('connect');
const refreshBtn = $('refreshScenes');
const clearLogBtn = $('clearLog');
const pickScreenBtn = $('pickScreen');
connectBtn && connectBtn.addEventListener('click', () => { log((isConnected?'Disconnect':'Connect') + ' button pressed'); connectOBS(); });
refreshBtn && refreshBtn.addEventListener('click', () => { log('Refresh scenes'); refreshScenes(); });
clearLogBtn && clearLogBtn.addEventListener('click', () => { if (logEl) logEl.textContent = ''; });
pickScreenBtn && pickScreenBtn.addEventListener('click', async () => {
  try {
    if (!window.desktop || !window.desktop.getSources) { log('desktopCapturer not available'); return; }
    const sources = await window.desktop.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 225 } });
    if (!sources || !sources.length) { log('No sources returned'); return; }
    // Prefer entire screens first
    const screen = sources.find(s => s.id && s.name && s.name.toLowerCase().includes('screen')) || sources[0];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screen.id,
          maxWidth: 8000, maxHeight: 8000, maxFrameRate: 30
        }
      }
    }).catch(e => { log('getUserMedia(screen) error: ' + e.message); return null; });
    if (stream) {
      mediaStream = stream; videoEl.srcObject = mediaStream; detecting = true;
      if (thumbTimer) { clearInterval(thumbTimer); thumbTimer = null; }
      if (detectTimer) clearInterval(detectTimer);
      detectTimer = setInterval(processFrame, 500);
      log('Using selected source: ' + (screen.name || screen.id));
      setBadge(deathDetectStatusEl, roi ? 'Armed' : 'No ROI', roi ? 'warning' : 'secondary');
    } else {
      log('Could not start stream from selected source');
    }
  } catch (e) { log('pickScreen error: ' + (e && e.message ? e.message : String(e))); }
});

// Listen to OBS state events from main for immediate feedback
api.onObsState((data) => {
  if (!data) return;
  if (data.state === 'connecting') setBadge(obsStatusEl, 'Connecting', 'warning');
  else if (data.state === 'connected' || data.state === 'identified') { setBadge(obsStatusEl, 'Connected', 'success'); isConnected = true; updateConnectButton(); }
  else if (data.state === 'disconnected') { setBadge(obsStatusEl, 'Disconnected', 'secondary'); isConnected = false; updateConnectButton(); }
  else if (data.state === 'error') {
    log('OBS state error: ' + data.error);
    setBadge(obsStatusEl, 'Failed', 'danger');
  }
});

// Debug: show first few global keycodes to identify 'G'
let keyLogCount = 0;
if (window.monitor && window.monitor.onKeyEvent) {
  window.monitor.onKeyEvent((e) => {
    if (keyLogCount < 20) {
      log(`key ${e.type}: code=${e.code}`);
      keyLogCount++;
    }
  });
}

// Monitoring logic
function doStartMonitoring() {
  if (monitoring) return;
  monitoring = true; setBadge(monStatusEl, 'Monitoring', 'success');
  api.startMonitoring();
  startScreenCapture();
  // persist monitoring state
  saveConfigPartial({ monitoring: true });
}
function doStopMonitoring() {
  if (!monitoring) return;
  monitoring = false; setBadge(monStatusEl, 'Stopped', 'secondary');
  api.stopMonitoring();
  stopScreenCapture();
  saveConfigPartial({ monitoring: false });
}

$('startMonitoring').addEventListener('click', doStartMonitoring);
$('stopMonitoring').addEventListener('click', doStopMonitoring);

// No native hook now; show N/A
if (iohookStatusEl) setBadge(iohookStatusEl, 'N/A', 'secondary');

// Screen capture and death detection via ROI diff
let mediaStream = null;
let roiTemplate = null; // ImageData for death ROI
let thumbTimer = null; // desktopCapturer thumbnail polling
let processingThumb = false;
let mapRoi = null; let mapTemplate = null; let mapDetected = false;

async function startScreenCapture() {
  setBadge(deathDetectStatusEl, roi ? 'Armed' : 'No ROI', roi ? 'warning' : 'secondary');
  // Try standard getDisplayMedia first
  let stream = null;
  try {
    stream = await window.navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    log('getDisplayMedia error: ' + (e && e.message ? e.message : String(e)));
  }
  if (!stream && window.desktop && window.desktop.getSources) {
    // Try legacy getUserMedia desktop source
    try {
      const sources = await window.desktop.getSources({ types: ['screen'] });
      const screen = sources && sources[0];
      if (screen) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: screen.id,
                maxWidth: 8000, maxHeight: 8000, maxFrameRate: 30
              }
            }
          });
        } catch (e2) {
          log('desktop getUserMedia fallback error: ' + (e2 && e2.message ? e2.message : String(e2)));
        }
      }
    } catch (e) { log('desktopCapturer error: ' + (e && e.message ? e.message : String(e))); }
  }
  if (stream) {
    mediaStream = stream;
    videoEl.srcObject = mediaStream;
    detecting = true;
    if (thumbTimer) { clearInterval(thumbTimer); thumbTimer = null; }
    detectTimer = setInterval(processFrame, 500);
    log('Screen capture: using getDisplayMedia/userMedia stream');
    return;
  }

  // Final fallback: Poll desktopCapturer thumbnails (no permissions prompt)
  if (window.desktop && window.desktop.getSources) {
    setBadge(deathDetectStatusEl, 'Fallback capture', 'warning');
    detecting = true;
    log('Screen capture: using desktopCapturer thumbnail polling');
    thumbTimer = setInterval(processThumbnail, 700);
    return;
  }

  setBadge(deathDetectStatusEl, 'Permission denied', 'danger');
}

function stopScreenCapture() {
  detecting = false;
  if (detectTimer) clearInterval(detectTimer);
  if (thumbTimer) clearInterval(thumbTimer);
  processingThumb = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  setBadge(deathDetectStatusEl, 'Off', 'secondary');
}

async function processFrame() {
  if (!detecting || !roi) return;
  const vw = videoEl.videoWidth; const vh = videoEl.videoHeight;
  if (!vw || !vh) return;
  canvasEl.width = Math.floor(vw / 4);
  canvasEl.height = Math.floor(vh / 4);
  const scaleX = canvasEl.width / vw;
  const scaleY = canvasEl.height / vh;
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

  const rx = Math.floor(roi.x * scaleX);
  const ry = Math.floor(roi.y * scaleY);
  const rw = Math.max(1, Math.floor(roi.w * scaleX));
  const rh = Math.max(1, Math.floor(roi.h * scaleY));

  const img = ctx.getImageData(rx, ry, rw, rh);
  if (!roiTemplate) {
    // Initialize template from first frame after arming
    roiTemplate = img;
    return;
  }

  const diff = meanAbsDiff(img.data, roiTemplate.data);
  // On death screen, ROI should closely match template (if template was captured on death)
  const threshold = 10; // tuneable 0..255
  if (diff < threshold) {
    setBadge(deathDetectStatusEl, 'DEATH MATCH', 'danger');
    api.notifyDeathDetected();
  } else {
    setBadge(deathDetectStatusEl, 'Scanning', 'secondary');
  }
}

function meanAbsDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0; let count = 0;
  for (let i = 0; i < n; i += 4) { // RGBA
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i+1] - b[i+1]);
    const db = Math.abs(a[i+2] - b[i+2]);
    sum += (dr + dg + db) / 3; count++;
  }
  return count ? (sum / count) : 255;
}

async function processThumbnail() {
  if (!detecting || processingThumb || !window.desktop || !window.desktop.getSources) return;
  processingThumb = true;
  try {
    const sources = await window.desktop.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    const screen = sources && sources[0];
    if (!screen || !screen.thumbnail) { processingThumb = false; return; }
    const size = screen.thumbnail.getSize();
    const bitmap = screen.thumbnail.toBitmap(); // RGBA Buffer
    // Draw bitmap to canvas at half size to reduce work
    const targetW = Math.max(320, Math.floor(size.width / 2));
    const targetH = Math.max(180, Math.floor(size.height / 2));
    canvasEl.width = targetW; canvasEl.height = targetH;
    // Create ImageData from bitmap
    const imageData = new ImageData(new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.length), size.width, size.height);
    const tmp = document.createElement('canvas'); tmp.width = size.width; tmp.height = size.height;
    const tctx = tmp.getContext('2d'); tctx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmp, 0, 0, targetW, targetH);

    if (!roi) { processingThumb = false; return; }
    const scaleX = targetW / size.width; const scaleY = targetH / size.height;
    const rx = Math.max(0, Math.floor(roi.x * scaleX));
    const ry = Math.max(0, Math.floor(roi.y * scaleY));
    const rw = Math.max(1, Math.floor(roi.w * scaleX));
    const rh = Math.max(1, Math.floor(roi.h * scaleY));
    const img = ctx.getImageData(rx, ry, rw, rh);

    if (!roiTemplate) { roiTemplate = img; processingThumb = false; return; }
    const diff = meanAbsDiff(img.data, roiTemplate.data);
    const threshold = 10;
    if (diff < threshold) {
      setBadge(deathDetectStatusEl, 'DEATH MATCH', 'danger');
      api.notifyDeathDetected();
    } else {
      setBadge(deathDetectStatusEl, 'Scanning', 'secondary');
    }
  } catch (e) {
    log('thumbnail capture error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    processingThumb = false;
  }
}

// ROI selection
$('selectROI').addEventListener('click', async () => {
  // Ensure capture started to get a frame
  if (!mediaStream) await startScreenCapture();
  await new Promise(r => setTimeout(r, 300));
  const vw = videoEl.videoWidth; const vh = videoEl.videoHeight;
  if (!vw || !vh) return;
  canvasEl.width = vw; canvasEl.height = vh;
  ctx.drawImage(videoEl, 0, 0, vw, vh);

  // Simple click-drag to define ROI on the canvas
  const rect = canvasEl.getBoundingClientRect();
  let start = null; let tempRect = null;
  function toCanvas(e) { return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }

  function drawOverlay() {
    ctx.drawImage(videoEl, 0, 0, vw, vh);
    if (tempRect) {
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3;
      ctx.strokeRect(tempRect.x, tempRect.y, tempRect.w, tempRect.h);
    }
  }

  function onDown(e) { start = toCanvas(e); tempRect = null; }
  function onMove(e) { if (!start) return; const p = toCanvas(e); tempRect = { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), w: Math.abs(p.x-start.x), h: Math.abs(p.y-start.y) }; drawOverlay(); }
  function onUp(e) {
    if (!start) return;
    const p = toCanvas(e); tempRect = { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), w: Math.abs(p.x-start.x), h: Math.abs(p.y-start.y) };
    canvasEl.removeEventListener('mousedown', onDown);
    canvasEl.removeEventListener('mousemove', onMove);
    canvasEl.removeEventListener('mouseup', onUp);
    ctx.drawImage(videoEl, 0, 0, vw, vh);
    roi = tempRect;
    roiStatusEl.textContent = `x:${roi.x}, y:${roi.y}, w:${roi.w}, h:${roi.h}`;
    roiTemplate = null; // reset to arm template on next detection loop
    saveConfigPartial({ deathTemplate: { roi } });
  }

  canvasEl.addEventListener('mousedown', onDown);
  canvasEl.addEventListener('mousemove', onMove);
  canvasEl.addEventListener('mouseup', onUp);
});

$('clearROI').addEventListener('click', () => {
  roi = null; roiTemplate = null; roiStatusEl.textContent = 'No ROI set';
  saveConfigPartial({ deathTemplate: null });
});

// Init
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadConfig();
  } catch (e) {
    log('loadConfig error: ' + (e && e.message ? e.message : String(e)));
  }
  setBadge(obsStatusEl, window.api ? 'Disconnected' : 'No bridge', window.api ? 'secondary' : 'danger');
  setBadge(monStatusEl, 'Idle', 'secondary');
  setBadge(deathDetectStatusEl, 'Off', 'secondary');
  try {
    const p = await api.getConfigPath();
    if (p && p.ok) log('Config path: ' + p.path);
  } catch (_) {}
  // Auto-connect and monitor based on config flags
  try {
    if (cfg && (cfg.autoConnect ?? true)) {
      await connectOBS();
      if (isConnected && (cfg.autoMonitor ?? true) && !monitoring) doStartMonitoring();
    }
  } catch (e) { log('Auto-connect failed: ' + (e && e.message ? e.message : String(e))); }
  updateConnectButton();
});

function setBadge(el, text, variant) {
  el.className = `badge rounded-pill d-inline-flex align-items-center gap-1 text-bg-${variant}`;
  el.innerHTML = `<i class="bi bi-circle-fill"></i><span>${text}</span>`;
}

function updateConnectButton() {
  const label = document.getElementById('connectLabel');
  if (!connectBtn) return;
  if (isConnected) {
    connectBtn.classList.remove('btn-success');
    connectBtn.classList.add('btn-outline-light');
    label ? label.textContent = 'Disconnect' : (connectBtn.textContent = 'Disconnect');
  } else {
    connectBtn.classList.add('btn-success');
    connectBtn.classList.remove('btn-outline-light');
    label ? label.textContent = 'Connect' : (connectBtn.textContent = 'Connect');
  }
}

// Auto-save on change for connection + scenes
function scheduleSave() { clearTimeout(scheduleSave.t); scheduleSave.t = setTimeout(clickSave, 300); }
async function clickSave() {
  const newCfg = {
    obs: { host: hostEl.value, port: Number(portEl.value), password: passEl.value },
    scenes: { live: sceneLiveEl.value, map: sceneMapEl.value, death: sceneDeathEl.value },
    deathTemplate: roi ? { roi } : null
  };
  await api.setConfig(newCfg);
  cfg = { ...cfg, ...newCfg };
}

[hostEl, portEl, passEl, sceneLiveEl, sceneMapEl, sceneDeathEl].forEach(el => {
  el && el.addEventListener('change', scheduleSave);
  el && el.addEventListener('input', scheduleSave);
});

// log uncaught errors to panel
window.addEventListener('error', (e) => log('Renderer error: ' + e.message));
window.addEventListener('unhandledrejection', (e) => log('Unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));

} // end guard

// Save button writes all current settings explicitly
const saveBtn = document.getElementById('saveSettings');
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    const newCfg = {
      obs: { host: hostEl.value, port: Number(portEl.value), password: passEl.value },
      scenes: { live: sceneLiveEl.value, map: sceneMapEl.value, death: sceneDeathEl.value },
      deathTemplate: roi ? { roi } : null
    };
    await api.setConfig(newCfg);
    cfg = { ...cfg, ...newCfg };
    const original = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>Saved';
    saveBtn.classList.remove('btn-outline-light');
    saveBtn.classList.add('btn-success');
    setTimeout(() => { saveBtn.innerHTML = original; saveBtn.classList.remove('btn-success'); saveBtn.classList.add('btn-outline-light'); }, 1200);
  });
}
