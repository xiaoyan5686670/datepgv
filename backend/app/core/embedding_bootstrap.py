"""
Run once at app startup: read embedding_dim from app_settings (or infer from DB),
set it so the TableMetadata model uses the correct vector size. Must run before
any code imports app.models.metadata. Uses sync DB connection to avoid asyncio.run()
inside an existing event loop (e.g. uvicorn --reload).
"""
from __future__ import annotations

from sqlalchemy import create_engine, text

from app.core.config import settings
from app.core.embedding_dim import set_embedding_dim


def _sync_url() -> str:
    """Convert asyncpg URL to sync psycopg2 URL."""
    url = settings.DATABASE_URL
    if "+asyncpg" in url:
        return url.replace("postgresql+asyncpg", "postgresql+psycopg2", 1)
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1).replace("postgres://", "postgresql+psycopg2://", 1)
    return url


def _infer_dim_from_table(conn) -> int | None:
    """Infer embedding dimension from table_metadata.embedding column (pgvector atttypmod)."""
    try:
        row = conn.execute(text("""
            SELECT a.atttypmod
            FROM pg_attribute a
            JOIN pg_class c ON a.attrelid = c.oid
            WHERE c.relname = 'table_metadata' AND a.attname = 'embedding'
              AND a.attnum > 0 AND NOT a.attisdropped
        """))
        r = row.fetchone()
        if r and r[0] is not None and r[0] > 0:
            return int(r[0])
    except Exception:
        pass
    return None


def run_bootstrap() -> None:
    engine = create_engine(
        _sync_url(),
        echo=False,
        pool_pre_ping=True,
    )
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """))
            row = conn.execute(text("SELECT value FROM app_settings WHERE key = 'embedding_dim'"))
            if row.fetchone():
                pass
            else:
                inferred = _infer_dim_from_table(conn)
                dim = str(inferred if inferred else settings.EMBEDDING_DIM)
                conn.execute(
                    text("INSERT INTO app_settings (key, value) VALUES ('embedding_dim', :d)"),
                    {"d": dim},
                )
        with engine.connect() as conn:
            row = conn.execute(text("SELECT value FROM app_settings WHERE key = 'embedding_dim'"))
            r = row.fetchone()
            if r:
                set_embedding_dim(int(r[0]))
                return
    finally:
        engine.dispose()
    set_embedding_dim(settings.EMBEDDING_DIM)
