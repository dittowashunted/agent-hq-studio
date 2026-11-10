@echo off
rem Double-click to open Agent HQ. Starts it in the background if it is not running, then opens the dashboard signed in.
setlocal
set "ROOT=%~dp0.."
set "TOKEN_FILE=%ROOT%\.agent-hq\owner-token"

where node >nul 2>nul || (echo Node.js is not installed or not on PATH. Install it from https://nodejs.org and try again. & pause & exit /b 1)

rem Update to the newest version first (quick; carries on with the current one when offline). Only does anything in the app copy.
if exist "%~dp0agent-hq-update.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-hq-update.ps1"

wscript.exe "%~dp0agent-hq-hidden.vbs"

rem Wait up to 15 s for HQ to answer and for the owner token to exist (first start creates it).
for /l %%i in (1,1,30) do (
  if exist "%TOKEN_FILE%" (
    powershell -NoProfile -Command "try { (Invoke-WebRequest 'http://127.0.0.1:4317/api/health' -UseBasicParsing -TimeoutSec 1).StatusCode } catch { 0 }" | findstr /x "200" >nul && goto open
  )
  timeout /t 1 /nobreak >nul
)
echo Agent HQ did not start. See "%ROOT%\.agent-hq\logs\server.log".
pause
exit /b 1

:open
set /p TOKEN=<"%TOKEN_FILE%"
start "" "http://127.0.0.1:4317/#owner=%TOKEN%"
endlocal
