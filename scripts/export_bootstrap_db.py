#!/usr/bin/env python3
"""
Export bootstrap DB snapshot for Windows one-click package.

Outputs:
- db-bootstrap/schema.sql          (full schema from pg_dump --schema-only)
- db-bootstrap/bootstrap_data.sql  (data-only inserts for whitelisted tables)
- db-bootstrap/manifest.json       (metadata + whitelist)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import asyncpg
from dotenv import load_dotenv

WHITELIST_TABLES: tuple[str, ...] = (
    "users",
    "roles",
    "user_roles",
    "data_scope_policies",
    "province_aliases",
    "analytics_db_connections",
    "llm_configs",
    "table_metadata",
    "table_metadata_edges",
    "analytics_db_settings",
)

EXCLUDED_TABLE_HINTS: tuple[str, ...] = (
    "chat_sessions",
    "chat_messages",
    "login_audit",
    "rag_chunks",
)


@dataclass(frozen=True)
class PgTarget:
    host: str
    port: int
    user: str
    password: str | None
    database: str


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_env() -> None:
    root = repo_root()
    load_dotenv(root / "backend" / ".env")
    load_dotenv(root / ".env")


def dsn_from_database_url() -> str:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if not raw:
        raise RuntimeError("DATABASE_URL is required in backend/.env or .env")
    if raw.startswith("postgresql+asyncpg://"):
        return "postgresql://" + raw[len("postgresql+asyncpg://") :]
    if raw.startswith("postgresql://"):
        return raw
    raise RuntimeError("DATABASE_URL must start with postgresql:// or postgresql+asyncpg://")


def parse_pg_target(dsn: str) -> PgTarget:
    u = urlparse(dsn)
    if (u.scheme or "").lower() != "postgresql":
        raise RuntimeError(f"Unsupported scheme in DSN: {u.scheme}")
    if not u.hostname or not u.path:
        raise RuntimeError("Invalid DATABASE_URL (missing host or database)")
    if not u.username:
        raise RuntimeError("Invalid DATABASE_URL (missing user)")
    return PgTarget(
        host=u.hostname,
        port=u.port or 5432,
        user=u.username,
        password=u.password,
        database=u.path.lstrip("/"),
    )


def require_pg_dump() -> str:
    exe = shutil.which("pg_dump")
    if not exe:
        raise RuntimeError("pg_dump not found in PATH. Install PostgreSQL client tools first.")
    return exe


async def validate_required_data(target: PgTarget) -> None:
    conn = await asyncpg.connect(
        host=target.host,
        port=target.port,
        user=target.user,
        password=target.password,
        database=target.database,
        timeout=15,
    )
    try:
        # Ensure llm/embedding configs both exist so packaged bootstrap is immediately usable.
        llm_count = int(
            await conn.fetchval(
                """
                SELECT COUNT(*) FROM llm_configs
                WHERE config_type = 'llm'
                """
            )
            or 0
        )
        emb_count = int(
            await conn.fetchval(
                """
                SELECT COUNT(*) FROM llm_configs
                WHERE config_type = 'embedding'
                """
            )
            or 0
        )
        if llm_count == 0 or emb_count == 0:
            raise RuntimeError(
                "llm_configs must contain both config_type='llm' and config_type='embedding' rows "
                f"(current: llm={llm_count}, embedding={emb_count})."
            )
    finally:
        await conn.close()


def run_pg_dump(pg_dump: str, target: PgTarget, extra_args: list[str], output_path: Path) -> None:
    env = os.environ.copy()
    if target.password is not None:
        env["PGPASSWORD"] = target.password
    cmd = [
        pg_dump,
        "-h",
        target.host,
        "-p",
        str(target.port),
        "-U",
        target.user,
        "-d",
        target.database,
        "--no-owner",
        "--no-privileges",
        *extra_args,
    ]
    with output_path.open("w", encoding="utf-8", newline="\n") as f:
        subprocess.run(cmd, env=env, check=True, stdout=f)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export bootstrap database snapshot.")
    parser.add_argument(
        "--output-dir",
        default="db-bootstrap",
        help="Output directory relative to repo root. Default: db-bootstrap",
    )
    args = parser.parse_args()

    load_env()
    dsn = dsn_from_database_url()
    target = parse_pg_target(dsn)
    pg_dump = require_pg_dump()

    root = repo_root()
    out_dir = (root / args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    schema_sql = out_dir / "schema.sql"
    data_sql = out_dir / "bootstrap_data.sql"
    manifest_json = out_dir / "manifest.json"

    asyncio_rc = 0
    try:
        import asyncio

        asyncio.run(validate_required_data(target))
    except Exception as e:  # noqa: BLE001
        asyncio_rc = 1
        print(f"[export-bootstrap] ERROR: {e}", file=sys.stderr)
    if asyncio_rc != 0:
        raise SystemExit(asyncio_rc)

    print("[export-bootstrap] Exporting schema.sql ...")
    run_pg_dump(pg_dump, target, ["--schema-only"], schema_sql)

    print("[export-bootstrap] Exporting bootstrap_data.sql ...")
    table_args: list[str] = []
    for t in WHITELIST_TABLES:
        table_args.extend(["--table", f"public.{quote(t, safe='')}"])
    run_pg_dump(
        pg_dump,
        target,
        [
            "--data-only",
            "--inserts",
            "--column-inserts",
            "--disable-triggers",
            *table_args,
        ],
        data_sql,
    )

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_database": {
            "host": target.host,
            "port": target.port,
            "database": target.database,
            "user": target.user,
        },
        "schema_file": schema_sql.name,
        "data_file": data_sql.name,
        "included_tables": list(WHITELIST_TABLES),
        "excluded_hints": list(EXCLUDED_TABLE_HINTS),
    }
    manifest_json.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[export-bootstrap] Done: {out_dir}")


if __name__ == "__main__":
    main()
