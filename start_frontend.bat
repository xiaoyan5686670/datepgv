@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%frontend"

echo [frontend] Starting Next.js production server on http://localhost:3000 ...
npm run start

echo [frontend] Server exited.
pause
