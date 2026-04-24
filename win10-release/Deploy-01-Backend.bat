@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"
set "PYTHONHOME="
set "PYTHONPATH="

echo [deploy-01] Repo root: !ROOT!

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo [deploy-01] ERROR: Python not found. Install Python 3.11+ and add to PATH.
    exit /b 1
)
echo [deploy-01] Using: !PYTHON_CMD!

if not exist "backend\.env" (
    if exist ".env" (
        echo [deploy-01] Copying .env to backend\.env ...
        copy /Y ".env" "backend\.env" >nul
    ) else if exist ".env.example" (
        echo [deploy-01] Copying .env.example to backend\.env ...
        copy /Y ".env.example" "backend\.env" >nul
    ) else (
        echo [deploy-01] WARNING: No .env or .env.example; create backend\.env with DATABASE_URL.
    )
)

if not exist "backend\.venv" (
    echo [deploy-01] Creating backend\.venv ...
    !PYTHON_CMD! -m venv "backend\.venv"
    if errorlevel 1 (
        echo [deploy-01] ERROR: Failed to create venv.
        exit /b 1
    )
)

call "backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [deploy-01] ERROR: Failed to activate venv.
    exit /b 1
)

echo [deploy-01] pip install -r backend\requirements.txt ...
python -m pip install --upgrade pip -q
python -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
    echo [deploy-01] ERROR: pip install failed.
    exit /b 1
)

echo [deploy-01] OK: backend environment ready.
endlocal
exit /b 0
