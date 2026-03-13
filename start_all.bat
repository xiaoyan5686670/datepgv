@echo off
REM Start PostgreSQL (if using Docker), backend, and frontend on Windows

setlocal

cd /d "%~dp0"

echo [all] Starting backend in a new window...
start "datepgv-backend" cmd /k "%~dp0start_backend.bat"

REM Small delay to let backend start
timeout /t 5 /nobreak >nul

echo [all] Starting frontend in a new window...
start "datepgv-frontend" cmd /k "%~dp0start_frontend.bat"

echo [all] All services are starting. You can open http://localhost:3000 in your browser.

endlocal

