#!/usr/bin/env python3
"""
Apply SQL files under init-db/ to PostgreSQL using DATABASE_URL from backend/.env or .env.

Uses asyncpg + sqlparse (already backend dependencies). Intended for Windows one-click
and manual first-time setup when not using Docker for Postgres.

Default: if public.table_metadata already exists, skip (idempotent for re-runs).
Use --force to always execute every file (may fail on duplicate inserts).

Excludes: ``用户管理.sql`` (manual maintenance only; contains DELETE).
Root ``1.sql``/``2.sql``/``3.sql`` and ``graph-poc/*.sql`` are not part of bootstrap.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

import asyncpg
import sqlparse
from dotenv import load_dotenv


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_env() -> None:
    root = repo_root()
    load_dotenv(root / "backend" / ".env")
    load_dotenv(root / ".env")


def _normalize_postgres_localhost_host_on_windows(url: str) -> str:
    """Match backend ``app.core.config``: Windows + localhost → 127.0.0.1 for Postgres URLs."""
    url = (url or "").strip()
    if not url or sys.platform != "win32":
        return url
    lower = url.lower()
    if not (lower.startswith("postgresql://") or lower.startswith("postgresql+asyncpg://")):
        return url
    u = urlparse(url)
    if (u.hostname or "").lower() != "localhost":
        return url
    auth = ""
    if u.username is not None:
        uq = quote(u.username, safe="")
        if u.password is not None:
            auth = f"{uq}:{quote(u.password, safe='')}@"
        else:
            auth = f"{uq}@"
    port = f":{u.port}" if u.port else ""
    netloc = f"{auth}127.0.0.1{port}"
    return urlunparse((u.scheme, netloc, u.path, "", u.query, ""))


def dsn_from_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print(
            "ERROR: DATABASE_URL not set. Set it in backend/.env or .env "
            "(e.g. postgresql+asyncpg://user:pass@localhost:5432/datepgv).",
            file=sys.stderr,
        )
        sys.exit(1)
    url = _normalize_postgres_localhost_host_on_windows(url)
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + url[len("postgresql+asyncpg://") :]
    if url.startswith("postgresql://"):
        return url
    print("ERROR: DATABASE_URL must start with postgresql+asyncpg:// or postgresql://", file=sys.stderr)
    sys.exit(1)


def _pg_target_from_dsn(dsn: str) -> tuple[str, int, str | None]:
    """Return (host, port, database) for user-facing messages."""
    try:
        u = urlparse(dsn)
        host = u.hostname or "localhost"
        port = u.port or 5432
        db = (u.path or "").lstrip("/") or None
        return host, port, db
    except Exception:  # noqa: BLE001
        return "?", 5432, None


def _print_connect_failure_help(dsn: str, err: BaseException) -> None:
    host, port, db = _pg_target_from_dsn(dsn)
    print("", file=sys.stderr)
    print(
        f"目标: {host}:{port}"
        + (f"  数据库: {db}" if db else "")
        + "  （来自 DATABASE_URL）",
        file=sys.stderr,
    )
    winerr = getattr(err, "winerror", None)
    errno = getattr(err, "errno", None)
    if winerr == 1225 or errno in (111, 61, 10061):
        print(
            "说明: 连接被拒绝 — 该地址上没有 PostgreSQL 在监听，或被防火墙拦截。",
            file=sys.stderr,
        )
        if (host or "").lower() == "localhost" or host == "::1":
            print(
                "提示: 若 pgAdmin 用 127.0.0.1 能连、脚本用 localhost 失败，多半是 IPv6(::1) 与仅 IPv4 监听冲突；"
                "本脚本与后端在 Windows 上会自动把 Postgres URL 中的 localhost 改为 127.0.0.1。",
                file=sys.stderr,
            )
        print(
            "处理: 1) 在本机安装并启动 PostgreSQL 服务；2) 确认端口与 .env 中一致（默认 5432）；",
            file=sys.stderr,
        )
        print(
            "      3) 若库在别的机器，把 DATABASE_URL 改成那台机器的主机名或 IP；",
            file=sys.stderr,
        )
        print(
            "      4) Windows 可在「服务」中查看 postgresql-x64-xx 是否正在运行。",
            file=sys.stderr,
        )
    else:
        print(
            "说明: 无法建立 TCP 连接或认证失败。请核对 PostgreSQL 已启动、库与用户已创建、密码与 pg_hba.conf。",
            file=sys.stderr,
        )


# Ad-hoc / destructive scripts in init-db — never run during automated bootstrap.
_SKIP_INIT_SQL_NAMES = frozenset(
    {
        "用户管理.sql",  # manual SELECT + DELETE users; not for fresh deploy
    }
)


def list_init_sql_files(root: Path) -> list[Path]:
    d = root / "init-db"
    if not d.is_dir():
        print(f"ERROR: init-db directory not found: {d}", file=sys.stderr)
        sys.exit(1)
    files = sorted(
        p
        for p in d.glob("*.sql")
        if p.is_file() and p.name not in _SKIP_INIT_SQL_NAMES
    )
    if not files:
        print(f"ERROR: No *.sql files under {d}", file=sys.stderr)
        sys.exit(1)
    return files


async def table_metadata_exists(conn: asyncpg.Connection) -> bool:
    row = await conn.fetchval(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'table_metadata'
        )
        """
    )
    return bool(row)


async def apply_file(conn: asyncpg.Connection, path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    statements = sqlparse.split(text)
    for raw in statements:
        stmt = str(raw).strip()
        if not stmt:
            continue
        await conn.execute(stmt)


async def async_main(args: argparse.Namespace) -> int:
    load_env()
    root = repo_root()
    dsn = dsn_from_database_url()
    files = list_init_sql_files(root)

    try:
        conn = await asyncpg.connect(dsn, timeout=15)
    except Exception as e:  # noqa: BLE001 — surface any connect error to user
        print(f"ERROR: Cannot connect to PostgreSQL: {e}", file=sys.stderr)
        _print_connect_failure_help(dsn, e)
        print(
            "Hint: ensure PostgreSQL is running, database exists, user/password match DATABASE_URL, "
            "and pg_hba.conf allows local connections.",
            file=sys.stderr,
        )
        return 1

    try:
        if not args.force and await table_metadata_exists(conn):
            print(
                "[init-db] Skipped: public.table_metadata already exists. "
                "Database appears initialized. To re-run all SQL anyway, use --force "
                "(may fail on duplicate data).",
            )
            return 0

        for f in files:
            print(f"[init-db] Applying {f.name} ...", flush=True)
            try:
                await apply_file(conn, f)
            except Exception as e:  # noqa: BLE001
                print(f"ERROR: Failed while executing {f.name}: {e}", file=sys.stderr)
                return 1

        print("[init-db] All SQL files applied successfully.", flush=True)
        return 0
    finally:
        await conn.close()


def main() -> None:
    p = argparse.ArgumentParser(description="Apply init-db/*.sql using DATABASE_URL.")
    p.add_argument(
        "--force",
        action="store_true",
        help="Always run every SQL file even if table_metadata already exists.",
    )
    args = p.parse_args()
    raise SystemExit(asyncio.run(async_main(args)))


if __name__ == "__main__":
    main()
