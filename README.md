Rust OBS Scene Toggle Helper (Electron)

Overview
- Electron app that talks to OBS via obs-websocket and switches scenes when either:
  - The Rust map key (G) is held down (via optional global key hook).
  - The Rust death screen is detected on your monitor using a user-selected screen ROI.

Status
- Provides a simple UI, OBS connection, scene selection, monitoring start/stop, and a screen-capture based death detector.
- Uses obs-websocket v5 via `obs-websocket-js`.

Quick Start
1) Install Node.js 18+.
2) Install dependencies: `npm install`
3) Start the app: `npm start`

OBS Setup
- OBS 28+ includes obs-websocket v5 (default port 4455). Enable it in OBS settings and set a password.

Usage
- Enter OBS host, port, password and click Connect.
- Click Refresh Scenes, choose Live / Map / Death scenes.
- Click Start Monitoring.
- Click "Select Death ROI From Screen" while the Rust death screen is visible to draw a rectangle over a stable area of the death UI. The app will compare that ROI each frame to detect when it reappears.

Global Key Monitoring (Map key)
- The app attempts to load `iohook` to capture the G key while Rust is in focus. If `iohook` is not installed, the UI will note this and only death detection will function. To enable it: `npm i iohook` (requires native build tools). Key code is currently hard-coded to G.

Packaging
- Uses `electron-builder`. Run `npm run dist` to create the NSIS installer for Windows.

Files
- `src/main/*` – main process, OBS client, preload, key monitoring.
- `src/renderer/*` – UI and death detection via screen capture + ROI comparison.
- `assets/` – put custom icons and any future assets here.

Notes
- This repo started from an idea to prototype the workflow. We can extend with better template matching (OpenCV.js), configurable key capture, and polished UI.

