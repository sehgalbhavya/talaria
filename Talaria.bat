@echo off
title Talaria
cd /d "%~dp0"
set "URL=http://127.0.0.1:5178"

rem Already running? Just open it.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/api/bootstrap' | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Talaria is already running - opening it.
  start "" "%URL%"
  exit /b 0
)

rem The first time, or when something Talaria needs is missing, a setup window lists it and installs it
rem once you press Install. When everything is in place this returns straight away.
echo Checking what Talaria needs...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup didn't finish, so Talaria can't start yet. Double-click Talaria.bat to pick it up again.
  echo What happened is saved in data\setup-log.txt.
  pause
  exit /b 1
)

rem Talaria's own copy of Node.js (from setup) and Hermes come first.
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
if exist "%LOCALAPPDATA%\hermes\bin\hermes.exe" set "PATH=%LOCALAPPDATA%\hermes\bin;%PATH%"

rem Install packages the first time, and again whenever an update changed them
rem (package-lock.json newer than the last install). npm ci installs exactly what the
rem lockfile says and never edits tracked files, so the next update still pulls cleanly.
set "NEEDS_INSTALL=0"
if not exist "node_modules\.package-lock.json" set "NEEDS_INSTALL=1"
if "%NEEDS_INSTALL%"=="0" (
  powershell -NoProfile -Command "if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.package-lock.json').LastWriteTime) { exit 1 } else { exit 0 }"
  if errorlevel 1 set "NEEDS_INSTALL=1"
)
if "%NEEDS_INSTALL%"=="1" (
  echo Installing the packages Talaria needs, one moment...
  call npm ci --no-audit --no-fund || goto :fail
)

echo Building the app...
call npx vite build --logLevel warn || goto :fail

rem Open the browser only once the server is actually answering (up to 90s).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 90; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/api/bootstrap' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 1 } }"

echo.
echo   Starting Talaria at %URL% - your browser opens as soon as it's ready.
echo   Keep this window open while you use it. Close it to stop.
echo.
call npx tsx server/index.ts
goto :eof

:fail
echo.
echo Something went wrong starting Talaria. See the messages above.
pause
