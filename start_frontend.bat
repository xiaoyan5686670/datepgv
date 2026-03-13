@echo off
REM Start Next.js frontend on Windows

setlocal

REM Change to repo root (directory of this script)
cd /d "%~dp0"

REM Go to frontend directory
cd /d "%~dp0frontend"

REM Install Node dependencies if node_modules is missing
if not exist "node_modules" (
    echo [frontend] Installing Node.js dependencies...
    npm install
)

echo [frontend] Starting Next.js dev server on http://localhost:3000 ...
npm run dev

endlocal

