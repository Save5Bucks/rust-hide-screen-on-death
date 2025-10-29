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
- Build: npm run dist
- AppX (Windows store): npm run dist:appx
- Native optional dependency: `iohook` requires native build tools; install with `npm i iohook` and document rebuild steps in PR notes.

Repository conventions & patterns
- IPC is the approved cross-process pattern. Use `preload.js` to add a safe channel; avoid exposing Node in the renderer.
- All OBS operations should go through `obsClient.js` (single responsibility). Avoid duplicating OBS connection logic in other files.
- OpenCV Mats are explicitly cleaned up — any image processing must free Mats in finally blocks to prevent leaks.
- Config/state: scene names, OBS host/port, ROI coords, and thresholds are user-configurable via the renderer; prefer adding new settings to the UI rather than hardcoding.
- Feature flags & dev tools: DevTools open only in dev mode (NODE_ENV=development or `--dev`). Preserve this check when adding debug helpers.

Integration notes & gotchas
- OBS websocket: expect v5 protocol and localhost-only connections (CSP restricts to `ws://localhost:*`). Tests should mock websocket interactions where possible.
- iohook: optional. If it fails (common on CI or without native toolchain), the app should still work using only death-detection. Add graceful fallbacks in feature-detection code paths.
- OpenCV.js: loaded from CDN in renderer; offline or CI runs need stubbing/mocks for tests.

Small examples / where to look
- To change scene-switch behavior, search `obsClient` and the IPC handler in `main.js` that listens for renderer messages.
- To tune detection timing, search the repo for `DEATH_DETECT_INTERVAL_MS` / `DEATH_DETECT_COOLDOWN_MS` (constants are used in detection loops).

Bots & contributor rules
- Do not add or commit secrets (OBS auth tokens, passwords). Use environment variables and document them in README when required.
- When adding native deps (iohook), update README and `scripts/rebuild.js` if necessary and mention Windows-specific build steps in PR body.

If anything is unclear or you want this expanded into a longer developer guide (commands for signing, installer options, or AppX packing checklist), tell me which section to expand.

```

