@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"

echo [oneclick-full] Root: !ROOT!
echo [oneclick-full] This script will FORCE rebuild database and auto-handle vector extension.
echo.

set "FORCE_BOOTSTRAP_DB=1"
set "BOOTSTRAP_SUPERUSER_EXTENSION=1"

if not defined BOOTSTRAP_SUPERUSER_NAME set "BOOTSTRAP_SUPERUSER_NAME=postgres"
set /p BOOTSTRAP_SUPERUSER_NAME="[oneclick-full] Superuser name (default postgres): "
if "!BOOTSTRAP_SUPERUSER_NAME!"=="" set "BOOTSTRAP_SUPERUSER_NAME=postgres"

echo [oneclick-full] Superuser role: !BOOTSTRAP_SUPERUSER_NAME!
echo [oneclick-full] Password will be prompted securely by Python during DB restore.
echo.

echo [oneclick-full] Step 1/4 Deploy backend ...
call "%~dp0Deploy-01-Backend.bat"
if errorlevel 1 goto fail1

echo [oneclick-full] Step 2/4 Deploy frontend ...
call "%~dp0Deploy-02-Frontend.bat"
if errorlevel 1 goto fail2

echo [oneclick-full] Step 3/4 Deploy database (force rebuild) ...
call "%~dp0Deploy-03-Database.bat"
if errorlevel 1 goto fail3

echo [oneclick-full] Step 4/4 Start services ...
call "%~dp0Start-Services.bat"
if errorlevel 1 goto fail4

echo.
echo [oneclick-full] SUCCESS. Application should be available at http://localhost:3000
pause
endlocal
exit /b 0

:fail1
echo.
echo [oneclick-full] FAILED: Deploy-01-Backend.bat
pause
endlocal
exit /b 1

:fail2
echo.
echo [oneclick-full] FAILED: Deploy-02-Frontend.bat
pause
endlocal
exit /b 1

:fail3
echo.
echo [oneclick-full] FAILED: Deploy-03-Database.bat
pause
endlocal
exit /b 1

:fail4
echo.
echo [oneclick-full] FAILED: Start-Services.bat
pause
endlocal
exit /b 1
