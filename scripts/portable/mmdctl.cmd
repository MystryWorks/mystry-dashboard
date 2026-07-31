@echo off
setlocal
set "MMD_HOME=%~dp0"
if not defined MMD_CONFIG_PATH set "MMD_CONFIG_PATH=%~dp0config\panel.env"
if not defined MMD_DATA_DIR set "MMD_DATA_DIR=%~dp0data"
"%~dp0runtime\node.exe" --experimental-sqlite "%~dp0app\mmdctl.mjs" %*
exit /b %ERRORLEVEL%
