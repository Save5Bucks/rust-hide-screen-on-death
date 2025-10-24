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
const DEATH_DETECT_INTERVAL_MS = 400;
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

const videoEl = $('screenVideo');
const canvasEl = $('preview');
const ctx = canvasEl.getContext('2d');

// Update resolution display when video metadata loads
videoEl.addEventListener('loadedmetadata', () => {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (resolutionStatusEl && vw && vh) {
    resolutionStatusEl.textContent = `${vw}x${vh}`;
    log(`Video resolution: ${vw}x${vh}`);
  }
  
  // Update ROI percent inputs if ROI is loaded
  if (roi && vw && vh) {
    const roiPxInput = $('roiPx');
    const roiPyInput = $('roiPy');
    const roiPwInput = $('roiPw');
    const roiPhInput = $('roiPh');
    if (roiPxInput) roiPxInput.value = Math.round((roi.x / vw) * 100);
    if (roiPyInput) roiPyInput.value = Math.round((roi.y / vh) * 100);
    if (roiPwInput) roiPwInput.value = Math.round((roi.w / vw) * 100);
    if (roiPhInput) roiPhInput.value = Math.round((roi.h / vh) * 100);
  }
});

// OpenCV template matching state
let templateMat = null;
let tplReady = false;
let cooldownUntil = 0;
let cvReady = false;
let cv = null;

// Screen capture state
let mediaStream = null;
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
      setBadge($('templateStatus'), 'Loaded from config', 'success');
      log(`Template restored: ${width}x${height} from config`);
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
      if (detectTimer) clearInterval(detectTimer);
      detectTimer = setInterval(processFrame, DEATH_DETECT_INTERVAL_MS);
      
      // Save selected source
      selectedSourceId = screen.id;
      await saveConfigPartial({ selectedSourceId: screen.id });
      
      log('Using selected source: ' + (screen.name || screen.id));
      setBadge(deathDetectStatusEl, roi ? 'Armed' : 'No ROI', roi ? 'warning' : 'secondary');
    } else {
      log('Could not start stream from selected source');
    }
  } catch (e) { log('pickScreen error: ' + (e && e.message ? e.message : String(e))); }
});

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
      
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) {
        log('No video source - start monitoring first');
        return;
      }
      
      // Capture from current video frame
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
      ctx.drawImage(videoEl, rx, ry, rw, rh, 0, 0, rw, rh);
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
let roiTemplate = null; // ImageData for death ROI (legacy, unused)
let processingThumb = false;

async function startScreenCapture() {
  setBadge(deathDetectStatusEl, roi ? 'Armed' : 'No ROI', roi ? 'warning' : 'secondary');
  
  let stream = null;
  
  // Check if user selected a monitor from dropdown
  const monitorSelect = $('monitorSelect');
  if (monitorSelect && monitorSelect.value) {
    selectedSourceId = monitorSelect.value;
  }
  
  // Try to use selected screen source first
  if (selectedSourceId && window.desktop && window.desktop.getSources) {
    try {
      const sources = await window.desktop.getSources({ types: ['screen', 'window'] });
      const savedScreen = sources.find(s => s.id === selectedSourceId);
      if (savedScreen) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: savedScreen.id,
              maxWidth: 8000, maxHeight: 8000, maxFrameRate: 30
            }
          }
        }).catch(e => { log('Saved source error: ' + e.message); return null; });
        
        if (stream) {
          log('Using saved screen: ' + (savedScreen.name || savedScreen.id));
        }
      }
    } catch (e) {
      log('Saved source lookup error: ' + (e && e.message ? e.message : String(e)));
    }
  }
  
  // Fall back to standard getDisplayMedia
  if (!stream) {
    try {
      stream = await window.navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (e) {
      log('getDisplayMedia error: ' + (e && e.message ? e.message : String(e)));
    }
  }
  
  // Final fallback: first available desktop source
  if (!stream && window.desktop && window.desktop.getSources) {
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
    detectTimer = setInterval(processFrame, DEATH_DETECT_INTERVAL_MS);
    log('Screen capture: using getDisplayMedia/userMedia stream');
    return;
  }

  // Final fallback: Poll desktopCapturer thumbnails (no permissions prompt)
  if (window.desktop && window.desktop.getSources) {
    setBadge(deathDetectStatusEl, 'Fallback capture', 'warning');
    detecting = true;
    log('Screen capture: using desktopCapturer thumbnail polling');
    detectTimer = setInterval(processFrame, DEATH_DETECT_INTERVAL_MS);
    log('Screen capture: using getDisplayMedia/userMedia stream');
    return;
  }

  setBadge(deathDetectStatusEl, 'Permission denied', 'danger');
}

