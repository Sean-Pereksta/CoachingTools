@echo off
setlocal
title CoachTools - Your launchpad
color 0F
if not exist "%~dp0build\open-coachtools.ps1" (
  echo Please extract the entire CoachTools ZIP before making your shortcut.
  echo Open the extracted CoachTools folder and run OPEN COACHTOOLS.bat again.
  pause
  exit /b 1
)
if not exist "%~dp0build\coachtools-launcher-ui.ps1" (
  echo CoachTools setup files are missing. Please extract the entire CoachTools ZIP.
  echo Open the extracted CoachTools folder and run OPEN COACHTOOLS.bat again.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\open-coachtools.ps1" %*
set "launchExit=%errorlevel%"
if not "%launchExit%"=="0" pause
exit /b %launchExit%
