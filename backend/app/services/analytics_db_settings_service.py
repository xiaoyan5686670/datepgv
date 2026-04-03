from __future__ import annotations

from urllib.parse import unquote, urlparse, urlunparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.analytics_db_settings import AnalyticsDbSettings


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


async def get_analytics_settings_row(
    db: AsyncSession,
) -> AnalyticsDbSettings | None:
    result = await db.execute(select(AnalyticsDbSettings).where(AnalyticsDbSettings.id == 1))
    return result.scalar_one_or_none()


async def ensure_analytics_db_settings_row(db: AsyncSession) -> AnalyticsDbSettings:
    row = await get_analytics_settings_row(db)
    if row is None:
        row = AnalyticsDbSettings(id=1, postgres_url=None, mysql_url=None)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def effective_postgres_execute_url(db: AsyncSession) -> str | None:
    row = await get_analytics_settings_row(db)
    if row and row.postgres_url and row.postgres_url.strip():
        return normalize_postgres_dsn(row.postgres_url.strip())
    return settings.effective_analytics_postgres_url()


async def effective_mysql_execute_url(db: AsyncSession) -> str | None:
    row = await get_analytics_settings_row(db)
    if row and row.mysql_url and row.mysql_url.strip():
        return row.mysql_url.strip()
    u = settings.ANALYTICS_MYSQL_URL
    if u and str(u).strip():
        return str(u).strip()
    return None
