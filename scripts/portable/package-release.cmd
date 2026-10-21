@echo off
setlocal
cd /d "%~dp0..\.."
call npm.cmd run package:release -- %*
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
