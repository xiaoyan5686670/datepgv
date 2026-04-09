from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或已过期的凭证",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise credentials_exception
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise credentials_exception from None

    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not user.is_active:
        raise HTTPException(status_code=400, detail="用户已停用")
    return user


async def require_admin(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    names = {r.name for r in user.roles}
    if "admin" not in names:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员角色",
        )
    return user


async def require_province_manager_or_admin(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Province managers and admins can manage users in their province."""
    names = {r.name for r in user.roles}
    if "admin" in names or "province_manager" in names:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="需要管理员或省管理角色",
    )
