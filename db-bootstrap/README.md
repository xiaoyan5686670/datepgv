# DB Bootstrap Snapshot

This directory is the source of truth for Windows one-click database initialization.

Expected files:

- `schema.sql`: schema-only export from a verified PostgreSQL baseline database.
- `bootstrap_data.sql`: data-only export for whitelisted baseline tables only.
- `manifest.json`: export metadata and included table list.

Generate/update snapshot:

```bash
python scripts/export_bootstrap_db.py
```

Restore snapshot manually:

```bash
python scripts/restore_bootstrap_db.py
python scripts/restore_bootstrap_db.py --force
```

Notes:

- Do not include chat history datasets in `bootstrap_data.sql`.
- Keep user/role/permission and LLM/embedding configuration baseline data.
