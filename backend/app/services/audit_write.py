"""Persist login audit rows (successful auth only)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.login_audit import LoginAudit
from app.services.request_client_meta import client_ip_from_request, user_agent_from_request

if TYPE_CHECKING:
    from starlette.requests import Request

LoginMethod = Literal["password", "trusted_sso"]


async def record_login_audit(
    db: AsyncSession,
    *,
    user_id: int,
    login_method: LoginMethod,
    request: Request | None = None,
) -> None:
    ip = client_ip_from_request(request) if request else None
    ua = user_agent_from_request(request) if request else None
    db.add(
        LoginAudit(
            user_id=user_id,
            login_method=login_method,
            client_ip=ip,
            user_agent=ua,
        )
    )
    await db.commit()
