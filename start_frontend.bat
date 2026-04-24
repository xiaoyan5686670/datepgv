@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%frontend"

echo [frontend] Starting Next.js on 0.0.0.0:3000 ^(use http://THIS_PC_LAN_IP:3000 from other machines^) ...
npm run start

echo [frontend] Server exited.
pause