function stopScreenCapture() {
  detecting = false;
  if (detectTimer) clearInterval(detectTimer);
  processingThumb = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  setBadge(deathDetectStatusEl, 'Off', 'secondary');
}

async function processFrame() {
  if (!detecting) return;
  if (!cvReady || !templateMat || !tplReady) {
    setBadge(deathDetectStatusEl, 'No Template', 'warning');
    return;
  }
  
  try {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;
    
    // Draw full frame to canvas for processing
    canvasEl.width = vw;
    canvasEl.height = vh;
    ctx.drawImage(videoEl, 0, 0, vw, vh);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, vw, vh);
    
    let src = null, srcGray = null, result = null;
    try {
      // Convert to OpenCV Mat
      src = cv.matFromImageData(imageData);
      srcGray = new cv.Mat();
      cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY);
      
      // Check size compatibility
      if (srcGray.cols < templateMat.cols || srcGray.rows < templateMat.rows) {
        setBadge(deathDetectStatusEl, 'Template too large', 'warning');
        return;
      }
      
      // Perform template matching
      result = new cv.Mat();
      cv.matchTemplate(srcGray, templateMat, result, cv.TM_CCOEFF_NORMED);
      
      // Get best match score
      const mm = cv.minMaxLoc(result);
      const score = mm.maxVal;
      const threshold = (Number($('thresh')?.value || DEFAULT_THRESHOLD_PERCENT)) / 100;
      
      // Update match score display
      const scoreEl = $('matchScore');
      if (scoreEl) {
        scoreEl.textContent = `${(score*100).toFixed(1)}%`;
        scoreEl.className = score >= threshold ? 'badge text-bg-success' : 'badge text-bg-dark';
      }
      
      // Check with cooldown
      if (score >= threshold && Date.now() > cooldownUntil) {
        // Death detected!
        if (!inDeathScene) {
          setBadge(deathDetectStatusEl, 'DEATH', 'danger');
          api.notifyDeathDetected();
          cooldownUntil = Date.now() + DEATH_DETECT_COOLDOWN_MS;
          inDeathScene = true; // Mark that we're in death scene
          log(`Death detected! Match score: ${(score*100).toFixed(1)}% - G key disabled`);
        } else {
          // Already in death scene, just update display
          setBadge(deathDetectStatusEl, 'In Death Scene', 'danger');
        }
      } else if (inDeathScene && score < threshold && Date.now() > cooldownUntil) {
        // Death screen cleared - auto-return to Live
        setBadge(deathDetectStatusEl, 'Returning to Live', 'success');
        api.switchOnMapClosed(); // Use same IPC call as G key release (switches to Live)
        inDeathScene = false;
        log(`Death screen cleared! Match score: ${(score*100).toFixed(1)}% - Returning to Live, G key re-enabled`);
      } else if (Date.now() > cooldownUntil && !inDeathScene) {
        setBadge(deathDetectStatusEl, 'Scanning', 'secondary');
      } else if (inDeathScene) {
        // In death scene but still in cooldown
        setBadge(deathDetectStatusEl, 'In Death Scene', 'danger');
      } else {
        // In cooldown
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
    log('Frame processing error: ' + (err && err.message ? err.message : String(err)));
  }
}

