from __future__ import annotations

import logging
from datetime import timedelta
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.deps.auth import get_current_active_user
from app.models.schemas import TokenResponse, UserMeResponse
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=TokenResponse)
async def login_access_token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    result = await db.execute(
        select(User)
        .where(User.username == form.username)
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="用户已停用")
    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token, token_type="bearer")


@router.get("/me", response_model=UserMeResponse)
async def read_me(
    current: Annotated[User, Depends(get_current_active_user)],
) -> UserMeResponse:
    return UserMeResponse(
        id=current.id,
        username=current.username,
        is_active=current.is_active,
        roles=[r.name for r in current.roles],
        province=current.province,
        employee_level=current.employee_level,
        district=current.district,
        full_name=current.full_name,
    )


@router.get("/trusted-login")
async def trusted_login(
    request: Request,
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    next: str | None = Query(None, description="登录成功后前端路由，须以 / 开头"),
) -> RedirectResponse:
    """
    办公网场景：仅通过 user_id（与 users.username 匹配，大小写不敏感）免密换 JWT。
    成功则 302 到 TRUSTED_SSO_FRONTEND_BASE/sso/callback#access_token=...
    """
    _FAIL = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="登录失败")

    configured = settings.TRUSTED_SSO_SECRET
    if configured and str(configured).strip():
        expected = str(configured).strip()
        got = request.headers.get("X-Trusted-Sso-Secret") or request.headers.get(
            "x-trusted-sso-secret"
        )
        if not got or got != expected:
            logger.warning(
                "trusted_login rejected: secret mismatch or missing user_id_prefix=%s",
                (user_id.strip()[:4] + "…") if len(user_id.strip()) > 4 else "",
            )
            raise _FAIL

    key = user_id.strip()
    if not key:
        logger.warning("trusted_login rejected: empty user_id")
        raise _FAIL

    result = await db.execute(
        select(User).where(func.lower(User.username) == key.lower())
    )
    rows = list(result.scalars().all())
    if len(rows) > 1:
        logger.error(
            "trusted_login: multiple users match case-insensitive username prefix=%s…",
            key[:4],
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="登录失败",
        )
    if len(rows) == 0:
        logger.warning(
            "trusted_login: no user for prefix=%s…",
            key[:4] if len(key) > 4 else key,
        )
        raise _FAIL

    user = rows[0]
    if not user.is_active:
        logger.warning("trusted_login: user inactive id=%s", user.id)
        raise _FAIL

    expire_min = settings.TRUSTED_SSO_ACCESS_TOKEN_MINUTES
    delta = (
        timedelta(minutes=expire_min)
        if expire_min is not None
        else None
    )
    if delta is None:
        token = create_access_token(subject=str(user.id))
    else:
        token = create_access_token(subject=str(user.id), expires_delta=delta)

    base = settings.TRUSTED_SSO_FRONTEND_BASE.strip().rstrip("/")
    fragment = f"access_token={quote(token, safe='')}"
    next_q = ""
    if next and next.strip().startswith("/") and not next.strip().startswith("//"):
        next_q = f"?next={quote(next.strip(), safe='')}"
    location = f"{base}/sso/callback{next_q}#{fragment}"

    logger.info(
        "trusted_login success user_id=%s internal_user_pk=%s",
        user.username,
        user.id,
    )
    return RedirectResponse(url=location, status_code=status.HTTP_302_FOUND)
