---
name: win10-pg-bootstrap
description: >-
  Guides Windows 10 deployment, pg_dump bootstrap restore, psql-based import,
  SQL filtering for non-superuser roles, superuser vector extension setup,
  UTF-8 console/PGCLIENTENCODING, dual-DSN SSL parity, and LiteLLM/DashScope
  embedding kwargs. Use when working on datepgv win10-release, Deploy-03,
  restore_bootstrap_db.py, db-bootstrap, BOOTSTRAP_SUPERUSER_*, DATABASE_URL,
  or embedding encoding_format errors.
---

# Win10 + PostgreSQL bootstrap (datepgv)

## Defaults for this repo

- **Truth source for schema/data**: `db-bootstrap/` dumps + `scripts/restore_bootstrap_db.py` (not hand-maintained init SQL as the primary path).
- **Win entrypoints**: `win10-release/` (e.g. `OneClick-FullDeploy.bat`). Deprecate stubs elsewhere; do not send users to old `package_win10.bat` / `run_win10_oneclick.bat` unless migrating.
- **Human docs**: `README.WINDOWS.md`, `README.WINDOWS.zh.md`. **Narrative lessons**: `docs/WIN10_SESSION_RETROSPECTIVE.md`.

## Restore pipeline (do not regress)

1. **Filter** dump text before execute: strip psql meta lines (`\restrict`, `\unrestrict`, etc.).
2. **Skip** statements that fail or require elevated privileges under the app role, in one place (not one-off fixes): e.g. `COMMENT ON EXTENSION`, `ALTER EXTENSION`, `DISABLE TRIGGER ALL`, `ENABLE TRIGGER ALL`.
3. **Execute** large SQL with **`psql -f`** on a temp filtered file. Avoid feeding the full dump through asyncpg + ad-hoc SQL splitting (size/edge cases → driver/parser failures).
4. On **psql failure**: surface clear errors; **keep temp SQL path** for debugging; set **`PGCLIENTENCODING=UTF8`**.
5. **`vector`**: use **`--superuser-extension`** and `BOOTSTRAP_SUPERUSER_*` when the app user cannot create extensions. Build superuser URL so **query string matches `DATABASE_URL`** (SSL/options parity) or use validated `BOOTSTRAP_SUPERUSER_DATABASE_URL`.
6. **Deploy scripts**: ensure backend venv + `pip install -r backend/requirements.txt` before running restore helpers that need Python deps.

## Windows / encoding

- Batch files that run DB tooling: **`chcp 65001`** where appropriate; **`PGCLIENTENCODING=UTF8`**. Fix encoding before interpreting errors (garbled output hides SQL vs permission issues).

## Embeddings / LiteLLM

- For **DashScope** (and similar strict APIs): normalize **`encoding_format`** to an allowed set (e.g. default **`float`**, allow **`base64`** when explicitly requested). Do not rely on implicit defaults that the server rejects.

## Anti-patterns (cost time)

- Fixing restore failures **one statement at a time** without extending the central filter list.
- **Dual DSN** with different SSL/query params → “one connection works, one closes”.
- **Old script entrypoints** still documented or runnable without a stub → user confusion.
- **Third-party embedding params** assumed from docs without **explicit normalization** at the call site.

## Quick checklist (before claiming “restore works”)

- [ ] `psql` on PATH; `DATABASE_URL` set; superuser vars set if `vector` / extension install needed.
- [ ] UTF-8 code page + `PGCLIENTENCODING` for Windows runs.
- [ ] Restore uses filtered file + `psql -f`; failures leave a inspectable temp file path.
- [ ] Superuser DSN parity with app DSN (or fully specified separate URL).
- [ ] Embedding calls use vendor-valid kwargs for the active provider.

## More detail

See [reference.md](reference.md) for path map and extended checklist. For post-mortem context, see `docs/WIN10_SESSION_RETROSPECTIVE.md`.