// ROI selection
$('selectROI').addEventListener('click', async () => {
  // Ensure capture started to get a frame
  if (!mediaStream) await startScreenCapture();
  await new Promise(r => setTimeout(r, 300));
  const vw = videoEl.videoWidth; const vh = videoEl.videoHeight;
  if (!vw || !vh) {
    log('No video dimensions available');
    return;
  }
  
  // Set canvas to exact video resolution (1:1 pixel mapping)
  canvasEl.width = vw; 
  canvasEl.height = vh;
  ctx.drawImage(videoEl, 0, 0, vw, vh);

  // Simple click-drag to define ROI on the canvas
  const rect = canvasEl.getBoundingClientRect();
  let start = null; let tempRect = null;
  
  // Convert mouse coordinates to canvas pixel coordinates
  function toCanvas(e) { 
    const scaleX = vw / rect.width;
    const scaleY = vh / rect.height;
    return { 
      x: Math.floor((e.clientX - rect.left) * scaleX), 
      y: Math.floor((e.clientY - rect.top) * scaleY) 
    }; 
  }

  function drawOverlay() {
    ctx.drawImage(videoEl, 0, 0, vw, vh);
    if (tempRect) {
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3;
      ctx.strokeRect(tempRect.x, tempRect.y, tempRect.w, tempRect.h);
    }
  }

  function onDown(e) { start = toCanvas(e); tempRect = null; }
  function onMove(e) { 
    if (!start) return; 
    const p = toCanvas(e); 
    tempRect = { 
      x: Math.min(start.x, p.x), 
      y: Math.min(start.y, p.y), 
      w: Math.abs(p.x - start.x), 
      h: Math.abs(p.y - start.y) 
    }; 
    drawOverlay(); 
  }
  async function onUp(e) {
    if (!start) return;
    const p = toCanvas(e); 
    tempRect = { 
      x: Math.min(start.x, p.x), 
      y: Math.min(start.y, p.y), 
      w: Math.abs(p.x - start.x), 
      h: Math.abs(p.y - start.y) 
    };
    canvasEl.removeEventListener('mousedown', onDown);
    canvasEl.removeEventListener('mousemove', onMove);
    canvasEl.removeEventListener('mouseup', onUp);
    ctx.drawImage(videoEl, 0, 0, vw, vh);
    roi = tempRect;
    
    // Update ROI status with pixel coordinates
    roiStatusEl.textContent = `x:${roi.x}, y:${roi.y}, w:${roi.w}, h:${roi.h}`;
    
    // Update ROI percent inputs
    const roiPxInput = $('roiPx');
    const roiPyInput = $('roiPy');
    const roiPwInput = $('roiPw');
    const roiPhInput = $('roiPh');
    if (roiPxInput) roiPxInput.value = Math.round((roi.x / vw) * 100);
    if (roiPyInput) roiPyInput.value = Math.round((roi.y / vh) * 100);
    if (roiPwInput) roiPwInput.value = Math.round((roi.w / vw) * 100);
    if (roiPhInput) roiPhInput.value = Math.round((roi.h / vh) * 100);
    
    // Capture template from ROI
    log(`Attempting template capture - cvReady: ${cvReady}, cv: ${!!cv}`);
    try {
      if (!cvReady || !cv) {
        log('OpenCV not ready! Trying to initialize...');
        await waitForCV();
      }
      
      if (cvReady && cv) {
        log(`Extracting ${roi.w}x${roi.h} region at (${roi.x}, ${roi.y})`);
        
        // Extract ROI from video
        const roiCanvas = document.createElement('canvas');
        roiCanvas.width = roi.w;
        roiCanvas.height = roi.h;
        const roiCtx = roiCanvas.getContext('2d');
        roiCtx.drawImage(videoEl, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
        const imgData = roiCtx.getImageData(0, 0, roi.w, roi.h);
        
        log('Converting to OpenCV grayscale Mat...');
        // Convert to grayscale OpenCV Mat
        let srcMat = cv.matFromImageData(imgData);
        let grayMat = new cv.Mat();
        cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
        
        // Replace template
        if (templateMat) {
          log('Deleting old template');
          templateMat.delete();
        }
        templateMat = grayMat;
        tplReady = true;
        srcMat.delete();
        
        // Save template data to config
        const templateData = {
          width: grayMat.cols,
          height: grayMat.rows,
          data: btoa(String.fromCharCode.apply(null, grayMat.data))
        };
        
        setBadge($('templateStatus'), 'Captured', 'success');
        log(`✓ Template captured successfully: ${roi.w}x${roi.h} grayscale Mat`);
        
        // Save both ROI and template data
        saveConfigPartial({ deathTemplate: { roi, templateData } });
      } else {
        log('ERROR: OpenCV still not ready after waitForCV()');
        setBadge($('templateStatus'), 'OpenCV Not Ready', 'danger');
      }
    } catch (err) {
      log('ERROR: Template capture failed: ' + (err && err.message ? err.message : String(err)));
      setBadge($('templateStatus'), 'Capture Failed', 'danger');
    }
    
    roiTemplate = null; // reset legacy template
    log(`ROI selected: ${roi.w}x${roi.h} at (${roi.x}, ${roi.y})`);
  }

  canvasEl.addEventListener('mousedown', onDown);
  canvasEl.addEventListener('mousemove', onMove);
  canvasEl.addEventListener('mouseup', onUp);
});

$('clearROI').addEventListener('click', () => {
  roi = null; roiTemplate = null; roiStatusEl.textContent = 'No ROI set';
  saveConfigPartial({ deathTemplate: null });
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
  
  // Stop media streams
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(t => t.stop());
    } catch (err) {
      console.error('Error stopping media stream:', err);
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
