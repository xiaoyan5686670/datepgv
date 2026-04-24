@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PYTHONHOME="
set "PYTHONPATH="

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo [backend] ERROR: Python not found. Install Python 3.11+ and add to PATH.
    pause
    exit /b 1
)

if not exist "%ROOT%backend\.venv" (
    echo [backend] Creating virtual environment...
    %PYTHON_CMD% -m venv "%ROOT%backend\.venv"
    if errorlevel 1 (
        echo [backend] ERROR: Failed to create venv.
        pause
        exit /b 1
    )
)

call "%ROOT%backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [backend] ERROR: Failed to activate venv.
    pause
    exit /b 1
)

echo [backend] Installing / verifying dependencies...
python -m pip install --upgrade pip -q
python -m pip install -r "%ROOT%backend\requirements.txt" -q
if errorlevel 1 (
    echo [backend] ERROR: pip install failed.
    pause
    exit /b 1
)

cd /d "%ROOT%backend"
echo [backend] Starting FastAPI on http://0.0.0.0:8000 ...
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

echo [backend] Server exited.
pause
