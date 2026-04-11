"""
One-time startup SQL migrations.

These run every time the app starts, but are idempotent – they check
current state before applying changes so re-runs are safe.
"""
import logging

from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

logger = logging.getLogger(__name__)


async def run_migrations() -> None:
    """Apply pending schema / data migrations at startup."""
    async with engine.begin() as conn:
        await _fix_user_id_column_type(conn)
        await _migrate_orphaned_sessions(conn)
        await _enforce_session_user_id_not_null(conn)
        await _ensure_user_id_fk(conn)
        await _ensure_data_scope_policy_table(conn)
        await _backfill_scope_policies_from_users(conn)
        await _ensure_rag_chunks_table(conn)
        await _ensure_users_rag_permission_override(conn)


async def _fix_user_id_column_type(conn) -> None:  # type: ignore[type-arg]
    """Convert chat_sessions.user_id from VARCHAR to INTEGER if needed.

    Early versions of the schema created this column as character varying.
    The ORM model expects integer (FK → users.id).
    """
    row = await conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'chat_sessions' AND column_name = 'user_id'"
        )
    )
    dtype = row.scalar()
    if dtype is None:
        return
    if dtype == "integer":
        return  # already correct

    logger.info(
        "DB migration: chat_sessions.user_id is '%s', converting to integer …",
        dtype,
    )

    # Delete rows whose user_id cannot be cast or references a non-existent user
    await conn.execute(
        text(
            "DELETE FROM chat_sessions "
            "WHERE user_id !~ '^[0-9]+$' "
            "   OR user_id::integer NOT IN (SELECT id FROM users)"
        )
    )

    await conn.execute(
        text(
            "ALTER TABLE chat_sessions "
            "ALTER COLUMN user_id TYPE integer USING user_id::integer"
        )
    )
    logger.info("DB migration: chat_sessions.user_id converted to integer.")


async def _migrate_orphaned_sessions(conn) -> None:  # type: ignore[type-arg]
    """Assign chat_sessions with user_id IS NULL to the admin user."""
    result = await conn.execute(
        text(
            "UPDATE chat_sessions "
            "SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1) "
            "WHERE user_id IS NULL "
            "  AND EXISTS (SELECT 1 FROM users WHERE username = 'admin')"
        )
    )
    if result.rowcount > 0:
        logger.info(
            "DB migration: assigned %d orphaned session(s) to admin.",
            result.rowcount,
        )


async def _enforce_session_user_id_not_null(conn) -> None:  # type: ignore[type-arg]
    """Add NOT NULL constraint to chat_sessions.user_id once no NULL rows remain."""
    nullable_row = await conn.execute(
        text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'chat_sessions' AND column_name = 'user_id'"
        )
    )
    row = nullable_row.fetchone()
    if row is None or row[0] != "YES":
        return

    null_count_row = await conn.execute(
        text("SELECT COUNT(*) FROM chat_sessions WHERE user_id IS NULL")
    )
    remaining = null_count_row.scalar() or 0
    if remaining > 0:
        logger.warning(
            "DB migration: %d session(s) still have user_id IS NULL. "
            "NOT NULL constraint deferred.",
            remaining,
        )
        return

    await conn.execute(
        text("ALTER TABLE chat_sessions ALTER COLUMN user_id SET NOT NULL")
    )
    logger.info("DB migration: chat_sessions.user_id is now NOT NULL.")


async def _ensure_user_id_fk(conn) -> None:  # type: ignore[type-arg]
    """Add FK constraint user_id → users.id if missing."""
    fk_exists = await conn.execute(
        text(
            "SELECT 1 FROM pg_constraint "
            "WHERE conrelid = 'chat_sessions'::regclass "
            "  AND conname = 'chat_sessions_user_id_fkey'"
        )
    )
    if fk_exists.scalar() is not None:
        return

    await conn.execute(
        text(
            "ALTER TABLE chat_sessions "
            "ADD CONSTRAINT chat_sessions_user_id_fkey "
            "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
        )
    )
    logger.info("DB migration: added FK chat_sessions.user_id → users.id.")


