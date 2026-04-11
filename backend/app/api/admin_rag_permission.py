"""
Admin-only APIs for viewing/editing per-user hierarchical RAG permission (ABAC prefixes).
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.deps.auth import require_admin
from app.models.rag_abac import (
    AdminPutRagPermissionRequest,
    AdminRagUserLookupResponse,
    AdminUserRagPermissionResponse,
    RagPermissionOverrideInput,
)
from app.models.user import User
from app.services.rag_permission_service import (
    compute_rag_org_baseline_permission,
    compute_rag_user_permission,
)

router = APIRouter(prefix="/admin", tags=["admin-rag"])

_MAX_PREFIX_GROUPS = 32
_MAX_PREFIX_DEPTH = 24
_MAX_SEGMENT_CHARS = 120


def _validate_override_input(body: RagPermissionOverrideInput) -> None:
    if body.unrestricted:
        return
    prefs = body.prefixes
    if len(prefs) > _MAX_PREFIX_GROUPS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"前缀组数量不能超过 {_MAX_PREFIX_GROUPS}",
        )
    for group in prefs:
        if not isinstance(group, list):
            raise HTTPException(status_code=400, detail="prefixes 必须为字符串数组的数组")
        if len(group) > _MAX_PREFIX_DEPTH:
            raise HTTPException(
                status_code=400,
                detail=f"单条前缀层级不能超过 {_MAX_PREFIX_DEPTH}",
            )
        for seg in group:
            if len(str(seg)) > _MAX_SEGMENT_CHARS:
                raise HTTPException(
                    status_code=400,
                    detail=f"路径片段长度不能超过 {_MAX_SEGMENT_CHARS}",
                )


def _stored_to_jsonable(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return dict(raw)
    return None


@router.get("/users/lookup-for-rag", response_model=AdminRagUserLookupResponse)
async def lookup_user_for_rag_admin(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
    username: str | None = Query(None, description="登录工号，精确匹配"),
    full_name: str | None = Query(None, description="姓名，精确匹配"),
) -> AdminRagUserLookupResponse:
    """按 username 和/或 full_name 查找单个用户（须唯一）。"""
    u = (username or "").strip()
    f = (full_name or "").strip()
    if not u and not f:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少提供 username 或 full_name 之一",
        )
    stmt = select(User).options(selectinload(User.roles))
    if u:
        stmt = stmt.where(User.username == u)
    if f:
        stmt = stmt.where(User.full_name == f)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="未找到匹配用户")
    if len(rows) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="匹配到多个用户，请同时填写工号与姓名以精确定位",
        )
    hit = rows[0]
    return AdminRagUserLookupResponse(
        id=hit.id,
        username=hit.username,
        full_name=hit.full_name,
    )


@router.get("/users/{user_id}/rag-permission", response_model=AdminUserRagPermissionResponse)
async def admin_get_user_rag_permission(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> AdminUserRagPermissionResponse:
    result = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return AdminUserRagPermissionResponse(
        effective=compute_rag_user_permission(user),
        org_baseline=compute_rag_org_baseline_permission(user),
        stored_override=_stored_to_jsonable(user.rag_permission_override),
    )


@router.put("/users/{user_id}/rag-permission", response_model=AdminUserRagPermissionResponse)
async def admin_put_user_rag_permission(
    user_id: int,
    body: AdminPutRagPermissionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> AdminUserRagPermissionResponse:
    result = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    if body.override is None:
        user.rag_permission_override = None
    else:
        _validate_override_input(body.override)
        if body.override.unrestricted:
            user.rag_permission_override = {"unrestricted": True}
        else:
            user.rag_permission_override = {
                "prefixes": [list(map(str, g)) for g in body.override.prefixes],
            }

    await db.commit()
    await db.refresh(user)
    return AdminUserRagPermissionResponse(
        effective=compute_rag_user_permission(user),
        org_baseline=compute_rag_org_baseline_permission(user),
        stored_override=_stored_to_jsonable(user.rag_permission_override),
    )
