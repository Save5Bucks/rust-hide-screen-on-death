# Copilot Instructions for Rust OBS Scene Toggle Helper

```md
# Copilot instructions — Rust OBS Scene Toggle Helper (concise)

Purpose: help an AI coding agent be immediately productive in this Electron app that auto-switches OBS scenes on Rust "death" and map key events.

Architecture (big picture)
- Electron app with two processes: main (native integrations & OBS client) and renderer (UI + ROI selection). See `src/main/` and `src/renderer/`.
- OBS integration is via obs-websocket v5; scene control happens in `src/main/obsClient.js` and is triggered through IPC from the renderer.
- Death detection runs in the renderer using screen capture + template/ROI matching (OpenCV.js loaded from CDN). ROI selection and thresholds are user-configured in the UI.

Key files to inspect or modify
- `src/main/main.js` — app lifecycle, background tasks, and global handlers.
- `src/main/obsClient.js` — websocket connect/reconnect, authentication, and scene switch helpers. Start here for OBS logic changes.
- `src/main/preload.js` — secure IPC bridge (exposes limited APIs to renderer). Follow patterns here for new renderer→main APIs.
- `src/renderer/renderer.js` & `src/renderer/index.html` — UI, ROI selection, death detection triggers and sending IPC messages.
- `scripts/` and `start.bat` — dev helpers and Windows launch; `package.json` scripts control start/dist commands.

How to run (developer commands)
- Install: npm install
- Dev run: npm start  (add `-- --dev` to enable DevTools window)
# Copilot instructions — Rust OBS Scene Toggle Helper

Purpose: help an AI coding agent be immediately productive in this Electron app that auto-switches OBS scenes on Rust "death" and reacts to map key events.

High-level architecture
- Electron split: `main` (native integrations, OBS websocket client) and `renderer` (UI, ROI selection, death detection). See `src/main/` and `src/renderer/`.
- OBS control is centralized in `src/main/obsClient.js`. Renderer sends IPC messages; `src/main/main.js` handles lifecycle and IPC listeners.
- Death/ROI detection runs in the renderer using screen capture + template/ROI matching with OpenCV.js (loaded from CDN in `index.html`). Detection parameters are configurable in the UI.

Key files to inspect (quick reference)
- `src/main/obsClient.js` — connect/reconnect, auth, and functions that switch scenes. Single source of truth for OBS operations.
- `src/main/main.js` — IPC handlers, app lifecycle, background tasks, and fallback logic when native hooks fail.
- `src/main/preload.js` — secure IPC bridge; expose only limited APIs to renderer. Follow this pattern for any new renderer→main APIs.
- `src/renderer/renderer.js` & `src/renderer/index.html` — ROI selection, detection loop, OpenCV usage, and sending IPC commands to switch scenes.
- `scripts/rebuild.js`, `start.bat`, `package.json` — dev helpers and packaging/build commands.

Concrete developer workflows
- Install deps: `npm install` (Windows users may need to run a shell with required native build tools for optional native modules).
- Dev run: `npm start` (append `-- --dev` to open DevTools). Use `NODE_ENV=development` for dev-only checks in code.
- Build/distribute: `npm run dist` (general packaging) and `npm run dist:appx` (AppX packaging on Windows if configured).
- Native optional: `iohook` is optional (used for global key hooks). If added, run `npm i iohook` and then `node scripts/rebuild.js` on Windows. The app must still run without iohook; code features detect its presence.

Project-specific patterns & gotchas
- IPC-first: never call OBS from the renderer. Always send a small, validated IPC message to `main` which then calls `obsClient`.
- OBS v5 assumptions: code expects obs-websocket v5 protocol. Use localhost-only WS connection (CSP allows `ws://localhost:*`). Mock obsClient in tests.
- OpenCV.js lifecycle: all Mats must be released explicitly (see detection code in `renderer.js`). Use try/finally and call `mat.delete()` to avoid memory leaks.
- Feature detection/fallbacks: the app tolerates missing native modules (iohook). Add graceful fallbacks and avoid hard crashes on require failures.
- Config in UI: scene names, OBS host/port, ROI coordinates, and thresholds are stored via the renderer UI; prefer adding settings to the UI rather than hardcoding.

Testing and CI notes
- Renderer image-processing depends on OpenCV.js loaded from CDN — in CI or offline runs, stub OpenCV APIs or mock the detection loop.`
- For unit tests, mock the `obsClient` methods or the IPC channel so scene switching can be asserted without a running OBS instance.

Examples (where to change behavior)
- Change scene switching: update `obsClient.switchScene()` and the IPC handler in `src/main/main.js` that listens for e.g. `ipcMain.on('switch-scene', ...)`.
- Tune detection timing: search for constants like `DEATH_DETECT_INTERVAL_MS` and `DEATH_DETECT_COOLDOWN_MS` in `src/renderer/renderer.js`.

Rules for agents & contributors
- Do not commit secrets (OBS passwords, tokens). Use environment variables and document required env vars in `README.md`.
- Follow the `preload.js` pattern to expose only minimal, validated IPC APIs to the renderer. Avoid adding broad Node exposures.
- When introducing native deps (iohook), update `scripts/rebuild.js` and mention Windows-specific rebuild steps in PR notes.

If you want this expanded into a step-by-step developer guide (signing, AppX packaging, or CI stubbing of OpenCV), tell me which area to expand and I'll draft it.

