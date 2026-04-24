#!/usr/bin/env python3
"""
Validate packaging prerequisites for embedded Windows one-click config.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from dotenv import dotenv_values


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def main() -> None:
    root = repo_root()
    root_env = root / ".env"
    backend_env = root / "backend" / ".env"
    env_vals: dict[str, str | None] = {}
    if root_env.exists():
        env_vals.update(dotenv_values(root_env))
    if backend_env.exists():
        # Backend wins so local edits after copy apply; either file alone is OK.
        env_vals.update(dotenv_values(backend_env))
    if not root_env.exists() and not backend_env.exists():
        print(
            "[validate-config] ERROR: need .env or backend/.env with DATABASE_URL "
            "(one-click copies root .env to backend/.env if missing).",
            file=sys.stderr,
        )
        raise SystemExit(1)

    db_url = (env_vals.get("DATABASE_URL") or "").strip()
    if not db_url:
        print("[validate-config] ERROR: DATABASE_URL is missing in .env", file=sys.stderr)
        raise SystemExit(1)

    bootstrap_dir = root / "db-bootstrap"
    schema_sql = bootstrap_dir / "schema.sql"
    bootstrap_data = bootstrap_dir / "bootstrap_data.sql"
    if not schema_sql.exists() or not bootstrap_data.exists():
        print(
            "[validate-config] ERROR: db-bootstrap must contain schema.sql and bootstrap_data.sql. "
            "On the build machine run: python scripts/export_bootstrap_db.py",
            file=sys.stderr,
        )
        raise SystemExit(1)

    data_sql = bootstrap_data.read_text(encoding="utf-8", errors="ignore")
    llm_rows = len(re.findall(r'INSERT INTO\s+"?public"?\."?llm_configs"?', data_sql, flags=re.IGNORECASE))
    has_llm = bool(re.search(r"config_type.*'llm'|'llm'.*config_type", data_sql, flags=re.IGNORECASE))
    has_embedding = bool(
        re.search(r"config_type.*'embedding'|'embedding'.*config_type", data_sql, flags=re.IGNORECASE)
    )
    if llm_rows == 0 or not has_llm or not has_embedding:
        print(
            "[validate-config] ERROR: bootstrap_data.sql must include llm_configs rows "
            "for both config_type='llm' and config_type='embedding'.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    print("[validate-config] OK: .env + bootstrap snapshot look valid.")


if __name__ == "__main__":
    main()
