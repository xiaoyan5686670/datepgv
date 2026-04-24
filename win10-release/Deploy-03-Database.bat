@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"

echo [deploy-03] Repo root: !ROOT!

REM Avoid picking up a different interpreter via env (fixes wrong site-packages)
set "PYTHONHOME="
set "PYTHONPATH="

if not exist "backend\.venv\Scripts\activate.bat" (
    echo [deploy-03] ERROR: backend\.venv missing or incomplete. Run Deploy-01-Backend.bat first.
    exit /b 1
)

if not exist "backend\.env" (
    if exist ".env" (
        copy /Y ".env" "backend\.env" >nul
    ) else if exist ".env.example" (
        copy /Y ".env.example" "backend\.env" >nul
    )
)

if /i "!SKIP_BOOTSTRAP_DB!"=="1" (
    echo [deploy-03] SKIP_BOOTSTRAP_DB=1 -- skipping database restore.
    endlocal
    exit /b 0
)

set "RESTORE_EXTRA="
if /i "!BOOTSTRAP_SUPERUSER_EXTENSION!"=="1" (
    set "RESTORE_EXTRA=--superuser-extension"
    echo [deploy-03] BOOTSTRAP_SUPERUSER_EXTENSION=1: postgres superuser will create extension vector if needed ^(password prompt^).
)

echo [deploy-03] Activating venv and ensuring backend packages (asyncpg, sqlparse, dotenv^) ...
call "!ROOT!\backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [deploy-03] ERROR: Failed to activate backend\.venv
    exit /b 1
)

python -m pip install --upgrade pip -q
python -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
    echo [deploy-03] ERROR: pip install -r backend\requirements.txt failed.
    exit /b 1
)

python -c "import asyncpg, sqlparse; print('[deploy-03] OK: imports asyncpg, sqlparse')"
if errorlevel 1 (
    echo [deploy-03] ERROR: Python cannot import asyncpg after pip install. Check backend\.venv and PYTHONHOME.
    exit /b 1
)

echo [deploy-03] Restoring db-bootstrap snapshot ...
if /i "!FORCE_BOOTSTRAP_DB!"=="1" (
    python "!ROOT!\scripts\restore_bootstrap_db.py" --force !RESTORE_EXTRA!
) else (
    python "!ROOT!\scripts\restore_bootstrap_db.py" !RESTORE_EXTRA!
)
if errorlevel 1 (
    echo [deploy-03] ERROR: restore_bootstrap_db.py failed. Is PostgreSQL running? Is DATABASE_URL correct?
    exit /b 1
)

echo [deploy-03] OK: database restore finished.
endlocal
exit /b 0
