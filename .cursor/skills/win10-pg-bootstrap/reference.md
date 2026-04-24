# win10-pg-bootstrap — reference

## Repository paths

| Area | Path |
|------|------|
| Win10 deploy / one-click | `win10-release/` |
| Filtered restore implementation | `scripts/restore_bootstrap_db.py` |
| Dump snapshots | `db-bootstrap/` |
| Windows docs (EN / ZH) | `README.WINDOWS.md`, `README.WINDOWS.zh.md` |
| Publish artifact | `scripts/publish_win10_artifact.py` |
| Session retrospective (narrative) | `docs/WIN10_SESSION_RETROSPECTIVE.md` |

## Environment variables (typical)

- **`DATABASE_URL`**: application role DSN (used as template for superuser URL query parity).
- **`BOOTSTRAP_SUPERUSER_EXTENSION`**: enable superuser extension path when non-zero / set as documented in script.
- **`BOOTSTRAP_SUPERUSER_PASSWORD`**, **`BOOTSTRAP_SUPERUSER_NAME`**, optional **`BOOTSTRAP_SUPERUSER_DATABASE_URL`**: superuser connection for `CREATE EXTENSION vector` and related steps.

Exact names and semantics: read `scripts/restore_bootstrap_db.py` and `win10-release/Deploy-03-Database.bat` (or current equivalents).

## SQL categories to filter for app-role restore

Maintain in the central filter, not scattered hotfixes:

- Psql backslash commands: `\restrict`, `\unrestrict`, etc.
- Extension privilege noise: `COMMENT ON EXTENSION`, `ALTER EXTENSION`
- Trigger bulk disable/enable: `DISABLE TRIGGER ALL`, `ENABLE TRIGGER ALL`

Add new categories when a new dump or Postgres version introduces more superuser-only or role-breaking statements.

## Extended “save time next time” checklist

1. Confirm Postgres client tools and `psql` availability on PATH.
2. Confirm `DATABASE_URL` and optional superuser variables before long restore runs.
3. Fix Windows console encoding first when errors are unreadable.
4. Prefer `psql -f` after filtering; retain temp SQL on failure.
5. Point users only at current `win10-release` entrypoints in docs.
6. When changing embedding vendors, verify API constraints (`encoding_format`, dimensions, etc.) and enforce at kwargs layer.
