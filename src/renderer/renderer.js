// Toggle visibility for password fields - must be global for onclick handlers
window.toggleVisibility = function(fieldId) {
  console.log('toggleVisibility called with fieldId:', fieldId);
  
  const field = document.getElementById(fieldId);
  const icon = document.getElementById(fieldId + '-icon');
  
  console.log('Field element:', field);
  console.log('Icon element:', icon);
  console.log('Current field type:', field ? field.type : 'N/A');
  console.log('Current icon class:', icon ? icon.className : 'N/A');
  
  if (!field || !icon) {
    console.error('toggleVisibility: Field or icon not found for', fieldId);
    return;
  }
  
  if (field.type === 'password') {
    field.type = 'text';
    icon.className = 'bi bi-eye-slash';
    console.log('Changed to TEXT (visible)');
  } else {
    field.type = 'password';
    icon.className = 'bi bi-eye';
    console.log('Changed to PASSWORD (hidden)');
  }
  
  console.log('New field type:', field.type);
  console.log('New icon class:', icon.className);
};

console.log('toggleVisibility function defined on window:', typeof window.toggleVisibility);

if (!window.__rendererLoaded) { window.__rendererLoaded = true;

const $ = (id) => document.getElementById(id);

// Configuration constants
const DEATH_DETECT_INTERVAL_MS = 50; // 50ms = 20 checks/sec (responsive without freezing)
const DEATH_DETECT_COOLDOWN_MS = 2000;
const DEFAULT_THRESHOLD_PERCENT = 85;
const MAX_PORT_NUMBER = 65535;
const MIN_PORT_NUMBER = 1;

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
const resolutionStatusEl = $('resolutionStatus');
const deathDetectStatusEl = $('deathDetectStatus');
const iohookStatusEl = $('iohookStatus');

const sceneLiveEl = $('sceneLive');
const sceneMapEl = $('sceneMap');
const sceneDeathEl = $('sceneDeath');
const respawnDelayEl = $('respawnDelay');

const canvasEl = $('preview');
const ctx = canvasEl.getContext('2d');

// OpenCV template matching state
let templateMat = null;
let tplReady = false;
let cooldownUntil = 0;
let cvReady = false;
let cv = null;
let roiScreenWidth = 0; // Actual monitor width (e.g., 3440)
let roiScreenHeight = 0; // Actual monitor height (e.g., 1440)
let roiPreviewWidth = 0; // Preview width when ROI was selected (e.g., 1280)
let roiPreviewHeight = 0; // Preview height when ROI was selected (e.g., 720)
let templateScale = 1; // Scale factor if template was resized


// Screen capture state (thumbnail-only mode)
let selectedSourceId = null; // Persisted screen source
let inDeathScene = false; // Track if we switched to death scene (prevent auto-switch back)

// Initialize OpenCV when available
function initOpenCV() {
  if (window.cv && window.cv.getBuildInformation) {
    cv = window.cv;
    cvReady = true;
    log('OpenCV.js initialized successfully');
    setBadge($('opencvStatus'), 'Ready', 'success');
    
    // Restore template if we have saved data
    restoreTemplate();
    
    return true;
  }
  return false;
}

// Restore template from config if available
function restoreTemplate() {
  if (!cfg || !cvReady || !cv) return;
  
  const deathTemplate = cfg.deathTemplate || null;
  if (deathTemplate && deathTemplate.templateData) {
    try {
      const { width, height, data } = deathTemplate.templateData;
      const buffer = new Uint8Array(atob(data).split('').map(c => c.charCodeAt(0)));
      
      if (templateMat) templateMat.delete();
      templateMat = cv.matFromArray(height, width, cv.CV_8UC1, buffer);
      tplReady = true;
      
      // Restore screen and preview dimensions
      roiScreenWidth = deathTemplate.screenWidth || 0;
      roiScreenHeight = deathTemplate.screenHeight || 0;
      roiPreviewWidth = deathTemplate.previewWidth || 0;
      roiPreviewHeight = deathTemplate.previewHeight || 0;
      
      setBadge($('templateStatus'), 'Loaded from config', 'success');
      log(`Template restored: ${width}x${height} from config`);
      log(`Screen: ${roiScreenWidth}x${roiScreenHeight}, Preview: ${roiPreviewWidth}x${roiPreviewHeight}`);
    } catch (err) {
      log('Failed to restore template: ' + (err && err.message ? err.message : String(err)));
      setBadge($('templateStatus'), 'Restore Failed', 'warning');
    }
  }
}

// Wait for OpenCV to load
async function waitForCV() {
  if (cvReady) return true;
  setBadge($('opencvStatus'), 'Loading...', 'warning');
  return new Promise((resolve) => {
    const check = () => {
      if (initOpenCV()) {
        resolve(true);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}
let monitorSources = [];

// Input validation functions
function validatePort(port) {
  const num = Number(port);
  if (isNaN(num) || num < MIN_PORT_NUMBER || num > MAX_PORT_NUMBER) {
    log(`Warning: Invalid port ${port}. Must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}`);
    return false;
  }
  return true;
}

function validateROI(x, y, w, h) {
  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    log('Warning: Invalid ROI coordinates. All values must be positive and width/height > 0');
    return false;
  }
  return true;
}

function validateThreshold(thresh) {
  const num = Number(thresh);
  if (isNaN(num) || num < 0 || num > 100) {
    log('Warning: Invalid threshold. Must be between 0 and 100');
    return false;
  }
  return true;
}

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
  } catch (err) { 
    console.log(msg); 
    console.error('Logging error:', err);
  }
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
  respawnDelayEl.value = cfg.respawnDelay ?? 200;
  const deathTemplate = cfg.deathTemplate || null;
  roi = deathTemplate && deathTemplate.roi ? deathTemplate.roi : null;
  roiStatusEl.textContent = roi ? `x:${roi.x}, y:${roi.y}, w:${roi.w}, h:${roi.h}` : 'No ROI set';
  
  // Restore selected screen source
  selectedSourceId = cfg.selectedSourceId || null;
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
  
  // Validate port before connecting
  if (!validatePort(portEl.value)) {
    setBadge(obsStatusEl, 'Invalid Port', 'danger');
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

function updateRespawnDelay() {
  const delay = parseInt(respawnDelayEl.value, 10) || 200;
  saveConfigPartial({ respawnDelay: delay });
  log(`Respawn delay set to ${delay}ms`);
}

sceneLiveEl.addEventListener('change', updateSceneSelection);
sceneMapEl.addEventListener('change', updateSceneSelection);
sceneDeathEl.addEventListener('change', updateSceneSelection);
respawnDelayEl.addEventListener('change', updateRespawnDelay);

const connectBtn = $('connect');
const refreshBtn = $('refreshScenes');
const clearLogBtn = $('clearLog');
connectBtn && connectBtn.addEventListener('click', () => { log((isConnected?'Disconnect':'Connect') + ' button pressed'); connectOBS(); });
refreshBtn && refreshBtn.addEventListener('click', () => { log('Refresh scenes'); refreshScenes(); });
clearLogBtn && clearLogBtn.addEventListener('click', () => { if (logEl) logEl.textContent = ''; });

// Template capture and loading buttons
const captureTplBtn = $('captureTemplate');
const loadTplInput = $('loadTemplate');

if (captureTplBtn) {
  captureTplBtn.addEventListener('click', async () => {
    try {
      await waitForCV();
      if (!cv) {
        log('OpenCV not available');
        return;
      }
      
      // Use thumbnail for template capture
      if (!thumbnailImage) {
        log('No thumbnail available - start monitoring first');
        return;
      }
      
      const vw = thumbnailImage.width;
      const vh = thumbnailImage.height;
      
      // Capture from current thumbnail
      const roiPx = Number($('roiPx')?.value || 0) / 100;
      const roiPy = Number($('roiPy')?.value || 0) / 100;
      const roiPw = Math.max(0.01, Number($('roiPw')?.value || 20) / 100);
      const roiPh = Math.max(0.01, Number($('roiPh')?.value || 15) / 100);
      
      const rx = Math.floor(vw * roiPx);
      const ry = Math.floor(vw * roiPy);
      const rw = Math.floor(vw * roiPw);
      const rh = Math.floor(vh * roiPh);
      
      if (!validateROI(rx, ry, rw, rh)) return;
      
      // Draw ROI to canvas
      canvasEl.width = rw;
      canvasEl.height = rh;
      ctx.drawImage(thumbnailImage, rx, ry, rw, rh, 0, 0, rw, rh);
      const imgData = ctx.getImageData(0, 0, rw, rh);
      
      // Convert to OpenCV Mat (grayscale)
      let srcMat = cv.matFromImageData(imgData);
      let grayMat = new cv.Mat();
      cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
      
      // Replace template
      if (templateMat) templateMat.delete();
      templateMat = grayMat;
      tplReady = true;
      srcMat.delete();
      
      setBadge($('templateStatus'), 'Captured', 'success');
      log(`Template captured: ${rw}x${rh} px`);
    } catch (err) {
      log('Template capture error: ' + (err && err.message ? err.message : String(err)));
    }
  });
}

if (loadTplInput) {
  loadTplInput.addEventListener('change', async (e) => {
    try {
      await waitForCV();
      if (!cv) {
        log('OpenCV not available');
        return;
      }
      
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = w;
          tmpCanvas.height = h;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(img, 0, 0);
          const imgData = tmpCtx.getImageData(0, 0, w, h);
          
          // Convert to grayscale OpenCV Mat
          let srcMat = cv.matFromImageData(imgData);
          let grayMat = new cv.Mat();
          cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
          
          // Replace template
          if (templateMat) templateMat.delete();
          templateMat = grayMat;
          tplReady = true;
          srcMat.delete();
          
          setBadge($('templateStatus'), 'Loaded', 'success');
          log(`Template loaded from file: ${w}x${h} px`);
        } catch (err) {
          log('Template load error: ' + (err && err.message ? err.message : String(err)));
        }
      };
      img.onerror = () => log('Failed to load image file');
      img.src = URL.createObjectURL(file);
    } catch (err) {
      log('File load error: ' + (err && err.message ? err.message : String(err)));
    }
  });
}

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
  window.monitor.start();
  startScreenCapture();
  // persist monitoring state
  saveConfigPartial({ monitoring: true });
}
function doStopMonitoring() {
  if (!monitoring) return;
  monitoring = false; setBadge(monStatusEl, 'Stopped', 'secondary');
  window.monitor.stop();
  stopScreenCapture();
  saveConfigPartial({ monitoring: false });
}

$('startMonitoring').addEventListener('click', doStartMonitoring);
$('stopMonitoring').addEventListener('click', doStopMonitoring);

// Check if uiohook is available and update status
(async () => {
  try {
    const result = await window.monitor.hasUiohook();
    if (iohookStatusEl) {
      setBadge(iohookStatusEl, result.available ? 'Available' : 'Not Available', result.available ? 'success' : 'warning');
    }
  } catch (e) {
    if (iohookStatusEl) setBadge(iohookStatusEl, 'Unknown', 'secondary');
  }
})();

// Populate monitor dropdown with available screens
async function populateMonitors() {
  const monitorSelect = $('monitorSelect');
  if (!monitorSelect || !window.desktop || !window.desktop.getSources) return;
  
  try {
    const sources = await window.desktop.getSources({ types: ['screen'] });
    monitorSelect.innerHTML = '<option value="">-- Select Monitor --</option>';
    sources.forEach((source, idx) => {
      const opt = document.createElement('option');
      opt.value = source.id;
      // Display: "Display Name - 3440x1440" or fallback to source.name
      let displayText = source.displayName || source.name || `Monitor ${idx + 1}`;
      if (source.width && source.height) {
        displayText += ` - ${source.width}x${source.height}`;
      }
      opt.textContent = displayText;
      monitorSelect.appendChild(opt);
    });
    
    // Restore selected monitor if saved in config
    if (selectedSourceId) {
      monitorSelect.value = selectedSourceId;
      // If the saved ID doesn't exist in the list, it will just show "-- Select Monitor --"
      if (monitorSelect.value === selectedSourceId) {
        log('Restored monitor selection: ' + monitorSelect.options[monitorSelect.selectedIndex].text);
      } else {
        log('Saved monitor not found in current display list');
      }
    }
    
    // Save selection on change
    monitorSelect.addEventListener('change', async () => {
      selectedSourceId = monitorSelect.value;
      if (selectedSourceId) {
        await saveConfigPartial({ selectedSourceId });
        log('Monitor saved: ' + monitorSelect.options[monitorSelect.selectedIndex].text);
      }
    });
  } catch (e) {
    log('Failed to populate monitors: ' + (e && e.message ? e.message : String(e)));
  }
}

// Listen for G key map open/close events from main
window.monitor.onMapOpen(() => {
  if (inDeathScene) {
    log('Map open ignored - in Death scene (G key disabled)');
    return;
  }
  log('Map opened (G key pressed) - switching to Map scene');
  api.switchOnMapOpen();
});

window.monitor.onMapClosed(() => {
  if (inDeathScene) {
    log('Map close ignored - in Death scene (G key disabled)');
    return;
  }
  log('Map closed (G key released) - switching to Live scene');
  api.switchOnMapClosed();
});

// Screen capture and death detection via ROI diff
// Screen capture and detection state
let processingThumb = false;


async function startScreenCapture() {
  setBadge(deathDetectStatusEl, roi ? 'Armed' : 'No ROI', roi ? 'warning' : 'secondary');
  
  // Check if user selected a monitor from dropdown
  const monitorSelect = $('monitorSelect');
  if (monitorSelect && monitorSelect.value) {
    selectedSourceId = monitorSelect.value;
  }
  
  // Try to use fast Python capture first
  if (window.roiCapture && roi) {
    try {
      log('Attempting to start Python ROI capture...');
      const result = await window.roiCapture.start();
      log('Python start result:', JSON.stringify(result));
      if (result.success) {
        usePythonCapture = true;
        setBadge(deathDetectStatusEl, 'Monitoring (Fast)', 'success');
        detecting = true;
        processingThumb = true;
        log('✓ Screen capture: using Python ROI capture (ultra-fast!)');
        
        fetchingThumbnail = false;
        lastThumbnailFetch = 0;
        
        detectTimer = setInterval(processFrameThumbnail, DEATH_DETECT_INTERVAL_MS);
        return;
      } else {
        log('Python start failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      log('Python capture not available, using fallback: ' + err.message);
      usePythonCapture = false;
    }
  } else {
    if (!window.roiCapture) log('window.roiCapture not available');
    if (!roi) log('ROI not set');
  }
  
  // Fallback to Electron desktopCapturer (slower but works)
  if (window.desktop && window.desktop.getSources) {
    usePythonCapture = false;
    setBadge(deathDetectStatusEl, 'Monitoring', 'success');
    detecting = true;
    processingThumb = true;
    log('Screen capture: using desktopCapturer thumbnail polling (fallback)');
    
    // Reset fetch state
    fetchingThumbnail = false;
    lastThumbnailFetch = 0;
    
    // DO NOT call fetchAndDisplayThumbnail here - it resizes the preview!
    // The preview should stay at full screen resolution
    // Detection will fetch thumbnails in the background
    
    detectTimer = setInterval(processFrameThumbnail, DEATH_DETECT_INTERVAL_MS);
    return;
  }

  setBadge(deathDetectStatusEl, 'No capture available', 'danger');
  log('Error: desktopCapturer not available');
}

function stopScreenCapture() {
  detecting = false;
  if (detectTimer) clearInterval(detectTimer);
  processingThumb = false;
  fetchingThumbnail = false; // Reset fetch flag
  
  // Stop Python capture if it was being used
  if (usePythonCapture && window.roiCapture) {
    window.roiCapture.stop().catch(err => {
      log('Error stopping Python capture: ' + err.message);
    });
  }
  
  setBadge(deathDetectStatusEl, 'Off', 'secondary');
}

// Helper to fetch and display a thumbnail (for preview/ROI selection)
async function fetchAndDisplayThumbnail() {
  if (!window.desktop || !window.desktop.getSources) return;
  
  // Request SCALED thumbnail for preview (not full resolution)
  // This keeps the preview canvas small and manageable
  const thumbnailSize = { width: 1280, height: 720 }; // Scaled preview size
  
  const sources = await window.desktop.getSources({ 
    types: ['screen'], 
    thumbnailSize: thumbnailSize
  });
  
  if (!sources || !sources.length) {
    log('No screen sources available');
    return null;
  }
  
  // Use saved source or first screen
  let screen = sources[0];
  if (selectedSourceId) {
    screen = sources.find(s => s.id === selectedSourceId) || sources[0];
  }
  
  if (!screen) {
    log('No screen source found');
    return null;
  }
  
  if (!screen.thumbnail) {
    log('Screen source has no thumbnail');
    return null;
  }
  
  // Return the source object so caller can access width/height
  return screen;
}

// Helper to display a screen source on the canvas
async function displayScreenSource(screen) {
  if (!screen || !screen.thumbnail) return;
  
  // Thumbnail should already be a data URL string from main process
  const dataUrl = screen.thumbnail;
  
  if (!thumbnailImage) {
    thumbnailImage = new Image();
  }
  
  // Wait for image to load
  await new Promise((resolve, reject) => {
    thumbnailImage.onload = resolve;
    thumbnailImage.onerror = (err) => {
      log('Thumbnail image load error: ' + err);
      reject(err);
    };
    thumbnailImage.src = dataUrl;
  });
  
  // Display on canvas for preview
  const imgW = thumbnailImage.width;
  const imgH = thumbnailImage.height;
  
  if (imgW && imgH) {
    canvasEl.width = imgW;
    canvasEl.height = imgH;
    ctx.drawImage(thumbnailImage, 0, 0, imgW, imgH);
    
    if (roi && roi.w && roi.h) {
      // Draw ROI overlay box if ROI is set
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 4;
      ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
      
      // Draw label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 20px monospace';
      const label = `ROI: ${roi.w}×${roi.h}`;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(roi.x, roi.y - 30, 200, 25);
      ctx.fillStyle = '#00ff88';
      ctx.fillText(label, roi.x + 5, roi.y - 10);
      
      log(`Preview updated: ${imgW}x${imgH} with ROI overlay at (${roi.x}, ${roi.y})`);
    } else {
      log(`Preview updated: ${imgW}x${imgH} full screen`);
    }
  }
}

// Python-based ROI capture (fast!)
let thumbnailImage = null; // Preview image for UI
let pythonROIImage = null; // Separate image for Python ROI captures (small, resized)
let lastThumbnailFetch = 0;
const THUMBNAIL_FETCH_INTERVAL = 50; // 50ms = 20fps with fast Python capture
let fetchingThumbnail = false; // Prevent concurrent fetches
let roiCanvas = null; // Reusable canvas for ROI extraction
let roiCtx = null;
let usePythonCapture = false; // Will be true if Python is available

// Fast ROI capture using Python (5-15ms response time!)
async function fetchROIFast() {
  if (fetchingThumbnail || !detecting || !processingThumb) return;
  if (!roi || !roi.w || !roi.h) return; // Need ROI coordinates
  
  const now = Date.now();
  if (now - lastThumbnailFetch < THUMBNAIL_FETCH_INTERVAL) return;
  
  fetchingThumbnail = true;
  const fetchStart = Date.now();
  
  try {
    // Validate we have preview dimensions
    if (!roiPreviewWidth || !roiPreviewHeight || !roiScreenWidth || !roiScreenHeight) {
      log(`ERROR: Missing dimensions! Preview: ${roiPreviewWidth}x${roiPreviewHeight}, Screen: ${roiScreenWidth}x${roiScreenHeight}`);
      log('Please re-select ROI to capture screen dimensions');
      usePythonCapture = false; // Fall back to Electron
      fetchingThumbnail = false;
      return;
    }
    
    // Scale ROI coordinates from preview resolution to native screen resolution
    // Use the stored preview size from when ROI was selected
    const scaleX = roiScreenWidth / roiPreviewWidth;  // e.g., 3440/1280 = 2.6875
    const scaleY = roiScreenHeight / roiPreviewHeight; // e.g., 1440/720 = 2.0
    
    const nativeROI = {
      x: Math.floor(roi.x * scaleX),
      y: Math.floor(roi.y * scaleY),
      w: Math.floor(roi.w * scaleX),
      h: Math.floor(roi.h * scaleY)
    };
    
    log(`Capturing: preview ROI ${roi.w}x${roi.h} → native ${nativeROI.w}x${nativeROI.h} at (${nativeROI.x},${nativeROI.y}), resize to ${roi.w}x${roi.h}`);
    
    // Validate coordinates are within screen bounds
    if (nativeROI.x < 0 || nativeROI.y < 0 || 
        nativeROI.x + nativeROI.w > roiScreenWidth || 
        nativeROI.y + nativeROI.h > roiScreenHeight) {
      log(`ERROR: ROI out of bounds! Native: ${nativeROI.x},${nativeROI.y} ${nativeROI.w}x${nativeROI.h}, Screen: ${roiScreenWidth}x${roiScreenHeight}`);
      fetchingThumbnail = false;
      return;
    }
    
    // IMPORTANT: Capture at template size, not preview ROI size!
    // The template might have been auto-scaled, so we need to match its exact dimensions
    const targetWidth = templateMat ? templateMat.cols : roi.w;
    const targetHeight = templateMat ? templateMat.rows : roi.h;
    
    const result = await window.roiCapture.captureRegion({
      monitor: 1,
      x: nativeROI.x,
      y: nativeROI.y,
      width: nativeROI.w,
      height: nativeROI.h,
      // Request resize to template size (ensures exact match for detection)
      resizeWidth: targetWidth,
      resizeHeight: targetHeight
    });
    
    const captureTime = Date.now() - fetchStart;
    if (captureTime > 50) {
      log(`Python capture: ${captureTime}ms (slower than expected)`);
    } else {
      log(`✓ Python capture: ${captureTime}ms, returned ${result.width}x${result.height}`);
    }
    
    if (!result || !result.success) {
      log('Python capture failed: ' + (result ? result.error : 'No result') + ' - retrying next frame');
      // Don't permanently disable, just skip this frame
      return;
    }
    
    // Create image from base64 data - use separate image for Python ROI
    if (!pythonROIImage) {
      pythonROIImage = new Image();
    }
    
    // Wait for image to load before continuing
    await new Promise((resolve, reject) => {
      pythonROIImage.onload = () => {
        lastThumbnailFetch = Date.now();
        resolve();
      };
      pythonROIImage.onerror = (err) => {
        log('Python ROI image load error: ' + err);
        reject(err);
      };
      pythonROIImage.src = 'data:image/png;base64,' + result.data;
    });
    
  } catch (err) {
    log('Python ROI capture error: ' + (err?.message || String(err)));
    // Fall back to slow method
    usePythonCapture = false;
  } finally {
    fetchingThumbnail = false;
  }
}

// Fallback: Separate async function to fetch thumbnails in background (slow Electron method)
async function fetchThumbnailBackground() {
  if (fetchingThumbnail || !detecting || !processingThumb) return;
  
  const now = Date.now();
  if (now - lastThumbnailFetch < THUMBNAIL_FETCH_INTERVAL) return;
  
  fetchingThumbnail = true;
  const fetchStart = Date.now();
  try {
    if (!window.desktop || !window.desktop.getSources) return;
    
    // Minimal thumbnail - just enough to detect ROI (typically 100-200px region)
    const sources = await window.desktop.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 320, height: 180 } // Smallest viable size for fast capture
    });
    
    const captureTime = Date.now() - fetchStart;
    if (captureTime > 80) {
      log(`WARNING: Slow capture detected - ${captureTime}ms`);
    }
    
    if (!sources || !sources.length) return;
    
    let screen = sources[0];
    if (selectedSourceId) {
      screen = sources.find(s => s.id === selectedSourceId) || sources[0];
    }
    
    if (!screen || !screen.thumbnail) return;
    
    const dataUrl = screen.thumbnail;
    if (!thumbnailImage) {
      thumbnailImage = new Image();
    }
    
    // Non-blocking image load with preview update
    thumbnailImage.onload = () => {
      lastThumbnailFetch = Date.now();
      
      // DO NOT update preview during monitoring - keep it at full screen
      // thumbnailImage is used for detection only, not for live display
    };
    thumbnailImage.src = dataUrl;
    
  } catch (err) {
    log('Thumbnail fetch error: ' + (err?.message || String(err)));
  } finally {
    fetchingThumbnail = false;
  }
}

