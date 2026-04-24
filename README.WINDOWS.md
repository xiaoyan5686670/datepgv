# datepgv on Windows 10

Chinese version: [README.WINDOWS.zh.md](README.WINDOWS.zh.md).

Full copies of the same scripts also live in [docs/WIN10_RELEASE_CODE.md](docs/WIN10_RELEASE_CODE.md) for audit/recovery.

## Stack

Next.js frontend, FastAPI backend, PostgreSQL. **Schema and seed data** ship as `pg_dump` artifacts under `db-bootstrap/` (`schema.sql`, `bootstrap_data.sql`), not hand-maintained `init-db` SQL chains.

## Target machine prerequisites

1. **Python 3.11+** on PATH.
2. **Node.js 18+** (LTS) and npm.
3. **PostgreSQL 14+** with an app database and role. Defaults match [.env.example](.env.example) (database `datepgv`, user `datepgv`, password `datepgv123`, port `5432`).
4. In that database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. **Configure `DATABASE_URL`**: copy `.env.example` to `.env` (or maintain `backend/.env`) and adjust host/port/password.

## Install and run (recommended)

Use the batch files under **`win10-release/`** (paths assume the same layout as this repo after unzip):

| Script | Purpose |
|--------|---------|
| `Deploy-01-Backend.bat` | Create `backend\.venv`, `pip install -r backend\requirements.txt` |
| `Deploy-02-Frontend.bat` | `npm install` and `npm run build` in `frontend\` |
| `Deploy-03-Database.bat` | Same as above; set **`BOOTSTRAP_SUPERUSER_EXTENSION=1`** before running if `vector` must be created by superuser (password prompt; see `BOOTSTRAP_SUPERUSER_PASSWORD` / `BOOTSTRAP_SUPERUSER_NAME`) |
| `Deploy-All.bat` | Runs 01 → 02 → 03 in order |
| `Start-Services.bat` | Validates config, starts backend and frontend in new windows, opens the browser |

The following entry points are **deprecated stubs** (they print a message and exit with an error code): `run_win10_oneclick.bat`, `package_win10.bat`, `run_win10_onclick.bat`, and `package_win10_on_mac.sh`. Use `win10-release/`, `Publish-Win10-Artifact.bat`, or `scripts/publish_win10_artifact.py` instead.

**`start_backend.bat`**: you normally do **not** run it by hand. `win10-release/Start-Services.bat` starts it in a new window for you.

### Environment variables for DB restore

- **`SKIP_BOOTSTRAP_DB=1`**: skip restore when running `Deploy-03-Database.bat`.
- **`FORCE_BOOTSTRAP_DB=1`**: pass `--force` to restore (drops and recreates `public`, then loads snapshot — **destructive**).
- **`BOOTSTRAP_SUPERUSER_EXTENSION=1`**: if `vector` is missing and the app role cannot `CREATE EXTENSION`, connect as **postgres** (or `BOOTSTRAP_SUPERUSER_NAME`) to the same host/database and prompt for the superuser password (or set `BOOTSTRAP_SUPERUSER_PASSWORD` for non-interactive use only — do not commit). The superuser URL **reuses the query string** from `DATABASE_URL` (e.g. `sslmode=require`) so SSL settings match. If the connection still drops, set **`BOOTSTRAP_SUPERUSER_DATABASE_URL`** to a full `postgresql://postgres:pass@host:port/db?...` URL (do not commit).

Example (full rebuild + superuser vector):

```bat
set FORCE_BOOTSTRAP_DB=1
set BOOTSTRAP_SUPERUSER_EXTENSION=1
call win10-release\Deploy-03-Database.bat
```

## URLs after start

- App: <http://localhost:3000> (LAN: `http://<this-host-ip>:3000` — see troubleshooting if it does not load)
- OpenAPI: <http://localhost:8000/docs>
- Health: <http://127.0.0.1:8000/health>

Stop by closing the `datepgv-backend` and `datepgv-frontend` console windows.

## Build the zip artifact (dev machine)

On **Windows, macOS, or Ubuntu 22.x** (Python + `pg_dump` + reachable Postgres per `DATABASE_URL`):

```bash
python3 scripts/publish_win10_artifact.py
```

Use `--skip-export` to reuse existing `db-bootstrap/` without re-running `export_bootstrap_db.py`. Default output: `dist/datepgv-win10.zip`.

On Windows you can also run **`Publish-Win10-Artifact.bat`** at the repo root if present; it invokes the same Python entrypoint.

## Troubleshooting

- **Superuser connect: `connection was closed in the middle of operation`**: Often **SSL/query params mismatch** — the superuser DSN now copies `DATABASE_URL`'s query string (e.g. `sslmode=require`). Ensure `DATABASE_URL` includes the same SSL options your server expects, update `restore_bootstrap_db.py`, and retry; or set **`BOOTSTRAP_SUPERUSER_DATABASE_URL`**. Also verify the postgres password, `pg_hba.conf`, and that the **vector** extension package is installed on the server.
- **Must be owner of extension vector**: `schema.sql` contains `COMMENT ON EXTENSION vector`, which only the extension owner or a superuser can run. The restore script now **skips** `COMMENT ON EXTENSION` statements. Update `scripts/restore_bootstrap_db.py` and re-run `Deploy-03`.
- **`CREATE EXTENSION vector` permission denied**: If `DATABASE_URL` uses a non-superuser role, set `BOOTSTRAP_SUPERUSER_EXTENSION=1` before `Deploy-03-Database.bat` (and `FORCE_BOOTSTRAP_DB=1` if you need a full rebuild). Enter the **postgres** superuser password when prompted, or set `BOOTSTRAP_SUPERUSER_PASSWORD` for non-interactive runs only (do not commit). Override role with `BOOTSTRAP_SUPERUSER_NAME` if needed. Alternatively run once as superuser: `CREATE EXTENSION IF NOT EXISTS vector;`.
- **Syntax error near `\` when applying `schema.sql`**: Newer `pg_dump` may emit psql-only `\restrict` / `\unrestrict` lines; `restore_bootstrap_db.py` strips them before sending SQL to the server. Update `scripts/restore_bootstrap_db.py` from the repo and re-run `Deploy-03` (with `FORCE_BOOTSTRAP_DB=1` if you need a full rebuild).
- **`ModuleNotFoundError: asyncpg`**: Deploy scripts now **activate `backend\.venv`**, clear `PYTHONHOME` / `PYTHONPATH`, and **`pip install -r backend\requirements.txt`** before restore. If it still fails, delete `backend\.venv` and re-run `Deploy-01-Backend.bat`.
- **Restore errors**: Postgres running? `DATABASE_URL` correct? `vector` extension created?
- **Backend never healthy**: read the `datepgv-backend` window; verify DB restore and env.
- **Broken frontend**: run `Deploy-02-Frontend.bat` so `frontend\.next` exists.
- **Cannot open `http://<ip>:3000` from another machine**: (1) Ensure the `datepgv-frontend` window is running. (2) `npm run start` / `npm run dev` bind **`0.0.0.0:3000`**; on the **frontend host**, `netstat -an | findstr ":3000"` should show `0.0.0.0:3000` `LISTENING`. (3) **Windows Firewall**: add an inbound allow rule for **Node.js** or **TCP port 3000** (only on trusted networks). (4) Confirm the IP is the NIC of the machine running Next.js and the client can route to it.
