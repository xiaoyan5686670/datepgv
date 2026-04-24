# Win10 发布物 — 脚本全文（备份 / 审计）

仓库内已存在同名正式文件：`win10-release/*.bat`、`Publish-Win10-Artifact.bat`、`scripts/publish_win10_artifact.py`、`scripts/publish_win10_artifact.sh`。本文档为**内容镜像**，便于 diff 与离线恢复。所有 **`.bat` 在仓库中应为 CRLF**（见 [.gitattributes](../.gitattributes)）。

---

## `win10-release/Deploy-01-Backend.bat`

```bat
@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"
set "PYTHONHOME="
set "PYTHONPATH="

echo [deploy-01] Repo root: !ROOT!

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo [deploy-01] ERROR: Python not found. Install Python 3.11+ and add to PATH.
    exit /b 1
)
echo [deploy-01] Using: !PYTHON_CMD!

if not exist "backend\.env" (
    if exist ".env" (
        echo [deploy-01] Copying .env to backend\.env ...
        copy /Y ".env" "backend\.env" >nul
    ) else if exist ".env.example" (
        echo [deploy-01] Copying .env.example to backend\.env ...
        copy /Y ".env.example" "backend\.env" >nul
    ) else (
        echo [deploy-01] WARNING: No .env or .env.example; create backend\.env with DATABASE_URL.
    )
)

if not exist "backend\.venv" (
    echo [deploy-01] Creating backend\.venv ...
    !PYTHON_CMD! -m venv "backend\.venv"
    if errorlevel 1 (
        echo [deploy-01] ERROR: Failed to create venv.
        exit /b 1
    )
)

call "backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [deploy-01] ERROR: Failed to activate venv.
    exit /b 1
)

echo [deploy-01] pip install -r backend\requirements.txt ...
python -m pip install --upgrade pip -q
python -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
    echo [deploy-01] ERROR: pip install failed.
    exit /b 1
)

echo [deploy-01] OK: backend environment ready.
endlocal
exit /b 0
```

---

## `win10-release/Deploy-02-Frontend.bat`

```bat
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
```

---

## `win10-release/Deploy-03-Database.bat`

```bat
@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"

echo [deploy-03] Repo root: !ROOT!

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
    echo [deploy-03] BOOTSTRAP_SUPERUSER_EXTENSION=1: postgres superuser will create extension vector if needed.
)

echo [deploy-03] Activating venv and ensuring backend packages ...
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
    echo [deploy-03] ERROR: Python cannot import asyncpg after pip install.
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
```

---

## `win10-release/Deploy-All.bat`

```bat
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
```

---

## `win10-release/Start-Services.bat`

```bat
@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "!ROOT!"
set "PYTHONHOME="
set "PYTHONPATH="

echo [start] Repo root: !ROOT!

if not exist "backend\.venv\Scripts\activate.bat" (
    echo [start] ERROR: backend\.venv missing. Run Deploy-01-Backend.bat first.
    pause
    exit /b 1
)
if not exist "frontend\.next\BUILD_ID" (
    echo [start] ERROR: frontend build missing. Run Deploy-02-Frontend.bat first.
    pause
    exit /b 1
)

echo [start] Validating config (venv Python) ...
call "!ROOT!\backend\.venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [start] ERROR: Failed to activate backend\.venv
    pause
    exit /b 1
)
python "!ROOT!\scripts\validate_embedded_config.py"
if errorlevel 1 (
    echo [start] ERROR: validate_embedded_config.py failed.
    pause
    exit /b 1
)

echo [start] Launching backend in a new window ...
start "datepgv-backend" cmd /k call "!ROOT!\start_backend.bat"

echo [start] Waiting for http://127.0.0.1:8000/health ...
set "BACKEND_OK=0"
for /L %%i in (1,1,60) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2;if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}" >nul 2>nul
    if not errorlevel 1 (
        set "BACKEND_OK=1"
        goto backend_ready
    )
    timeout /t 1 /nobreak >nul
)
:backend_ready
if "!BACKEND_OK!"=="0" (
    echo [start] WARNING: Backend did not respond within 60s. Check the datepgv-backend window.
    pause
)

echo [start] Launching frontend in a new window ...
start "datepgv-frontend" cmd /k call "!ROOT!\start_frontend.bat"

echo [start] Open http://localhost:3000 in browser ...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
endlocal
exit /b 0
```

