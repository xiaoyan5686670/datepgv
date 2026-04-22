@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PYTHONHOME="
set "PYTHONPATH="

echo [oneclick] Checking required tools...
set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    )
)
if not defined PYTHON_CMD (
    echo [oneclick] ERROR: Python not found in PATH.
    echo [oneclick] Install Python 3.11+ and enable "Add Python to PATH".
    pause
    exit /b 1
)
echo [oneclick] Python command: %PYTHON_CMD%
%PYTHON_CMD% -c "import sys; print(sys.version)"
if errorlevel 1 (
    echo [oneclick] ERROR: Python runtime is broken.
    echo [oneclick] Please reinstall Python from python.org and restart terminal.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [oneclick] ERROR: Node.js not found in PATH.
    echo [oneclick] Install Node.js 18+.
    pause
    exit /b 1
)
for /f "tokens=1 delims=." %%i in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%i"
if defined NODE_MAJOR (
    if %NODE_MAJOR% GEQ 24 (
        echo [oneclick] WARNING: Node.js v%NODE_MAJOR% detected. Recommended LTS is 18/20/22 for best compatibility.
    )
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [oneclick] ERROR: npm not found in PATH.
    pause
    exit /b 1
)

if not exist "backend\.env" (
    if exist ".env" (
        echo [oneclick] Creating backend\.env from .env ...
        copy /Y ".env" "backend\.env" >nul
    ) else if exist ".env.example" (
        echo [oneclick] Creating backend\.env from .env.example ...
        copy /Y ".env.example" "backend\.env" >nul
        echo [oneclick] Please edit backend\.env if DATABASE_URL/API KEY is not configured.
    ) else (
        echo [oneclick] WARNING: No .env/.env.example found. Create backend\.env manually.
    )
)

if not exist "backend\.venv" (
    echo [oneclick] Creating backend virtual environment...
    %PYTHON_CMD% -m venv "backend\.venv"
    if errorlevel 1 (
        echo [oneclick] ERROR: Failed to create backend virtual environment.
        echo [oneclick] Tip: run "set PYTHONHOME=" and "set PYTHONPATH=" in CMD, then retry.
        pause
        exit /b 1
    )
)

echo [oneclick] Installing backend dependencies...
call "backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [oneclick] ERROR: Failed to activate backend virtual environment.
    pause
    exit /b 1
)
python -m pip install --upgrade pip
python -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
    echo [oneclick] ERROR: Backend dependency installation failed.
    pause
    exit /b 1
)

echo [oneclick] Installing frontend dependencies...
pushd "frontend"
npm install
if errorlevel 1 (
    popd
    echo [oneclick] ERROR: Frontend dependency installation failed.
    pause
    exit /b 1
)
popd

if not exist "frontend\.next\BUILD_ID" (
    echo [oneclick] Building frontend production bundle...
    pushd "frontend"
    npm run build
    if errorlevel 1 (
        popd
        echo [oneclick] ERROR: Frontend build failed.
        pause
        exit /b 1
    )
    popd
)

echo [oneclick] Starting backend window...
start "datepgv-backend" cmd /k "cd /d \"%ROOT%backend\" && call \"%ROOT%backend\.venv\Scripts\activate.bat\" && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [oneclick] Waiting backend to initialize...
timeout /t 4 /nobreak >nul

echo [oneclick] Starting frontend window...
start "datepgv-frontend" cmd /k "cd /d \"%ROOT%frontend\" && npm run start"

echo [oneclick] datepgv is starting.
echo [oneclick] Open: http://localhost:3000
start "" "http://localhost:3000"
endlocal
