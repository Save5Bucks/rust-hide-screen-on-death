@echo off
setlocal ENABLEEXTENSIONS
cd /d "%~dp0"

rem Simple runner: install deps, rebuild hooks, then launch
set "ELECTRON_RUN_AS_NODE="
set "npm_config_msvs_version=2022"
set "GYP_MSVS_VERSION=2022"

echo Installing dependencies (npm ci || npm install)...
call npm ci || call npm install --no-audit || echo WARN: npm install had issues

echo Rebuilding native modules (npm run build)...
call npm run build || echo WARN: rebuild failed; continuing

echo Launching app (npm start)...
call npm start
exit /b %ERRORLEVEL%
