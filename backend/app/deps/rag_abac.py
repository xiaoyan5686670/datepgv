from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.deps.auth import get_current_active_user
from app.models.rag_abac import UserPermission
from app.models.user import User
from app.services.rag_permission_service import compute_rag_user_permission


async def get_user_permission(
    user: Annotated[User, Depends(get_current_active_user)],
) -> UserPermission:
    """Inject ABAC hierarchy prefixes for RAG routes (sync compute, no extra DB round-trip)."""
    return compute_rag_user_permission(user)
