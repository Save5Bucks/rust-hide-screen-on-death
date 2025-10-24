// Ensure Electron is not forced to run as Node
try { delete process.env.ELECTRON_RUN_AS_NODE; } catch (_) {}

const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false
});

child.on('exit', (code) => process.exit(code || 0));

