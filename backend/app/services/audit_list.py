"""Admin read-only lists for login_audit and paired chat turns (user + assistant SQL)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.login_audit import LoginAudit
from app.models.user import User

_ORDERED_CTE_TEMPLATE = """
WITH ordered AS (
  SELECT
    m.id AS mid,
    m.session_id,
    m.role,
    m.content,
    m.generated_sql,
    m.sql_type,
    m.executed,
    m.elapsed_ms,
    {decision_trace_expr},
    m.created_at AS assistant_at,
    LAG(m.role) OVER w AS prev_role,
    LAG(m.content) OVER w AS prev_content,
    LAG(m.created_at) OVER w AS user_at
  FROM chat_messages m
  WINDOW w AS (PARTITION BY m.session_id ORDER BY m.created_at ASC, m.id ASC)
)
"""


def _utc_day_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _utc_day_end_exclusive(d: date) -> datetime:
    """First instant strictly after inclusive day `d` (UTC)."""
    return _utc_day_start(d + timedelta(days=1))


async def list_login_audits(
    db: AsyncSession,
    *,
    user_id: int | None,
    day_from: date | None,
    day_to: date | None,
    skip: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    def _apply_filters(stmt):  # type: ignore[no-untyped-def]
        s = stmt
        if user_id is not None:
            s = s.where(LoginAudit.user_id == user_id)
        if day_from is not None:
            s = s.where(LoginAudit.created_at >= _utc_day_start(day_from))
        if day_to is not None:
            s = s.where(LoginAudit.created_at < _utc_day_end_exclusive(day_to))
        return s

    count_q = _apply_filters(select(func.count()).select_from(LoginAudit))
    total = int((await db.execute(count_q)).scalar_one())

    base = _apply_filters(
        select(LoginAudit, User.username, User.full_name).join(
            User, LoginAudit.user_id == User.id
        )
    )
    q = (
        base.order_by(LoginAudit.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = (await db.execute(q)).all()
    items: list[dict[str, Any]] = []
    for la, username, full_name in rows:
        items.append(
            {
                "id": la.id,
                "user_id": la.user_id,
                "username": username,
                "full_name": full_name,
                "login_method": la.login_method,
                "client_ip": la.client_ip,
                "user_agent": la.user_agent,
                "created_at": la.created_at,
            }
        )
    return items, total


async def list_query_audits(
    db: AsyncSession,
    *,
    user_id: int | None,
    session_id: str | None,
    skill_name: str | None,
    blocked_only: bool | None,
    executed: bool | None,
    day_from: date | None,
    day_to: date | None,
    skip: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    decision_trace_exists = bool(
        (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'chat_messages' "
                    "AND column_name = 'decision_trace' LIMIT 1"
                )
            )
        ).scalar()
    )
    where_parts = [
        "o.role = 'assistant'",
        "o.generated_sql IS NOT NULL",
        "o.prev_role = 'user'",
    ]
    binds: dict[str, Any] = {}
    if user_id is not None:
        where_parts.append("s.user_id = :user_id")
        binds["user_id"] = user_id
    if session_id:
        where_parts.append("o.session_id = :session_id")
        binds["session_id"] = session_id
    if blocked_only is True and decision_trace_exists:
        where_parts.append("COALESCE(o.decision_trace->>'scope_blocked', 'false') = 'true'")
    if executed is True:
        where_parts.append("o.executed IS TRUE")
    elif executed is False:
        where_parts.append("COALESCE(o.executed, FALSE) IS FALSE")
    if skill_name and decision_trace_exists:
        where_parts.append(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(o.decision_trace->'selected_skill_names', '[]'::jsonb)) AS sn WHERE sn = :skill_name)"
        )
        binds["skill_name"] = skill_name
    if day_from is not None:
        where_parts.append("o.assistant_at >= :day_from_ts")
        binds["day_from_ts"] = _utc_day_start(day_from)
    if day_to is not None:
        where_parts.append("o.assistant_at < :day_to_end_ts")
        binds["day_to_end_ts"] = _utc_day_end_exclusive(day_to)

    where_sql = " AND ".join(where_parts)
    cte_decision_trace_expr = (
        "m.decision_trace AS decision_trace"
        if decision_trace_exists
        else "NULL::jsonb AS decision_trace"
    )
    ordered_cte = _ORDERED_CTE_TEMPLATE.format(
        decision_trace_expr=cte_decision_trace_expr
    )
    from_sql = f"""
{ordered_cte}
SELECT
  o.session_id,
  s.user_id,
  u.username,
  u.full_name,
  o.user_at AS user_message_at,
  o.assistant_at AS assistant_message_at,
  o.prev_content AS user_query,
  o.generated_sql,
  o.sql_type,
  o.executed,
  o.elapsed_ms,
  o.decision_trace
FROM ordered o
JOIN chat_sessions s ON s.session_id = o.session_id
JOIN users u ON u.id = s.user_id
WHERE {where_sql}
"""
    count_sql = f"SELECT COUNT(*) FROM ({from_sql}) AS subq"
    total = int((await db.execute(text(count_sql), binds)).scalar_one())

    page_sql = from_sql + " ORDER BY o.assistant_at DESC OFFSET :skip LIMIT :limit"
    binds_page = {**binds, "skip": skip, "limit": limit}
    result = await db.execute(text(page_sql), binds_page)
    # 勿用 row._mapping：RowMapping 会把属性当作列名，触发 NoSuchColumnError('_mapping')
    items = [dict(r) for r in result.mappings().all()]
    for item in items:
        dt = item.get("decision_trace") or {}
        if not isinstance(dt, dict):
            dt = {}
        names = dt.get("selected_skill_names")
        item["selected_skill_names"] = names if isinstance(names, list) else []
        item["scope_block_reason"] = dt.get("scope_block_reason")
        item["execution_error_category"] = dt.get("execution_error_category")
        item.pop("decision_trace", None)
    return items, total
