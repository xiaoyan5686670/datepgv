from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class UserPermission(BaseModel):
    """ABAC snapshot for hierarchical RAG: allowed JSONB path prefixes."""

    unrestricted: bool = False
    """When True, skip hierarchy_path @> filters (e.g. admin)."""

    allowed_prefix: list[str] | None = None
    """First prefix (convenience); None when unrestricted or no prefix resolved."""

    allowed_prefixes: list[list[str]] = Field(default_factory=list)
    """All path prefixes the user may match (OR semantics in SQL)."""

    attributes: dict[str, Any] = Field(default_factory=dict)
    """Optional ABAC attributes for auditing (employee_level, org_region, etc.)."""


class RagSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=8000)
    top_k: int | None = Field(default=None, ge=1, le=100)


class RagSearchHit(BaseModel):
    id: int
    content: str
    metadata: dict[str, Any]
    distance: float


class RagSearchResponse(BaseModel):
    hits: list[RagSearchHit]
    permission: UserPermission


class RagPermissionOverrideInput(BaseModel):
    """Persisted JSON shape: ``{\"unrestricted\": true}`` or ``{\"prefixes\": [[...], ...]}``."""

    unrestricted: bool = False
    prefixes: list[list[str]] = Field(default_factory=list)


class AdminPutRagPermissionRequest(BaseModel):
    """``override=null`` clears manual rule and restores 通讯录推导。"""

    override: RagPermissionOverrideInput | None = None


class AdminUserRagPermissionResponse(BaseModel):
    """管理员查看某用户 RAG 层级权限：生效值、自动推导值、库中覆盖。"""

    effective: UserPermission
    org_baseline: UserPermission
    stored_override: dict[str, Any] | None = None
