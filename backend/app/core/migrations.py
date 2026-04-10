"""
One-time startup SQL migrations.

These run every time the app starts, but are idempotent – they check
current state before applying changes so re-runs are safe.
"""
import logging

from sqlalchemy import text

from app.core.database import engine

logger = logging.getLogger(__name__)


async def run_migrations() -> None:
    """Apply pending schema / data migrations at startup."""
    async with engine.begin() as conn:
        await _fix_user_id_column_type(conn)
        await _migrate_orphaned_sessions(conn)
        await _enforce_session_user_id_not_null(conn)
        await _ensure_user_id_fk(conn)


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
