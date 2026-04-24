@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"

echo [deploy-02] Repo root: %ROOT%

where node >nul 2>nul
if errorlevel 1 (
    echo [deploy-02] ERROR: Node.js not found. Install Node.js 18+.
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [deploy-02] ERROR: npm not found.
    exit /b 1
)

echo [deploy-02] npm install ...
pushd "frontend"
call npm install
if errorlevel 1 (
    popd
    echo [deploy-02] ERROR: npm install failed.
    exit /b 1
)

echo [deploy-02] npm run build ...
call npm run build
if errorlevel 1 (
    popd
    echo [deploy-02] ERROR: npm run build failed.
    exit /b 1
)
popd

echo [deploy-02] OK: frontend production build ready.
endlocal
exit /b 0
