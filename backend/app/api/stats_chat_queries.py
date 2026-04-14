"""Read-only statistics for user chat questions (admin + self-service)."""

from __future__ import annotations

import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user, require_admin
from app.models.schemas import ChatQueryStatsResponse
from app.models.user import User
from app.services.chat_query_stats import (
    build_chat_query_stats_payload,
    csv_rows_for_export,
    filters_from_query,
)

router = APIRouter(prefix="/stats/chat-queries", tags=["stats"])


def _trend_days(v: int) -> int:
    return max(1, min(int(v), 366))


def _top_n(v: int) -> int:
    return max(1, min(int(v), 100))


@router.get("/me", response_model=ChatQueryStatsResponse)
async def stats_chat_queries_me(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    date_from: str | None = Query(None, description="YYYY-MM-DD（含）"),
    date_to: str | None = Query(None, description="YYYY-MM-DD（含）"),
    trend_days: int = Query(30, ge=1, le=366),
    top_n: int = Query(20, ge=1, le=100),
) -> ChatQueryStatsResponse:
    try:
        flt = filters_from_query(
            user_id=current_user.id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    payload = await build_chat_query_stats_payload(
        db, flt, trend_days=_trend_days(trend_days), top_n=_top_n(top_n)
    )
    return ChatQueryStatsResponse.model_validate(payload)


@router.get("", response_model=ChatQueryStatsResponse)
async def stats_chat_queries_admin(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
    user_id: int | None = Query(None, ge=1, description="按用户过滤；省略则全站"),
    date_from: str | None = Query(None, description="YYYY-MM-DD（含）"),
    date_to: str | None = Query(None, description="YYYY-MM-DD（含）"),
    trend_days: int = Query(30, ge=1, le=366),
    top_n: int = Query(20, ge=1, le=100),
) -> ChatQueryStatsResponse:
    try:
        flt = filters_from_query(
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    payload = await build_chat_query_stats_payload(
        db, flt, trend_days=_trend_days(trend_days), top_n=_top_n(top_n)
    )
    return ChatQueryStatsResponse.model_validate(payload)


@router.get("/export.csv")
async def export_chat_query_top_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
    user_id: int | None = Query(None, ge=1),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    top_n: int = Query(100, ge=1, le=500),
) -> StreamingResponse:
    try:
        flt = filters_from_query(
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    top_clamped = max(1, min(int(top_n), 500))
    payload = await build_chat_query_stats_payload(
        db, flt, trend_days=1, top_n=top_clamped
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in csv_rows_for_export(payload):
        writer.writerow(row)
    buf.seek(0)
    filename = "chat_query_top.csv"
    if user_id:
        filename = f"chat_query_top_user_{user_id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
