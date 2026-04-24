@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"
set "PYTHONHOME="
set "PYTHONPATH="

echo [start] Repo root: !ROOT!

if not exist "backend\.venv\Scripts\activate.bat" (
    echo [start] ERROR: backend\.venv missing. Run Deploy-01-Backend.bat first.
    pause
    exit /b 1
)
if not exist "frontend\.next\BUILD_ID" (
    echo [start] ERROR: frontend build missing. Run Deploy-02-Frontend.bat first.
    pause
    exit /b 1
)

echo [start] Validating config (venv Python^) ...
call "!ROOT!\backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [start] ERROR: Failed to activate backend\.venv
    pause
    exit /b 1
)
python "!ROOT!\scripts\validate_embedded_config.py"
if errorlevel 1 (
    echo [start] ERROR: validate_embedded_config.py failed.
    pause
    exit /b 1
)

echo [start] Launching backend in a new window ...
start "datepgv-backend" cmd /k call "!ROOT!\start_backend.bat"

echo [start] Waiting for http://127.0.0.1:8000/health ...
set "BACKEND_OK=0"
for /L %%i in (1,1,60) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2;if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}" >nul 2>nul
    if not errorlevel 1 (
        set "BACKEND_OK=1"
        goto backend_ready
    )
    timeout /t 1 /nobreak >nul
)
:backend_ready
if "!BACKEND_OK!"=="0" (
    echo [start] WARNING: Backend did not respond within 60s. Check the datepgv-backend window.
    pause
)

echo [start] Launching frontend in a new window ...
start "datepgv-frontend" cmd /k call "!ROOT!\start_frontend.bat"

echo [start] Open http://localhost:3000 in browser ...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
endlocal
exit /b 0
