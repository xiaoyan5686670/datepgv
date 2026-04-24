#!/usr/bin/env python3
"""
Restore DB bootstrap snapshot from db-bootstrap/.

Default behavior:
- If users table already has rows, skip restore (safe re-run).

Force behavior:
- --force drops and recreates schema public, then restores schema + data.

Vector / superuser:
- If extension vector is missing (typical for non-superuser DATABASE_URL), pass
  --superuser-extension or set BOOTSTRAP_SUPERUSER_EXTENSION=1, then enter the
  postgres superuser password when prompted (or set BOOTSTRAP_SUPERUSER_PASSWORD
  for non-interactive use only). Optional BOOTSTRAP_SUPERUSER_NAME overrides role
  name (default postgres).

If superuser connection drops mid-flight (common with SSL), ensure DATABASE_URL
includes the same ?sslmode= / sslrootcert= query string as the app uses — it is
reused for the postgres connection. Or set BOOTSTRAP_SUPERUSER_DATABASE_URL to a
full postgresql:// URL for the superuser (password embedded; do not commit).
"""

from __future__ import annotations

import argparse
import getpass
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from dataclasses import dataclass
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


def dsn_from_database_url() -> str:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if not raw:
        raise RuntimeError("DATABASE_URL is required in backend/.env or .env")
    if raw.startswith("postgresql+asyncpg://"):
        return "postgresql://" + raw[len("postgresql+asyncpg://") :]
    if raw.startswith("postgresql://"):
        return raw
    raise RuntimeError("DATABASE_URL must start with postgresql:// or postgresql+asyncpg://")


def pg_target_summary(dsn: str) -> str:
    u = urlparse(dsn)
    host = u.hostname or "?"
    port = u.port or 5432
    db = (u.path or "").lstrip("/") or "?"
    return f"{host}:{port}/{db}"




@dataclass(frozen=True)
class PgTarget:
    host: str
    port: int
    user: str
    password: str | None
    database: str


def parse_pg_target(dsn: str) -> PgTarget:
    u = urlparse(dsn)
    if (u.scheme or "").lower() not in ("postgresql", "postgres"):
        raise RuntimeError("DATABASE_URL must be postgresql://")
    if not u.hostname or not u.username:
        raise RuntimeError("DATABASE_URL must include host and user")
    db = (u.path or "").lstrip("/")
    if not db:
        raise RuntimeError("DATABASE_URL must include database name in path")
    return PgTarget(
        host=u.hostname,
        port=u.port or 5432,
        user=u.username,
        password=u.password,
        database=db,
    )


def require_psql() -> str:
    exe = shutil.which("psql")
    if not exe:
        raise RuntimeError("psql not found in PATH. Install PostgreSQL client tools.")
    return exe


def run_psql_file(target: PgTarget, sql_path: Path, label: str) -> None:
    psql = require_psql()
    env = os.environ.copy()
    if target.password is not None:
        env["PGPASSWORD"] = target.password
    env["PGCLIENTENCODING"] = "UTF8"
    cmd = [
        psql,
        "-h",
        target.host,
        "-p",
        str(target.port),
        "-U",
        target.user,
        "-d",
        target.database,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        str(sql_path),
    ]
    print(f"[restore-bootstrap] psql apply {label}: {sql_path.name}")
    try:
        subprocess.run(cmd, env=env, check=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"psql failed while applying {label} (exit={e.returncode}). "
            f"Inspect SQL file: {sql_path}"
        ) from e

def _host_netloc_part(hostname: str | None) -> str:
    if not hostname:
        return "localhost"
    # IPv6 literals must be bracketed in URI netloc
    if ":" in hostname and not hostname.startswith("["):
        return f"[{hostname}]"
    return hostname


def superuser_dsn(app_dsn: str, super_user: str, super_password: str) -> str:
    u = urlparse(app_dsn)
    if (u.scheme or "").lower() not in ("postgresql", "postgres"):
        raise RuntimeError("DATABASE_URL must be postgresql:// or postgresql+asyncpg://")
    host = _host_netloc_part(u.hostname)
    port = u.port or 5432
    db = (u.path or "").lstrip("/")
    if not db:
        raise RuntimeError("DATABASE_URL must include database name in path")
    user_q = quote(super_user, safe="")
    pass_q = quote(super_password, safe="")
    netloc = f"{user_q}:{pass_q}@{host}:{port}"
    # Keep sslmode / sslrootcert / target_session_attrs etc. — missing these often
    # causes "connection was closed in the middle of operation" on SSL-only servers.
    query = u.query or ""
    return urlunparse(("postgresql", netloc, "/" + db, "", query, ""))


async def pg_extension_exists(conn: asyncpg.Connection, extname: str) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1)",
            extname,
        )
    )


