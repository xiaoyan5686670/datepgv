"""Admin-only audit: login events and NL→SQL chat turns."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import require_admin
from app.models.schemas import (
    LoginAuditItem,
    LoginAuditListResponse,
    QueryAuditItem,
    QueryAuditListResponse,
)
from app.models.user import User
from app.services.audit_list import list_login_audits, list_query_audits

router = APIRouter(prefix="/audit", tags=["audit"])


def _parse_day(label: str, s: str | None) -> date | None:
    if s is None or not str(s).strip():
        return None
    try:
        return date.fromisoformat(str(s).strip())
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label} 须为 YYYY-MM-DD",
        ) from e


@router.get("/logins", response_model=LoginAuditListResponse)
async def audit_logins(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
    user_id: int | None = Query(None, ge=1, description="按用户 ID 过滤"),
    date_from: str | None = Query(None, description="YYYY-MM-DD（含）"),
    date_to: str | None = Query(None, description="YYYY-MM-DD（含）"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> LoginAuditListResponse:
    df = _parse_day("date_from", date_from)
    dt = _parse_day("date_to", date_to)
    if df and dt and df > dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date_from 不能晚于 date_to",
        )
    rows, total = await list_login_audits(
        db,
        user_id=user_id,
        day_from=df,
        day_to=dt,
        skip=skip,
        limit=limit,
    )
    return LoginAuditListResponse(
        items=[LoginAuditItem.model_validate(r) for r in rows],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/queries", response_model=QueryAuditListResponse)
async def audit_queries(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
    user_id: int | None = Query(None, ge=1),
    session_id: str | None = Query(None, max_length=64),
    date_from: str | None = Query(None, description="按助手消息时间，YYYY-MM-DD（含）"),
    date_to: str | None = Query(None, description="按助手消息时间，YYYY-MM-DD（含）"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> QueryAuditListResponse:
    df = _parse_day("date_from", date_from)
    dt = _parse_day("date_to", date_to)
    if df and dt and df > dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date_from 不能晚于 date_to",
        )
    rows, total = await list_query_audits(
        db,
        user_id=user_id,
        session_id=session_id.strip() if session_id else None,
        day_from=df,
        day_to=dt,
        skip=skip,
        limit=limit,
    )
    return QueryAuditListResponse(
        items=[QueryAuditItem.model_validate(r) for r in rows],
        total=total,
        skip=skip,
        limit=limit,
    )
