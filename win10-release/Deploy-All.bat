@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"

echo [deploy-all] Running Deploy-01-Backend ...
call "%~dp0Deploy-01-Backend.bat"
if errorlevel 1 (
    echo [deploy-all] FAILED at Deploy-01.
    pause
    exit /b 1
)

echo [deploy-all] Running Deploy-02-Frontend ...
call "%~dp0Deploy-02-Frontend.bat"
if errorlevel 1 (
    echo [deploy-all] FAILED at Deploy-02.
    pause
    exit /b 1
)

echo [deploy-all] Running Deploy-03-Database ...
call "%~dp0Deploy-03-Database.bat"
if errorlevel 1 (
    echo [deploy-all] FAILED at Deploy-03.
    pause
    exit /b 1
)

echo [deploy-all] OK. Next: double-click Start-Services.bat in win10-release\
pause
endlocal
exit /b 0
