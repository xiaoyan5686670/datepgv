@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo.
echo [DEPRECATED] package_win10.bat has been removed from the supported release flow.
echo.
echo Use one of:
echo   - Publish-Win10-Artifact.bat   (Windows^)
echo   - python scripts\publish_win10_artifact.py
echo   - scripts\publish_win10_artifact.sh   (macOS / Linux^)
echo.
echo See README.WINDOWS.md or README.WINDOWS.zh.md
echo.
pause
endlocal
exit /b 1
