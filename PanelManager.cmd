@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\panel-manager.ps1" %*
set "PANEL_MANAGER_EXIT=%ERRORLEVEL%"

exit /b %PANEL_MANAGER_EXIT%
