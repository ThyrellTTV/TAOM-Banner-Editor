@echo off
if exist "%~dp0app\TAOM Banner Studio.exe" (
  start "" "%~dp0app\TAOM Banner Studio.exe"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-in-browser.ps1"
)
