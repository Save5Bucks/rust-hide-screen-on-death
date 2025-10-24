# Copilot Instructions for Rust OBS Scene Toggle Helper

## Project Architecture
- **Electron app**: Main logic in `src/main/` (entry: `main.js`). Renderer UI in `src/renderer/`.
- **OBS Integration**: Communicates with OBS via `obs-websocket-js` (v5). Connection details and scene selection handled in UI.
- **Death Detection**: Uses screen capture and ROI comparison to detect Rust death screen. ROI selection is user-driven via UI.
- **Global Key Monitoring**: Optional `iohook` integration for capturing the Rust map key (G). If unavailable, only death detection is used.

## Key Files & Directories
- `src/main/main.js`: Electron main process, OBS connection, IPC.
- `src/main/obsClient.js`: OBS websocket logic, scene switching.
- `src/main/preload.js`: IPC bridge for renderer.
- `src/renderer/renderer.js`: UI logic, ROI selection, monitoring controls.
- `scripts/`: Utility scripts for build/test/dev.
- `start.bat`: Windows launch script.

## Developer Workflows
- **Install dependencies**: `npm install`
- **Start app (dev)**: `npm start` or `npm start -- --dev` (enables DevTools)
- **Build installer**: `npm run dist`
- **Build AppX (Windows Store)**: `npm run dist:appx`
- **Enable iohook**: `npm i iohook` (native build tools required)

## Security & Best Practices
- Never commit credentials - use environment variables or secure storage
- DevTools only open when `NODE_ENV=development` or `--dev` flag is set
- CSP policy restricts websocket connections to `ws://localhost:*` and `ws://127.0.0.1:*`
- All OpenCV Mat objects must be deleted in finally blocks to prevent memory leaks
- Input validation required for all user-provided values (ports, coordinates, thresholds)

## Conventions & Patterns
- Scene names and OBS connection details are user-configurable via UI.
- ROI selection for death detection is manual; code expects a stable UI region.
- All OBS communication uses obs-websocket v5 protocol.
- Key monitoring is only active if `iohook` is installed and loaded.
- Electron IPC is used for main/renderer communication.
- **Error handling**: All async operations include try-catch blocks with proper error logging.
- **Input validation**: Port numbers, ROI coordinates, and thresholds validated before use.
- **Memory management**: OpenCV Mats properly disposed in finally blocks; cleanup on window unload.
- **Constants**: Magic numbers extracted (e.g., `DEATH_DETECT_INTERVAL_MS`, `DEATH_DETECT_COOLDOWN_MS`).

## Integration Points
- **OBS**: Requires obs-websocket v5 enabled (default port 4455). CSP restricts connections to localhost only.
- **iohook**: Optional, for global key capture.
- **OpenCV.js**: Loaded from CDN for template matching-based death detection.

## Example: Scene Switch Logic
- On death detection (ROI match), switch to the configured "Death" scene via OBS websocket.
- On map key (G) press, switch to "Map" scene if enabled.

## Troubleshooting
- If `iohook` fails to load, app will notify in UI; only death detection will work.
- For AppX packaging, update `package.json` `build.appx` fields and provide `build/icon.ico`.

---
_Review and suggest edits if any section is unclear or missing important project-specific details._
