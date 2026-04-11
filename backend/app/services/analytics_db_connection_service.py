from __future__ import annotations

from typing import Literal
from urllib.parse import unquote, urlparse, urlunparse

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.analytics_db_connection import AnalyticsDbConnection

SqlEngine = Literal["postgresql", "mysql"]


def normalize_postgres_dsn(url: str) -> str:
    u = url.strip()
    if "://" in u:
        scheme_part = u.split("://", 1)[0]
        if "+asyncpg" in scheme_part:
            u = u.replace("postgresql+asyncpg://", "postgresql://", 1)
    return u


def mask_database_url(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None
    u = url.strip()
    p = urlparse(u)
    if not p.scheme:
        return "****"
    host = p.hostname or ""
    port = f":{p.port}" if p.port else ""
    user = unquote(p.username) if p.username else ""
    if p.username is not None or p.password is not None:
        auth = f"{user}:****" if user else "****"
        netloc = f"{auth}@{host}{port}" if (host or port) else auth
    else:
        netloc = f"{host}{port}"
    return urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))


def _url_from_row(engine: SqlEngine, url: str) -> str:
    u = url.strip()
    if engine == "postgresql":
        return normalize_postgres_dsn(u)
    return u


async def resolve_execute_url(
    db: AsyncSession,
    engine: SqlEngine,
    connection_id: int | None,
) -> str | None:
    """
    Resolve DSN: explicit id (must match engine), else default row for engine, else env.
    Returns None if no URL available (caller may error).
    """
    if connection_id is not None:
        row = await db.get(AnalyticsDbConnection, connection_id)
        if not row or row.engine != engine:
            return None
        if not row.url or not str(row.url).strip():
            return None
        return _url_from_row(engine, row.url)

    result = await db.execute(
        select(AnalyticsDbConnection).where(
            AnalyticsDbConnection.engine == engine,
            AnalyticsDbConnection.is_default.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    if row and row.url and str(row.url).strip():
        return _url_from_row(engine, row.url)

    if engine == "postgresql":
        return settings.effective_analytics_postgres_url()
    u = settings.ANALYTICS_MYSQL_URL
    if u and str(u).strip():
        return str(u).strip()
    return None


async def effective_postgres_execute_url(db: AsyncSession) -> str | None:
    return await resolve_execute_url(db, "postgresql", None)


async def effective_mysql_execute_url(db: AsyncSession) -> str | None:
    return await resolve_execute_url(db, "mysql", None)


async def _clear_defaults_for_engine(
    db: AsyncSession, engine: SqlEngine, except_id: int | None = None
) -> None:
    q = select(AnalyticsDbConnection.id).where(
        AnalyticsDbConnection.engine == engine,
        AnalyticsDbConnection.is_default.is_(True),
    )
    if except_id is not None:
        q = q.where(AnalyticsDbConnection.id != except_id)
    result = await db.execute(q)
    ids = [r[0] for r in result.all()]
    if not ids:
        return
    await db.execute(
        update(AnalyticsDbConnection)
        .where(AnalyticsDbConnection.id.in_(ids))
        .values(is_default=False)
    )


async def ensure_default_after_delete(db: AsyncSession, engine: SqlEngine) -> None:
    """If engine has no default row, set smallest id as default."""
    r = await db.execute(
        select(AnalyticsDbConnection.id).where(
            AnalyticsDbConnection.engine == engine,
            AnalyticsDbConnection.is_default.is_(True),
        )
    )
    if r.scalar_one_or_none() is not None:
        return
    r2 = await db.execute(
        select(AnalyticsDbConnection.id)
        .where(AnalyticsDbConnection.engine == engine)
        .order_by(AnalyticsDbConnection.id.asc())
        .limit(1)
    )
    next_id = r2.scalar_one_or_none()
    if next_id is None:
        return
    await db.execute(
        update(AnalyticsDbConnection)
        .where(AnalyticsDbConnection.id == next_id)
        .values(is_default=True)
    )
