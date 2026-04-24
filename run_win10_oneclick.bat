@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo.
echo [DEPRECATED] run_win10_oneclick.bat is not supported.
echo Use: win10-release\Deploy-All.bat  then  win10-release\Start-Services.bat
echo See README.WINDOWS.zh.md
echo.
pause
endlocal
exit /b 1