---

## `win10-release/README.txt`（zip 内简短说明，UTF-8 纯文本）

```
datepgv — Windows quick start
1) Configure .env (see .env.example) and CREATE EXTENSION vector on Postgres.
2) win10-release\Deploy-All.bat
3) win10-release\Start-Services.bat
Details: README.WINDOWS.md (English) or README.WINDOWS.zh.md (Chinese).
```

---

## `scripts/publish_win10_artifact.py`

```python
#!/usr/bin/env python3
"""
Stage a portable Win10-oriented folder and zip (cross-platform).

1) Optional: scripts/export_bootstrap_db.py
2) scripts/validate_embedded_config.py
3) Copy trees into staging
4) zip
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def ignore_backend(_dir: str, names: list[str]) -> set[str]:
    skip = {".venv", "__pycache__", ".pytest_cache", ".tmp_req_check", ".mypy_cache"}
    return {n for n in names if n in skip or n.endswith(".pyc")}


def ignore_frontend(_dir: str, names: list[str]) -> set[str]:
    return {n for n in names if n in {"node_modules", ".next"}}


def ignore_scripts(_dir: str, names: list[str]) -> set[str]:
    return {n for n in names if n in {"__pycache__"} or n.endswith(".pyc")}


def copytree(src: Path, dst: Path, ignore=None) -> None:
    shutil.copytree(src, dst, ignore=ignore, dirs_exist_ok=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish datepgv Win10 zip artifact.")
    parser.add_argument("--skip-export", action="store_true", help="Skip export_bootstrap_db.py")
    parser.add_argument(
        "--staging-dir",
        default="dist/datepgv-win10",
        help="Staging directory relative to repo root",
    )
    parser.add_argument(
        "--zip-path",
        default="dist/datepgv-win10.zip",
        help="Output zip relative to repo root",
    )
    args = parser.parse_args()
    root = repo_root()
    staging = (root / args.staging_dir).resolve()
    zip_path = (root / args.zip_path).resolve()

    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    if not args.skip_export:
        print("[publish] Running export_bootstrap_db.py ...")
        subprocess.run(
            [sys.executable, str(root / "scripts" / "export_bootstrap_db.py")],
            check=True,
            cwd=str(root),
        )
    print("[publish] Running validate_embedded_config.py ...")
    subprocess.run(
        [sys.executable, str(root / "scripts" / "validate_embedded_config.py")],
        check=True,
        cwd=str(root),
    )

    print("[publish] Copying trees ...")
    copytree(root / "backend", staging / "backend", ignore=ignore_backend)
    copytree(root / "frontend", staging / "frontend", ignore=ignore_frontend)
    copytree(root / "scripts", staging / "scripts", ignore=ignore_scripts)
    copytree(root / "db-bootstrap", staging / "db-bootstrap")
    copytree(root / "win10-release", staging / "win10-release")

    for name in (
        "start_backend.bat",
        "start_frontend.bat",
        "README.WINDOWS.md",
        "README.WINDOWS.zh.md",
        ".env.example",
    ):
        src = root / name
        if src.exists():
            shutil.copy2(src, staging / name)

    env = root / ".env"
    if env.exists():
        shutil.copy2(env, staging / ".env")

    publish_bat = root / "Publish-Win10-Artifact.bat"
    if publish_bat.exists():
        shutil.copy2(publish_bat, staging / "Publish-Win10-Artifact.bat")

    print(f"[publish] Writing zip: {zip_path}")
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                zf.write(path, arcname=path.relative_to(staging).as_posix())

    print(f"[publish] Done. Staging: {staging}")
    print(f"[publish] Zip: {zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

---

## `scripts/publish_win10_artifact.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec python3 scripts/publish_win10_artifact.py "$@"
```

---

## `Publish-Win10-Artifact.bat`（仓库根目录）

```bat
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
```

---

## 落地后自检

- 在仓库根执行：`python3 scripts/publish_win10_artifact.py --skip-export`（若尚无权威库可跳过导出）。
- 在 Windows 上解压 `dist/datepgv-win10.zip`，运行 `win10-release\Deploy-All.bat` 再 `Start-Services.bat`。
