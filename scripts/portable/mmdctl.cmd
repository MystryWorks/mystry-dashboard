@echo off
setlocal
if not defined MMD_HOME set "MMD_HOME=%~dp0"
if not "%MMD_HOME:~-1%"=="\" set "MMD_HOME=%MMD_HOME%\"
if not defined MMD_CONFIG_PATH set "MMD_CONFIG_PATH=%MMD_HOME%config\panel.env"
if not defined MMD_DATA_DIR set "MMD_DATA_DIR=%MMD_HOME%data"
"%MMD_HOME%runtime\node.exe" --experimental-sqlite "%MMD_HOME%app\mmdctl.mjs" %*
exit /b %ERRORLEVEL%