async function processFrameThumbnail() {
  if (!detecting || !processingThumb) return;
  if (!cvReady || !templateMat || !tplReady) {
    setBadge(deathDetectStatusEl, 'No Template', 'warning');
    return;
  }
  
  // Use fast Python capture if available, otherwise fall back to Electron
  if (usePythonCapture) {
    try {
      await fetchROIFast(); // Wait for image to load completely
    } catch (err) {
      // If Python fails, log error but DON'T permanently disable
      log('Python capture error: ' + (err && err.message ? err.message : String(err)));
      // Don't set usePythonCapture = false here, let it retry
    }
  } else {
    // Fallback: Trigger background thumbnail fetch (non-blocking)
    fetchThumbnailBackground().catch(err => {
      // Silently ignore fetch errors, we'll use cached thumbnail
    });
  }
  
  try {
    
    // Select the correct image source based on capture method
    const sourceImage = usePythonCapture ? pythonROIImage : thumbnailImage;
    
    // Debug: Log every 20th iteration to verify detection is running
    if (Math.random() < 0.05) { // 5% of the time
      log(`Detection tick: sourceImage=${sourceImage ? sourceImage.width + 'x' + sourceImage.height : 'null'}, pythonROIImage=${pythonROIImage ? pythonROIImage.width + 'x' + pythonROIImage.height : 'null'}, usePython=${usePythonCapture}`);
    }
    
    // Process the cached image (every 50ms)
    if (!sourceImage || !sourceImage.width || !sourceImage.height) {
      return; // No image yet
    }
    if (!roi || !roi.w || !roi.h) {
      setBadge(deathDetectStatusEl, 'No ROI Set', 'warning');
      return; // Need ROI to know what region to process
    }
    
    const imgW = sourceImage.width;
    const imgH = sourceImage.height;
    
    let roiX, roiY, roiW, roiH;
    
    if (usePythonCapture) {
      // Python captured and resized to preview ROI size - use directly!
      roiX = 0;
      roiY = 0;
      roiW = imgW;
      roiH = imgH;
    } else {
      // Electron method: Scale ROI coordinates from original screen size to thumbnail size
      const scaleX = roiScreenWidth > 0 ? imgW / roiScreenWidth : 1;
      const scaleY = roiScreenHeight > 0 ? imgH / roiScreenHeight : 1;
      
      roiX = Math.floor(roi.x * scaleX);
      roiY = Math.floor(roi.y * scaleY);
      roiW = Math.floor(roi.w * scaleX);
      roiH = Math.floor(roi.h * scaleY);
    }
    
    // Debug log on first run
    if (!roiCanvas) {
      if (usePythonCapture) {
        log(`Detection setup: Python ROI capture, returned image=${imgW}x${imgH}, template=${templateMat.cols}x${templateMat.rows}`);
        log(`ROI extraction: x=${roiX}, y=${roiY}, w=${roiW}, h=${roiH}`);
        log(`pythonROIImage size: ${pythonROIImage ? pythonROIImage.width + 'x' + pythonROIImage.height : 'null'}`);
      } else {
        const scaleX = roiScreenWidth > 0 ? imgW / roiScreenWidth : 1;
        const scaleY = roiScreenHeight > 0 ? imgH / roiScreenHeight : 1;
        log(`Detection setup: thumbnail=${imgW}x${imgH}, screen=${roiScreenWidth}x${roiScreenHeight}, scale=${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);
        log(`ROI region: x=${roiX}, y=${roiY}, w=${roiW}, h=${roiH}`);
      }
    }
    
    // Reuse canvas for ROI extraction (create only once!)
    if (!roiCanvas) {
      roiCanvas = document.createElement('canvas');
      roiCtx = roiCanvas.getContext('2d', { willReadFrequently: true });
    }
    
    // Resize canvas only if dimensions changed
    if (roiCanvas.width !== roiW || roiCanvas.height !== roiH) {
      roiCanvas.width = roiW;
      roiCanvas.height = roiH;
    }
    
    // Draw the ROI portion
    if (usePythonCapture) {
      // Python already captured and resized to exact template size - use as-is, no transformation
      roiCtx.drawImage(sourceImage, 0, 0);
    } else {
      // Electron: Extract ROI region from thumbnail
      roiCtx.drawImage(sourceImage, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
    }
    
    // Get image data from the small ROI region only
    const imageData = roiCtx.getImageData(0, 0, roiW, roiH);
    
    let src = null, srcGray = null, result = null;
    try {
      // Convert to OpenCV Mat
      src = cv.matFromImageData(imageData);
      srcGray = new cv.Mat();
      cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY);
      
      // If template was scaled down, scale the search image to match
      let searchMat = srcGray;
      if (templateScale < 1) {
        const scaledWidth = Math.floor(srcGray.cols * templateScale);
        const scaledHeight = Math.floor(srcGray.rows * templateScale);
        searchMat = new cv.Mat();
        cv.resize(srcGray, searchMat, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_AREA);
      }
      
      // Check size compatibility
      if (searchMat.cols < templateMat.cols || searchMat.rows < templateMat.rows) {
        setBadge(deathDetectStatusEl, 'Template too large', 'warning');
        if (searchMat !== srcGray) searchMat.delete();
        return;
      }
      
      // Perform template matching
      result = new cv.Mat();
      cv.matchTemplate(searchMat, templateMat, result, cv.TM_CCOEFF_NORMED);
      
      // Clean up scaled search mat if it was created
      if (searchMat !== srcGray) {
        searchMat.delete();
      }
      
      // Get best match score
      const mm = cv.minMaxLoc(result);
      const score = mm.maxVal;
      const threshold = (Number($('thresh')?.value || DEFAULT_THRESHOLD_PERCENT)) / 100;
      
      // Debug: Log matching results occasionally
      if (Math.random() < 0.1) { // 10% of the time
        log(`Match: score=${(score*100).toFixed(1)}%, threshold=${(threshold*100).toFixed(1)}%, template=${templateMat.cols}x${templateMat.rows}, search=${searchMat.cols}x${searchMat.rows}`);
      }
      
      // Update match score display
      const scoreEl = $('matchScore');
      if (scoreEl) {
        scoreEl.textContent = `${(score*100).toFixed(1)}%`;
        scoreEl.className = score >= threshold ? 'badge text-bg-success' : 'badge text-bg-dark';
      }
      
      // Death detection logic with cooldown override
      // DEATH DETECTION: Always triggers immediately (overrides cooldown)
      if (score >= threshold) {
        if (!inDeathScene) {
          setBadge(deathDetectStatusEl, 'DEATH', 'danger');
          api.notifyDeathDetected();
          cooldownUntil = Date.now() + DEATH_DETECT_COOLDOWN_MS;
          inDeathScene = true;
          log(`Death detected! Match score: ${(score*100).toFixed(1)}% - G key disabled`);
        } else {
          setBadge(deathDetectStatusEl, 'In Death Scene', 'danger');
        }
      } 
      // RETURN TO LIVE: Respects cooldown (delayed return is OK)
      else if (inDeathScene && score < threshold && Date.now() > cooldownUntil) {
        setBadge(deathDetectStatusEl, 'Returning to Live', 'success');
        api.switchOnMapClosed();
        inDeathScene = false;
        log(`Death screen cleared! Match score: ${(score*100).toFixed(1)}% - Returning to Live, G key re-enabled`);
      } else if (Date.now() > cooldownUntil && !inDeathScene) {
        setBadge(deathDetectStatusEl, 'Scanning', 'secondary');
      } else if (inDeathScene) {
        setBadge(deathDetectStatusEl, 'In Death Scene', 'danger');
      } else {
        const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
        setBadge(deathDetectStatusEl, `Cooldown (${remaining}s)`, 'info');
      }
    } finally {
      // Clean up OpenCV Mats
      if (src) src.delete();
      if (srcGray) srcGray.delete();
      if (result) result.delete();
    }
  } catch (err) {
    log('Thumbnail processing error: ' + (err && err.message ? err.message : String(err)));
  }
}

// ROI selection - Draw directly on preview canvas
$('selectROI').addEventListener('click', async () => {
  log('Starting ROI selection on preview canvas...');
  
  // Fetch screen source to get actual dimensions
  const screen = await fetchAndDisplayThumbnail();
  
  if (!screen) {
    log('ERROR: Could not get screen source');
    return;
  }
  
  // Display the thumbnail
  await displayScreenSource(screen);
  await new Promise(r => setTimeout(r, 500)); // Wait for image to load
  
  if (!thumbnailImage || !thumbnailImage.width) {
    log('ERROR: Could not load preview for ROI selection');
    return;
  }
  
  log(`Preview ready: ${thumbnailImage.width}x${thumbnailImage.height}, starting selection...`);
  
  // Get ACTUAL screen dimensions from the source object (includes display bounds)
  // This is critical for scaling ROI coordinates correctly during monitoring
  const screenWidth = screen.width || window.screen.width;
  const screenHeight = screen.height || window.screen.height;
  
  roiScreenWidth = screenWidth;   // Store ACTUAL monitor resolution (e.g., 3440x1440)
  roiScreenHeight = screenHeight;
  roiPreviewWidth = thumbnailImage.width;  // Store preview size (e.g., 1280x720)
  roiPreviewHeight = thumbnailImage.height;
  
  log(`Actual screen: ${screenWidth}x${screenHeight}, preview: ${thumbnailImage.width}x${thumbnailImage.height}`);
  
  // Ensure canvas matches image size (but only resize if needed)
  if (canvasEl.width !== thumbnailImage.width || canvasEl.height !== thumbnailImage.height) {
    log(`Resizing canvas from ${canvasEl.width}x${canvasEl.height} to ${thumbnailImage.width}x${thumbnailImage.height}`);
    canvasEl.width = thumbnailImage.width;
    canvasEl.height = thumbnailImage.height;
    ctx.drawImage(thumbnailImage, 0, 0);
  } else {
    log('Canvas already correct size, using existing preview');
  }
  
  // Selection state
  let startX = 0, startY = 0, isDrawing = false;
  let currentRect = null;
  
  // Convert mouse coordinates to canvas pixel coordinates
  function getCanvasCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY)
    };
  }
  
  function redraw() {
    ctx.drawImage(thumbnailImage, 0, 0);
    if (currentRect) {
      // Draw selection rectangle
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 4;
      ctx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
      
      // Draw semi-transparent fill
      ctx.fillStyle = 'rgba(0, 255, 136, 0.15)';
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
      
      // Draw dimensions label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 20px monospace';
      const label = `${currentRect.w}×${currentRect.h} @ (${currentRect.x}, ${currentRect.y})`;
      const labelY = currentRect.y > 30 ? currentRect.y - 10 : currentRect.y + currentRect.h + 25;
      
      // Draw label background
      const metrics = ctx.measureText(label);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(currentRect.x - 5, labelY - 20, metrics.width + 10, 25);
      
      // Draw label text
      ctx.fillStyle = '#00ff88';
      ctx.fillText(label, currentRect.x, labelY);
    }
  }
  
  function onMouseDown(e) {
    const coords = getCanvasCoords(e);
    startX = coords.x;
    startY = coords.y;
    isDrawing = true;
    currentRect = null;
    canvasEl.style.cursor = 'crosshair';
  }
  
  function onMouseMove(e) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    currentRect = {
      x: Math.min(startX, coords.x),
      y: Math.min(startY, coords.y),
      w: Math.abs(coords.x - startX),
      h: Math.abs(coords.y - startY)
    };
    redraw();
  }
  
  async function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    canvasEl.style.cursor = 'default';
    
    if (!currentRect || currentRect.w < 10 || currentRect.h < 10) {
      log('ROI too small (minimum 10x10), selection cancelled');
      ctx.drawImage(thumbnailImage, 0, 0);
      cleanup();
      return;
    }
    
    // Save ROI
    roi = currentRect;
    log(`✓ ROI selected: ${roi.w}x${roi.h} at (${roi.x}, ${roi.y})`);
    
    // Update UI
    roiStatusEl.textContent = `x:${roi.x}, y:${roi.y}, w:${roi.w}, h:${roi.h}`;
    
    // Update ROI percent inputs
    const roiPxInput = $('roiPx');
    const roiPyInput = $('roiPy');
    const roiPwInput = $('roiPw');
    const roiPhInput = $('roiPh');
    if (roiPxInput) roiPxInput.value = Math.round((roi.x / roiScreenWidth) * 100);
    if (roiPyInput) roiPyInput.value = Math.round((roi.y / roiScreenHeight) * 100);
    if (roiPwInput) roiPwInput.value = Math.round((roi.w / roiScreenWidth) * 100);
    if (roiPhInput) roiPhInput.value = Math.round((roi.h / roiScreenHeight) * 100);
    
    // Capture template from ROI
    try {
      if (!cvReady || !cv) {
        log('OpenCV not ready! Trying to initialize...');
        await waitForCV();
      }
      
      if (cvReady && cv) {
        log(`Extracting template from ${roi.w}x${roi.h} region...`);
        
        let imgData;
        
        // Try to use Python if available, otherwise fall back to Electron
        if (window.roiCapture) {
          try {
            // Ensure Python is started
            if (!usePythonCapture) {
              log('Python not started, initializing for template capture...');
              const result = await window.roiCapture.start();
              if (result.success) {
                usePythonCapture = true;
                log('✓ Python initialized for template capture');
              } else {
                throw new Error('Python start failed: ' + (result.error || 'Unknown error'));
              }
            }
            
            // Capture using Python (same as detection will use)
            const scaleX = roiScreenWidth / roiPreviewWidth;
            const scaleY = roiScreenHeight / roiPreviewHeight;
            
            const nativeROI = {
              x: Math.floor(roi.x * scaleX),
              y: Math.floor(roi.y * scaleY),
              w: Math.floor(roi.w * scaleX),
              h: Math.floor(roi.h * scaleY)
            };
            
            log(`Capturing template via Python: native ${nativeROI.w}x${nativeROI.h} at (${nativeROI.x},${nativeROI.y}), resize to ${roi.w}x${roi.h}`);
            
            const result = await window.roiCapture.captureRegion({
              monitor: 1,
              x: nativeROI.x,
              y: nativeROI.y,
              width: nativeROI.w,
              height: nativeROI.h,
              resizeWidth: roi.w,
              resizeHeight: roi.h
            });
            
            if (!result || !result.success) {
              throw new Error('Python template capture failed: ' + (result ? result.error : 'No result'));
            }
            
            // Load Python image
            const tempImg = new Image();
            await new Promise((resolve, reject) => {
              tempImg.onload = resolve;
              tempImg.onerror = reject;
              tempImg.src = 'data:image/png;base64,' + result.data;
            });
            
            // Draw to canvas
            const roiCanvas = document.createElement('canvas');
            roiCanvas.width = roi.w;
            roiCanvas.height = roi.h;
            const roiCtx = roiCanvas.getContext('2d');
            roiCtx.drawImage(tempImg, 0, 0);
            imgData = roiCtx.getImageData(0, 0, roi.w, roi.h);
            
            log(`✓ Template captured via Python: ${tempImg.width}x${tempImg.height}`);
          } catch (pythonErr) {
            log('Python template capture failed, falling back to Electron: ' + pythonErr.message);
            usePythonCapture = false; // Disable for this session
            
            // Fall through to Electron method below
            const roiCanvas = document.createElement('canvas');
            roiCanvas.width = roi.w;
            roiCanvas.height = roi.h;
            const roiCtx = roiCanvas.getContext('2d');
            roiCtx.drawImage(thumbnailImage, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
            imgData = roiCtx.getImageData(0, 0, roi.w, roi.h);
            
            log(`✓ Template captured via Electron thumbnail (fallback)`);
          }
        } else {
          // No Python available - use Electron thumbnail
          const roiCanvas = document.createElement('canvas');
          roiCanvas.width = roi.w;
          roiCanvas.height = roi.h;
          const roiCtx = roiCanvas.getContext('2d');
          roiCtx.drawImage(thumbnailImage, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
          imgData = roiCtx.getImageData(0, 0, roi.w, roi.h);
          
          log(`✓ Template captured via Electron thumbnail (Python not available)`);
        }
        
        // Convert to grayscale OpenCV Mat
        let srcMat = cv.matFromImageData(imgData);
        let grayMat = new cv.Mat();
        cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
        
        // Resize if template is too large (max 400x400 for performance)
        const MAX_TEMPLATE_SIZE = 400;
        let finalTemplate = grayMat;
        
        if (grayMat.cols > MAX_TEMPLATE_SIZE || grayMat.rows > MAX_TEMPLATE_SIZE) {
          const scale = Math.min(MAX_TEMPLATE_SIZE / grayMat.cols, MAX_TEMPLATE_SIZE / grayMat.rows);
          const newWidth = Math.floor(grayMat.cols * scale);
          const newHeight = Math.floor(grayMat.rows * scale);
          
          log(`Template too large (${grayMat.cols}x${grayMat.rows}), resizing to ${newWidth}x${newHeight} (scale=${scale.toFixed(3)})`);
          
          finalTemplate = new cv.Mat();
          cv.resize(grayMat, finalTemplate, new cv.Size(newWidth, newHeight), 0, 0, cv.INTER_AREA);
          grayMat.delete();
          templateScale = scale; // Store scale for search image matching
        } else {
          templateScale = 1; // No scaling needed
        }
        
        // Replace template
        if (templateMat) {
          templateMat.delete();
        }
        templateMat = finalTemplate;
        tplReady = true;
        srcMat.delete();
        
        // Save template data to config
        const templateData = {
          width: templateMat.cols,
          height: templateMat.rows,
          data: btoa(String.fromCharCode.apply(null, templateMat.data))
        };
        
        setBadge($('templateStatus'), 'Captured', 'success');
        log(`✓ Template captured: ${templateMat.cols}x${templateMat.rows} grayscale Mat`);
        
        // Save ROI and template with screen and preview dimensions
        saveConfigPartial({ 
          deathTemplate: { 
            roi, 
            templateData, 
            screenWidth: roiScreenWidth, 
            screenHeight: roiScreenHeight,
            previewWidth: roiPreviewWidth,
            previewHeight: roiPreviewHeight
          } 
        });
      } else {
        log('ERROR: OpenCV not ready');
        setBadge($('templateStatus'), 'OpenCV Not Ready', 'danger');
      }
    } catch (err) {
      log('ERROR: Template capture failed: ' + (err && err.message ? err.message : String(err)));
      setBadge($('templateStatus'), 'Capture Failed', 'danger');
    }
    
    cleanup();
    
    // Draw ROI box on current preview immediately
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 4;
    ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 20px monospace';
    const label = `ROI: ${roi.w}×${roi.h}`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(roi.x, roi.y - 30, 200, 25);
    ctx.fillStyle = '#00ff88';
    ctx.fillText(label, roi.x + 5, roi.y - 10);
  }
  
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      log('ROI selection cancelled');
      canvasEl.style.cursor = 'default';
      ctx.drawImage(thumbnailImage, 0, 0);
      cleanup();
    }
  }
  
  function cleanup() {
    canvasEl.removeEventListener('mousedown', onMouseDown);
    canvasEl.removeEventListener('mousemove', onMouseMove);
    canvasEl.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
  }
  
  // Attach event listeners
  canvasEl.addEventListener('mousedown', onMouseDown);
  canvasEl.addEventListener('mousemove', onMouseMove);
  canvasEl.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
  
  log('✓ ROI selection mode active - click and drag on preview to select region (ESC to cancel)');
});

$('clearROI').addEventListener('click', () => {
  roi = null;
  roiScreenWidth = 0;
  roiScreenHeight = 0;
  roiPreviewWidth = 0;
  roiPreviewHeight = 0;
  templateScale = 1;
  roiStatusEl.textContent = 'No ROI set';
  if (templateMat) {
    templateMat.delete();
    templateMat = null;
  }
  tplReady = false;
  setBadge($('templateStatus'), 'Not Set', 'secondary');
  saveConfigPartial({ deathTemplate: null });
  log('ROI and template cleared');
  
  // Update preview to show full screen again
  fetchAndDisplayThumbnail().then(screen => {
    if (screen) displayScreenSource(screen);
  }).catch(err => {
    log('Preview update error: ' + (err && err.message ? err.message : String(err)));
  });
});

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  // Clean up OpenCV resources
  if (templateMat) {
    try {
      templateMat.delete();
      templateMat = null;
    } catch (err) {
      console.error('Error cleaning up template mat:', err);
    }
  }
  
  // Clear intervals
  if (detectTimer) clearInterval(detectTimer);
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
  
  // Initialize OpenCV
  try {
    if (!initOpenCV()) {
      log('OpenCV not ready yet, setting up cv.onRuntimeInitialized callback...');
      // Set up the callback for when OpenCV finishes loading
      const Module = {
        onRuntimeInitialized: () => {
          log('cv.onRuntimeInitialized fired!');
          initOpenCV();
        }
      };
      
      // If cv already exists but not ready, assign callback
      if (window.cv) {
        window.cv.onRuntimeInitialized = Module.onRuntimeInitialized;
      } else {
        // If cv doesn't exist yet, set up global Module for OpenCV to use
        window.Module = Module;
      }
    }
  } catch (e) {
    log('OpenCV init error: ' + (e && e.message ? e.message : String(e)));
  }
  
  // Populate monitor dropdown
  try {
    await populateMonitors();
  } catch (e) {
    log('Failed to populate monitors: ' + (e && e.message ? e.message : String(e)));
  }
  
  // Fetch initial preview (full screen if no ROI, or with ROI overlay if set)
  try {
    const screen = await fetchAndDisplayThumbnail();
    if (screen) await displayScreenSource(screen);
    log('Initial preview loaded');
  } catch (e) {
    log('Failed to load initial preview: ' + (e && e.message ? e.message : String(e)));
  }
  
  try {
    const p = await api.getConfigPath();
    if (p && p.ok) log('Config path: ' + p.path);
  } catch (err) {
    log('Config path error: ' + (err && err.message ? err.message : String(err)));
  }
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
