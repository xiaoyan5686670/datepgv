@echo off
REM Start FastAPI backend on Windows

setlocal

REM Change to repo root (directory of this script)
cd /d "%~dp0"

REM Create virtual environment if it does not exist
if not exist "backend\.venv" (
    echo [backend] Creating Python virtual environment...
    python -m venv "backend\.venv"
)

REM Activate virtual environment
call "backend\.venv\Scripts\activate.bat"

REM Install dependencies
echo [backend] Installing Python dependencies...
pip install -r "backend\requirements.txt"

REM Copy env file if needed (expects .env.example in repo root)
if not exist "backend\.env" (
    if exist ".env.example" (
        echo [backend] Creating backend\.env from .env.example. Please edit values as needed.
        copy /Y ".env.example" "backend\.env" >nul
    ) else (
        echo [backend] WARNING: backend\.env not found and .env.example missing. Please create backend\.env manually.
    )
)

echo [backend] Starting FastAPI server on http://localhost:8000 ...
cd /d "%~dp0backend"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

endlocal

