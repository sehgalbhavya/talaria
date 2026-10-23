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

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install --no-audit --no-fund || goto :fail
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
