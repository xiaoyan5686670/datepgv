#!/usr/bin/env python3
"""
Stage a portable Win10-oriented folder and zip (cross-platform: Windows, macOS, Ubuntu 22.x).

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
    print("[publish] Running validate_embedded_config.py ...", flush=True)
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
