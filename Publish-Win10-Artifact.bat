@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo [publish] ERROR: Python not found.
    pause
    exit /b 1
)

"%PYTHON_CMD%" "%~dp0scripts\publish_win10_artifact.py" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo [publish] FAILED rc=%RC%
    pause
)
exit /b %RC%
