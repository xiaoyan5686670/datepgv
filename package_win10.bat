@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "DIST_ROOT=%ROOT%dist"
set "PKG_NAME=datepgv-win10-oneclick"
set "PKG_DIR=%DIST_ROOT%\%PKG_NAME%"
set "ZIP_PATH=%DIST_ROOT%\%PKG_NAME%.zip"

echo [package] Preparing output folder...
if not exist "%DIST_ROOT%" mkdir "%DIST_ROOT%"
if exist "%PKG_DIR%" rmdir /s /q "%PKG_DIR%"
mkdir "%PKG_DIR%"

echo [package] Copying backend...
robocopy "%ROOT%backend" "%PKG_DIR%\backend" /E /XD .venv .tmp_req_check __pycache__ .pytest_cache >nul

echo [package] Copying frontend...
robocopy "%ROOT%frontend" "%PKG_DIR%\frontend" /E /XD node_modules .next >nul

echo [package] Copying root files...
if exist "%ROOT%.env" (
    copy /Y "%ROOT%.env" "%PKG_DIR%\" >nul
) else (
    copy /Y "%ROOT%.env.example" "%PKG_DIR%\" >nul
)
if exist "%ROOT%.env.example" copy /Y "%ROOT%.env.example" "%PKG_DIR%\" >nul
copy /Y "%ROOT%run_win10_oneclick.bat" "%PKG_DIR%\" >nul
copy /Y "%ROOT%run_win10_onclick.bat" "%PKG_DIR%\" >nul
copy /Y "%ROOT%README.WINDOWS.md" "%PKG_DIR%\" >nul

if exist "%PKG_DIR%\frontend\package-lock.json" (
    rem keep as is
) else (
    if exist "%ROOT%frontend\package-lock.json" copy /Y "%ROOT%frontend\package-lock.json" "%PKG_DIR%\frontend\" >nul
)

echo [package] Creating zip...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%ZIP_PATH%') { Remove-Item -Force '%ZIP_PATH%' }; Compress-Archive -Path '%PKG_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 (
    echo [package] WARNING: zip failed. Folder package is still available:
    echo [package] %PKG_DIR%
    pause
    exit /b 1
)

echo [package] Done.
echo [package] Folder: %PKG_DIR%
echo [package] Zip: %ZIP_PATH%
endlocal