def resolve_superuser_password(super_name: str) -> str | None:
    env_pwd = (os.environ.get("BOOTSTRAP_SUPERUSER_PASSWORD") or "").strip()
    if env_pwd:
        return env_pwd
    if sys.stdin.isatty():
        return getpass.getpass(f"PostgreSQL superuser ({super_name}) password: ")
    print(
        "[restore-bootstrap] ERROR: need superuser password in non-interactive mode. "
        "Set BOOTSTRAP_SUPERUSER_PASSWORD (avoid in shared logs) or run from a terminal.",
        file=sys.stderr,
    )
    return None


def _normalize_pg_uri(uri: str) -> str:
    u = uri.strip()
    if u.startswith("postgresql+asyncpg://"):
        return "postgresql://" + u[len("postgresql+asyncpg://") :]
    return u


def validate_superuser_uri(uri: str) -> str:
    u = urlparse(uri)
    if (u.scheme or "").lower() not in ("postgresql", "postgres"):
        raise RuntimeError("BOOTSTRAP_SUPERUSER_DATABASE_URL must start with postgresql://")
    if not u.username:
        raise RuntimeError("BOOTSTRAP_SUPERUSER_DATABASE_URL is missing username")
    if u.password is None or u.password == "":
        raise RuntimeError(
            "BOOTSTRAP_SUPERUSER_DATABASE_URL must include password (postgresql://user:pass@host:port/db)"
        )
    if not u.hostname:
        raise RuntimeError("BOOTSTRAP_SUPERUSER_DATABASE_URL is missing host")
    db = (u.path or "").lstrip("/")
    if not db:
        raise RuntimeError("BOOTSTRAP_SUPERUSER_DATABASE_URL is missing database name in path")
    return uri


async def create_vector_with_superuser(app_dsn: str, super_name: str) -> int:
    """CREATE EXTENSION vector using superuser. Returns 0 on success."""
    override = (os.environ.get("BOOTSTRAP_SUPERUSER_DATABASE_URL") or "").strip()
    if override:
        super_dsn = validate_superuser_uri(_normalize_pg_uri(override))
        print(
            "[restore-bootstrap] Using BOOTSTRAP_SUPERUSER_DATABASE_URL for superuser connection "
            "(password must already be in that URL).",
        )
    else:
        pwd = resolve_superuser_password(super_name)
        if not pwd:
            return 1
        super_dsn = superuser_dsn(app_dsn, super_name, pwd)

    print(f"[restore-bootstrap] Connecting as superuser {super_name!r} to CREATE EXTENSION vector ...")
    try:
        super_conn = await asyncpg.connect(super_dsn, timeout=60, command_timeout=120)
        try:
            await super_conn.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public")
        finally:
            await super_conn.close()
    except Exception as e:  # noqa: BLE001
        print(f"[restore-bootstrap] ERROR: superuser connection failed: {e!r}", file=sys.stderr)
        traceback.print_exc()
        print(
            "[restore-bootstrap] HINT: If the server requires SSL, ensure DATABASE_URL includes the same "
            "query params (e.g. ?sslmode=require) — they are copied to the superuser URL. "
            "Or set BOOTSTRAP_SUPERUSER_DATABASE_URL to a full postgresql://postgres:...@host:port/db?... URL. "
            "Check postgres password, pg_hba.conf, and that the vector package is installed on the server.",
            file=sys.stderr,
        )
        return 1
    print("[restore-bootstrap] extension vector created.")
    return 0


def strip_psql_client_directives(sql: str) -> str:
    """
    pg_dump (15+) may emit psql-only lines such as \\restrict / \\unrestrict.
    They are not valid SQL for the server and break asyncpg.execute().
    Lines like COPY ... \\. (backslash-dot) are kept: second char is not a letter.
    """
    out: list[str] = []
    for line in sql.splitlines():
        s = line.lstrip()
        if len(s) >= 2 and s[0] == "\\" and s[1].isalpha():
            continue
        out.append(line)
    trailing_nl = sql.endswith("\n")
    text = "\n".join(out)
    if trailing_nl and text and not text.endswith("\n"):
        text += "\n"
    return text


def _is_owner_or_superuser_sensitive(stmt: str) -> bool:
    """
    Statements that commonly fail under application role restores.
    Skipping these does not affect business correctness for our bootstrap data.
    """
    up = stmt.upper()
    return (
        ("COMMENT ON EXTENSION" in up)
        or ("ALTER EXTENSION" in up)
        or ("DISABLE TRIGGER ALL" in up)
        or ("ENABLE TRIGGER ALL" in up)
    )


