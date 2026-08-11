@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not available. You can still open index.html directly.
  pause
  exit /b 1
)
node "%~dp0build\start-local-server.js"
if errorlevel 1 pause
