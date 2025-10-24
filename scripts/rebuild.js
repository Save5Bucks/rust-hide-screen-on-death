/* Rebuild native modules for the current Electron version. */
const path = require('path');

async function main() {
  let electronVersion;
  try {
    electronVersion = require('electron/package.json').version;
  } catch (e) {
    electronVersion = process.env.ELECTRON_VERSION || (process.versions && process.versions.electron);
  }
  if (!electronVersion) {
    // Fallback to latest devDependency we target
    electronVersion = '38.4.0';
  }

  console.log('Rebuilding native modules for Electron', electronVersion);
  const { rebuild } = require('@electron/rebuild');
  try {
    // Filter only modules that are actually installed
    const fs = require('fs');
    const pathJoin = (...a) => path.resolve(__dirname, '..', ...a);
    const candidates = ['uiohook-napi', 'iohook'];
    const onlyModules = candidates.filter((m) => fs.existsSync(pathJoin('node_modules', m)));
    await rebuild({
      buildPath: path.resolve(__dirname, '..'),
      electronVersion,
      force: true,
      onlyModules
    });
    console.log('rebuild done');
  } catch (e) {
    console.error('rebuild error:', e && e.message ? e.message : e);
    // Do not hard fail — user can still run without hooks
  }
}

main();