def build_filtered_sql(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    sql = strip_psql_client_directives(raw)
    statements = sqlparse.split(sql)
    out: list[str] = []
    for raw_stmt in statements:
        stmt = str(raw_stmt).strip()
        if not stmt:
            continue
        if _is_owner_or_superuser_sensitive(stmt):
            continue
        out.append(stmt if stmt.endswith(";") else stmt + ";")
    return "\n\n".join(out) + "\n"


def execute_sql_file_via_psql(target: PgTarget, path: Path, label: str) -> None:
    filtered_sql = build_filtered_sql(path)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=f".{label}.sql", delete=False) as tf:
        tf.write(filtered_sql)
        tmp = Path(tf.name)
    try:
        run_psql_file(target, tmp, label)
    except Exception:
        print(f"[restore-bootstrap] DEBUG: kept failed SQL file at: {tmp}", file=sys.stderr)
        raise
    else:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

async def table_has_rows(conn: asyncpg.Connection, table_name: str) -> bool:
    exists = await conn.fetchval(
        """
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name=$1
        )
        """,
        table_name,
    )
    if not bool(exists):
        return False
    count = int(await conn.fetchval(f'SELECT COUNT(*) FROM "public"."{table_name}"') or 0)
    return count > 0


async def async_main(args: argparse.Namespace) -> int:
    load_env()
    root = repo_root()
    bootstrap_dir = (root / args.bootstrap_dir).resolve()
    schema_sql = bootstrap_dir / "schema.sql"
    data_sql = bootstrap_dir / "bootstrap_data.sql"
    if not schema_sql.exists() or not data_sql.exists():
        print(
            f"[restore-bootstrap] ERROR: missing snapshot files under {bootstrap_dir}. "
            "Expected schema.sql + bootstrap_data.sql",
            file=sys.stderr,
        )
        return 1

    dsn = dsn_from_database_url()
    print(f"[restore-bootstrap] target={pg_target_summary(dsn)}")

    if not args.force:
        probe = await asyncpg.connect(dsn, timeout=15)
        try:
            if await table_has_rows(probe, "users"):
                print(
                    "[restore-bootstrap] Skipped: users table already has data. "
                    "Use --force to rebuild from snapshot."
                )
                return 0
        finally:
            await probe.close()

    target = parse_pg_target(dsn)
    conn = await asyncpg.connect(dsn, timeout=15)
    try:
        if args.force:
            print("[restore-bootstrap] Force mode: dropping and recreating public schema ...")
            await conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
            await conn.execute("CREATE SCHEMA public")

        if not await pg_extension_exists(conn, "vector"):
            if not args.superuser_extension:
                print(
                    "[restore-bootstrap] ERROR: extension vector is not installed in this database.\n"
                    "  The application role cannot CREATE EXTENSION. Use one of:\n"
                    "  - psql as superuser: CREATE EXTENSION IF NOT EXISTS vector;\n"
                    "  - Re-run with --superuser-extension or set BOOTSTRAP_SUPERUSER_EXTENSION=1\n"
                    "    (password prompt, or BOOTSTRAP_SUPERUSER_PASSWORD for non-interactive only).",
                    file=sys.stderr,
                )
                return 1
            rc = await create_vector_with_superuser(dsn, args.superuser_name)
            if rc != 0:
                return rc
            await conn.close()
            conn = await asyncpg.connect(dsn, timeout=15)
            if not await pg_extension_exists(conn, "vector"):
                print(
                    "[restore-bootstrap] ERROR: vector extension still missing after superuser CREATE EXTENSION.",
                    file=sys.stderr,
                )
                return 1

        print("[restore-bootstrap] Applying schema.sql ...")
        execute_sql_file_via_psql(target, schema_sql, "schema")
        print("[restore-bootstrap] Applying bootstrap_data.sql ...")
        execute_sql_file_via_psql(target, data_sql, "data")
        print("[restore-bootstrap] Done.")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"[restore-bootstrap] ERROR: {e!r}", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore DB bootstrap snapshot.")
    parser.add_argument(
        "--bootstrap-dir",
        default="db-bootstrap",
        help="Snapshot directory relative to repo root. Default: db-bootstrap",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Drop and recreate public schema before restore.",
    )
    parser.add_argument(
        "--superuser-extension",
        action="store_true",
        help="When vector is missing, prompt for postgres superuser password (see BOOTSTRAP_SUPERUSER_* env).",
    )
    parser.add_argument(
        "--superuser-name",
        default=os.getenv("BOOTSTRAP_SUPERUSER_NAME", "postgres"),
        help="Superuser role for CREATE EXTENSION (default: postgres or BOOTSTRAP_SUPERUSER_NAME).",
    )
    args = parser.parse_args()
    if os.getenv("BOOTSTRAP_SUPERUSER_EXTENSION", "").strip().lower() in ("1", "true", "yes"):
        args.superuser_extension = True
    raise SystemExit(__import__("asyncio").run(async_main(args)))


if __name__ == "__main__":
    main()
