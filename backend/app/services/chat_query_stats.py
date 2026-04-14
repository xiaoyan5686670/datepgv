"""
Aggregated statistics over user chat questions (role=user).

Normalization (PostgreSQL): trim → collapse ASCII whitespace runs → lower case.
Used as the GROUP BY key for "high frequency" questions without semantic clustering.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Sequence

from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.chat import ChatMessage, ChatSession


def normalized_question_key(column: ColumnElement[Any]) -> ColumnElement[Any]:
    """
    Deterministic normalization for grouping similar phrasings.

    - Outer trim removes leading/trailing whitespace.
    - regexp_replace collapses internal whitespace runs to a single space (PostgreSQL).
    - lower() merges case variants.

    Note: semantic paraphrases are not merged here (see docs for phase-2 clustering).
    """
    trimmed = func.trim(column)
    squashed = func.regexp_replace(trimmed, r"\s+", " ", "g")
    return func.lower(func.trim(squashed))


def normalize_question_text(s: str) -> str:
    """
    Python mirror of `normalized_question_key` (for tests and previews).
    Keep in sync with the SQL expression above.
    """
    squashed = re.sub(r"\s+", " ", (s or "").strip())
    return squashed.lower().strip()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_day(s: str | None) -> date | None:
    if not s or not str(s).strip():
        return None
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except ValueError:
        return None


@dataclass(frozen=True)
class StatsFilters:
    user_id: int | None  # None = all users (admin only)
    day_from: date | None
    day_to: date | None  # inclusive end date


def _base_user_messages_filter(filters: StatsFilters) -> Any:
    nk = normalized_question_key(ChatMessage.content)
    conds = [
        ChatMessage.role == "user",
        nk != "",
        nk.isnot(None),
    ]
    if filters.user_id is not None:
        conds.append(ChatSession.user_id == filters.user_id)
    day_bucket = cast(ChatMessage.created_at, Date)
    if filters.day_from is not None:
        conds.append(day_bucket >= filters.day_from)
    if filters.day_to is not None:
        conds.append(day_bucket <= filters.day_to)
    return and_(*conds)


async def fetch_summary(
    db: AsyncSession,
    filters: StatsFilters,
) -> dict[str, Any]:
    base = (
        select(ChatMessage.id)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(_base_user_messages_filter(filters))
    )
    sub = base.subquery()

    total = await db.execute(select(func.count()).select_from(sub))
    total_questions = int(total.scalar_one() or 0)

    day_col = cast(ChatMessage.created_at, Date)
    active_stmt = (
        select(func.count(func.distinct(day_col)))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(_base_user_messages_filter(filters))
    )
    active_days = int((await db.execute(active_stmt)).scalar_one() or 0)

    sess_stmt = (
        select(func.count(func.distinct(ChatMessage.session_id)))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(_base_user_messages_filter(filters))
    )
    distinct_sessions = int((await db.execute(sess_stmt)).scalar_one() or 0)

    last_stmt = (
        select(func.max(ChatMessage.created_at))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(_base_user_messages_filter(filters))
    )
    last_at = (await db.execute(last_stmt)).scalar_one()

    return {
        "total_questions": total_questions,
        "active_days": active_days,
        "distinct_sessions": distinct_sessions,
        "last_question_at": last_at,
    }


async def fetch_daily_trend(
    db: AsyncSession,
    filters: StatsFilters,
    *,
    trend_days: int,
) -> list[dict[str, Any]]:
    """Last `trend_days` calendar days including today (UTC date), zero-filled gaps omitted."""
    trend_days = max(1, min(trend_days, 366))
    end_d = _utc_now().date()
    start_d = end_d - timedelta(days=trend_days - 1)
    # intersect with optional filter range
    if filters.day_from is not None and filters.day_from > start_d:
        start_d = filters.day_from
    if filters.day_to is not None and filters.day_to < end_d:
        end_d = filters.day_to

    day_col = cast(ChatMessage.created_at, Date)
    stmt = (
        select(day_col.label("d"), func.count().label("c"))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(
            _base_user_messages_filter(filters),
            day_col >= start_d,
            day_col <= end_d,
        )
        .group_by(day_col)
        .order_by(day_col.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [{"date": r.d.isoformat(), "count": int(r.c)} for r in rows]


async def fetch_top_normalized_queries(
    db: AsyncSession,
    filters: StatsFilters,
    *,
    top_n: int,
    example_max_len: int = 200,
) -> list[dict[str, Any]]:
    top_n = max(1, min(top_n, 100))
    nk = normalized_question_key(ChatMessage.content)

    cnt_stmt = (
        select(nk.label("nk"), func.count().label("cnt"), func.min(ChatMessage.id).label("min_id"))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.session_id == ChatMessage.session_id)
        .where(_base_user_messages_filter(filters))
        .group_by(nk)
        .order_by(func.count().desc())
        .limit(top_n)
    )
    cnt_rows = (await db.execute(cnt_stmt)).all()
    if not cnt_rows:
        return []

    id_list = [int(r.min_id) for r in cnt_rows]
    ex_stmt = select(ChatMessage.id, ChatMessage.content).where(ChatMessage.id.in_(id_list))
    ex_rows = (await db.execute(ex_stmt)).all()
    id_to_content = {int(r.id): (r.content or "") for r in ex_rows}

    out: list[dict[str, Any]] = []
    for r in cnt_rows:
        raw = id_to_content.get(int(r.min_id), "")
        snippet = raw if len(raw) <= example_max_len else raw[: example_max_len - 1] + "…"
        out.append(
            {
                "normalized_key": r.nk,
                "count": int(r.cnt),
                "example_snippet": snippet,
                "example_query": raw,
            }
        )
    return out


async def build_chat_query_stats_payload(
    db: AsyncSession,
    filters: StatsFilters,
    *,
    trend_days: int,
    top_n: int,
) -> dict[str, Any]:
    summary = await fetch_summary(db, filters)
    trend = await fetch_daily_trend(db, filters, trend_days=trend_days)
    top = await fetch_top_normalized_queries(db, filters, top_n=top_n)
    return {
        "summary": summary,
        "daily_trend": trend,
        "top_queries": top,
        "filters": {
            "user_id": filters.user_id,
            "day_from": filters.day_from.isoformat() if filters.day_from else None,
            "day_to": filters.day_to.isoformat() if filters.day_to else None,
        },
    }


def filters_from_query(
    *,
    user_id: int | None,
    date_from: str | None,
    date_to: str | None,
) -> StatsFilters:
    df = _parse_day(date_from)
    dt = _parse_day(date_to)
    if df is not None and dt is not None and df > dt:
        raise ValueError("date_from 不能晚于 date_to")
    return StatsFilters(user_id=user_id, day_from=df, day_to=dt)


def csv_rows_for_export(payload: dict[str, Any]) -> Sequence[Sequence[str]]:
    """Flatten top_queries for text/csv export."""
    header = ["normalized_key", "count", "example_snippet"]
    rows = [header]
    for item in payload.get("top_queries") or []:
        rows.append(
            [
                str(item.get("normalized_key", "")),
                str(item.get("count", "")),
                str(item.get("example_snippet", "")).replace("\r", " ").replace("\n", " "),
            ]
        )
    return rows