async def _ensure_data_scope_policy_table(conn) -> None:  # type: ignore[type-arg]
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'data_scope_policies' LIMIT 1"
        )
    )
    if exists_row.scalar() is not None:
        return

    await conn.execute(
        text(
            """
            CREATE TABLE data_scope_policies (
                id SERIAL PRIMARY KEY,
                subject_type VARCHAR(20) NOT NULL,
                subject_key VARCHAR(120) NOT NULL,
                dimension VARCHAR(32) NOT NULL,
                allowed_values JSONB NOT NULL DEFAULT '[]'::jsonb,
                deny_values JSONB NOT NULL DEFAULT '[]'::jsonb,
                merge_mode VARCHAR(16) NOT NULL DEFAULT 'union',
                priority INTEGER NOT NULL DEFAULT 100,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                note TEXT NULL,
                updated_by VARCHAR(100) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_data_scope_policy_subject_dimension
                    UNIQUE(subject_type, subject_key, dimension)
            )
            """
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_data_scope_policies_subject "
            "ON data_scope_policies(subject_type, subject_key)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_data_scope_policies_dim_enabled "
            "ON data_scope_policies(dimension, enabled)"
        )
    )
    logger.info("DB migration: created table data_scope_policies.")


async def _backfill_scope_policies_from_users(conn) -> None:  # type: ignore[type-arg]
    if not settings.SCOPE_POLICY_AUTO_BACKFILL_ON_STARTUP:
        return
    # Province baseline
    province_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'province',
              to_jsonb(ARRAY[u.province]),
              '[]'::jsonb,
              'replace',
              100,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.province), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    # Region baseline
    region_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'region',
              to_jsonb(ARRAY[u.org_region]),
              '[]'::jsonb,
              'replace',
              110,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.org_region), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    # District baseline
    district_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'district',
              to_jsonb(ARRAY[u.district]),
              '[]'::jsonb,
              'replace',
              120,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.district), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    seeded = (
        (province_res.rowcount or 0)
        + (region_res.rowcount or 0)
        + (district_res.rowcount or 0)
    )
    if seeded > 0:
        logger.info("DB migration: seeded %d baseline scope policies from users.", seeded)


async def _ensure_rag_chunks_table(conn) -> None:  # type: ignore[type-arg]
    """Create rag_chunks + indexes when missing (vector dim from settings.EMBEDDING_DIM)."""
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'rag_chunks' LIMIT 1"
        )
    )
    dim = int(settings.EMBEDDING_DIM)
    if exists_row.scalar() is None:
        await conn.execute(
            text(
                f"""
                CREATE TABLE rag_chunks (
                    id              BIGSERIAL PRIMARY KEY,
                    content         TEXT NOT NULL,
                    embedding       vector({dim}),
                    metadata        JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    hierarchy_path  JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT chk_rag_chunks_hierarchy_path_is_array
                        CHECK (jsonb_typeof(hierarchy_path) = 'array'),
                    CONSTRAINT chk_rag_chunks_metadata_hierarchy_path
                        CHECK (
                            NOT (metadata ? 'hierarchy_path')
                            OR jsonb_typeof(metadata->'hierarchy_path') = 'array'
                        )
                )
                """
            )
        )
        logger.info("DB migration: created table rag_chunks (vector(%d)).", dim)
    else:
        # Optional sanity check: embedding column dimension vs settings
        col = await conn.execute(
            text(
                "SELECT format_type(a.atttypid, a.atttypmod) AS pg_type "
                "FROM pg_attribute a "
                "JOIN pg_class c ON a.attrelid = c.oid "
                "WHERE c.relname = 'rag_chunks' AND a.attname = 'embedding' "
                "AND NOT a.attisdropped AND a.attnum > 0"
            )
        )
        row = col.fetchone()
        if row and row[0] and str(dim) not in str(row[0]):
            logger.warning(
                "DB migration: rag_chunks.embedding type is %s but EMBEDDING_DIM=%s; "
                "align model output with DB or recreate rag_chunks.",
                row[0],
                dim,
            )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS rag_chunks_hierarchy_path_gin "
            "ON rag_chunks USING gin (hierarchy_path jsonb_path_ops)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx "
            "ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"
        )
    )


async def _ensure_users_rag_permission_override(conn) -> None:  # type: ignore[type-arg]
    col = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'users' "
            "AND column_name = 'rag_permission_override'"
        )
    )
    if col.scalar() is not None:
        return
    await conn.execute(
        text(
            "ALTER TABLE users ADD COLUMN rag_permission_override JSONB NULL"
        )
    )
    await conn.execute(
        text(
            "COMMENT ON COLUMN users.rag_permission_override IS "
            "'Admin RAG ABAC override JSON; NULL means auto from org CSV'"
        )
    )
    logger.info("DB migration: added users.rag_permission_override.")
