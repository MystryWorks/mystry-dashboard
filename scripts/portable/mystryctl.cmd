@echo off
setlocal
if not defined MYSTRY_HOME set "MYSTRY_HOME=%~dp0"
if not "%MYSTRY_HOME:~-1%"=="\" set "MYSTRY_HOME=%MYSTRY_HOME%\"
if not defined MYSTRY_CONFIG_PATH set "MYSTRY_CONFIG_PATH=%MYSTRY_HOME%config\panel.env"
if not defined MYSTRY_DATA_DIR set "MYSTRY_DATA_DIR=%MYSTRY_HOME%data"
"%MYSTRY_HOME%runtime\node.exe" --experimental-sqlite "%MYSTRY_HOME%app\mystryctl.mjs" %*
exit /b %ERRORLEVEL%
