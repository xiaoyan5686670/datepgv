"""
LLM & Embedding configuration management API.
Provides CRUD operations, activation, and connection testing for model configs.
"""
from __future__ import annotations

import time
from typing import Literal

import httpx
import litellm
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.deps.auth import require_admin
from app.models.analytics_db_connection import AnalyticsDbConnection
from app.models.llm_config import LLMConfig
from app.models.data_scope_policy import DataScopePolicy
from app.models.user import User
from app.models.schemas import (
    AnalyticsDbConnectionCreate,
    AnalyticsDbConnectionResponse,
    AnalyticsDbConnectionTestRequest,
    AnalyticsDbConnectionUpdate,
    DataScopePolicyCreate,
    DataScopePolicyResponse,
    DataScopePolicyUpdate,
    LLMConfigCreate,
    LLMConfigResponse,
    LLMConfigTestResult,
    LLMConfigUpdate,
)
from app.services.litellm_kwargs import (
    assert_safe_ollama_api_base,
    build_completion_kwargs,
    build_embedding_kwargs,
)
from app.services.scope_policy_service import resolve_user_scope

router = APIRouter(
    prefix="/config",
    tags=["config"],
    dependencies=[Depends(require_admin)],
)


def _normalize_scope_policy_payload(data: dict) -> dict:
    if data.get("subject_type") == "user":
        data["subject_type"] = "user_id"
    if isinstance(data.get("allowed_values"), list):
        data["allowed_values"] = [str(v).strip() for v in data["allowed_values"] if str(v).strip()]
    if isinstance(data.get("deny_values"), list):
        data["deny_values"] = [str(v).strip() for v in data["deny_values"] if str(v).strip()]
    if isinstance(data.get("subject_key"), str):
        data["subject_key"] = data["subject_key"].strip()
    if data.get("subject_type") == "user_id":
        data["subject_key"] = str(data.get("subject_key") or "").strip()
    allow = set(data.get("allowed_values") or [])
    deny = set(data.get("deny_values") or [])
    overlap = sorted(allow & deny)
    if overlap:
        raise HTTPException(
            status_code=422,
            detail=f"allowed_values 与 deny_values 不能重叠: {overlap}",
        )
    return data


def _to_response(row: LLMConfig) -> LLMConfigResponse:
    return LLMConfigResponse(
        id=row.id,
        name=row.name,
        config_type=row.config_type,
        model=row.model,
        api_key_set=bool(row.api_key),
        api_base=row.api_base,
        extra_params=row.extra_params or {},
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ── Ollama model discovery (must stay before /{config_id} for clarity) ───────

@router.get("/ollama/models")
async def list_ollama_models(
    api_base: str = Query(..., description="Ollama base URL, e.g. http://127.0.0.1:11434"),
) -> dict:
    """
    Proxy Ollama GET /api/tags so the settings UI can populate model names.
    """
    try:
        safe_base = assert_safe_ollama_api_base(api_base)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    url = f"{safe_base}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"无法连接 Ollama: {e}",
        ) from e

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 返回 HTTP {resp.status_code}",
        )

    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Ollama 响应不是合法 JSON") from None

    raw_models = data.get("models") or []
    names: list[str] = []
    for item in raw_models:
        if isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
    names = sorted(set(names))
    return {"models": names}


# ── Analytics DB connections (must stay before /{config_id}) ─────────────────


def _analytics_connection_to_response(row: AnalyticsDbConnection) -> AnalyticsDbConnectionResponse:
    from app.services.analytics_db_connection_service import mask_database_url

    return AnalyticsDbConnectionResponse(
        id=row.id,
        name=row.name,
        engine=row.engine,  # type: ignore[arg-type]
        url_masked=mask_database_url(row.url),
        is_default=row.is_default,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/analytics-connections", response_model=list[AnalyticsDbConnectionResponse])
async def list_analytics_connections(
    db: AsyncSession = Depends(get_db),
) -> list[AnalyticsDbConnectionResponse]:
    result = await db.execute(
        select(AnalyticsDbConnection).order_by(
            AnalyticsDbConnection.engine.asc(),
            AnalyticsDbConnection.is_default.desc(),
            AnalyticsDbConnection.id.asc(),
        )
    )
    rows = result.scalars().all()
    return [_analytics_connection_to_response(r) for r in rows]


@router.post(
    "/analytics-connections",
    response_model=AnalyticsDbConnectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_analytics_connection(
    payload: AnalyticsDbConnectionCreate,
    db: AsyncSession = Depends(get_db),
) -> AnalyticsDbConnectionResponse:
    from app.services.analytics_db_connection_service import _clear_defaults_for_engine

    url = str(payload.url).strip()
    if not url:
        raise HTTPException(status_code=422, detail="url 不能为空")

    if payload.is_default:
        await _clear_defaults_for_engine(db, payload.engine)
    row = AnalyticsDbConnection(
        name=str(payload.name).strip(),
        engine=payload.engine,
        url=url,
        is_default=payload.is_default,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _analytics_connection_to_response(row)


@router.put("/analytics-connections/{connection_id}", response_model=AnalyticsDbConnectionResponse)
async def update_analytics_connection(
    connection_id: int,
    payload: AnalyticsDbConnectionUpdate,
    db: AsyncSession = Depends(get_db),
) -> AnalyticsDbConnectionResponse:
    from app.services.analytics_db_connection_service import _clear_defaults_for_engine

    row = await db.get(AnalyticsDbConnection, connection_id)
    if not row:
        raise HTTPException(status_code=404, detail="连接不存在")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = str(data["name"]).strip()
    if "url" in data and data["url"] is not None:
        u = str(data["url"]).strip()
        if not u:
            raise HTTPException(status_code=422, detail="url 不能为空")
        row.url = u
    if data.get("is_default") is True:
        await _clear_defaults_for_engine(db, row.engine, except_id=row.id)
        row.is_default = True
    elif data.get("is_default") is False:
        row.is_default = False

    await db.commit()
    await db.refresh(row)
    return _analytics_connection_to_response(row)


@router.delete("/analytics-connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analytics_connection(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(AnalyticsDbConnection, connection_id)
    if not row:
        raise HTTPException(status_code=404, detail="连接不存在")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/analytics-connections/test", response_model=LLMConfigTestResult)
async def test_analytics_connection(
    payload: AnalyticsDbConnectionTestRequest,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigTestResult:
    from app.services.analytics_db_connection_service import resolve_execute_url
    from app.services.query_executor import (
        QueryExecutorError,
        ping_mysql_dsn,
        ping_postgresql_dsn,
    )

    start = time.monotonic()
    inline = (payload.url or "").strip() or None
    try:
        if inline:
            dsn = inline
        elif payload.connection_id is not None:
            row = await db.get(AnalyticsDbConnection, payload.connection_id)
            if not row or row.engine != payload.engine:
                raise HTTPException(status_code=400, detail="连接不存在或引擎不匹配")
            dsn = await resolve_execute_url(db, payload.engine, payload.connection_id)
        else:
            dsn = await resolve_execute_url(db, payload.engine, None)
        if not dsn:
            raise HTTPException(
                status_code=400,
                detail="未配置该引擎的执行连接",
            )
        if payload.engine == "postgresql":
            await ping_postgresql_dsn(dsn)
        else:
            await ping_mysql_dsn(dsn)
    except HTTPException:
        raise
    except QueryExecutorError as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return LLMConfigTestResult(
            success=False,
            message=str(e),
            latency_ms=latency_ms,
        )
    except Exception as e:  # noqa: BLE001
        latency_ms = int((time.monotonic() - start) * 1000)
        return LLMConfigTestResult(
            success=False,
            message=str(e),
            latency_ms=latency_ms,
        )
    latency_ms = int((time.monotonic() - start) * 1000)
    return LLMConfigTestResult(
        success=True,
        message="连接成功",
        latency_ms=latency_ms,
    )


@router.get("/scope-policies", response_model=list[DataScopePolicyResponse])
async def list_scope_policies(
    db: AsyncSession = Depends(get_db),
) -> list[DataScopePolicyResponse]:
    rows = await db.execute(
        select(DataScopePolicy).order_by(
            DataScopePolicy.enabled.desc(),
            DataScopePolicy.priority.asc(),
            DataScopePolicy.id.asc(),
        )
    )
    return [DataScopePolicyResponse.model_validate(r) for r in rows.scalars().all()]


@router.post("/scope-policies", response_model=DataScopePolicyResponse, status_code=201)
async def create_scope_policy(
    payload: DataScopePolicyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> DataScopePolicyResponse:
    data = _normalize_scope_policy_payload(payload.model_dump())
    data["updated_by"] = current_user.username
    row = DataScopePolicy(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DataScopePolicyResponse.model_validate(row)


@router.put("/scope-policies/{policy_id}", response_model=DataScopePolicyResponse)
async def update_scope_policy(
    policy_id: int,
    payload: DataScopePolicyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> DataScopePolicyResponse:
    row = await db.get(DataScopePolicy, policy_id)
    if not row:
        raise HTTPException(status_code=404, detail="策略不存在")
    data = _normalize_scope_policy_payload(payload.model_dump(exclude_unset=True))
    data["updated_by"] = current_user.username
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return DataScopePolicyResponse.model_validate(row)


@router.delete("/scope-policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_scope_policy(
    policy_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(DataScopePolicy, policy_id)
    if not row:
        raise HTTPException(status_code=404, detail="策略不存在")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/scope-policies/bulk-set-enabled", response_model=list[DataScopePolicyResponse])
async def bulk_set_scope_policies_enabled(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[DataScopePolicyResponse]:
    ids = payload.get("ids")
    enabled = payload.get("enabled")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=422, detail="ids 不能为空")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=422, detail="enabled 必须是布尔值")
    cast_ids = [int(i) for i in ids if str(i).isdigit()]
    if not cast_ids:
        raise HTTPException(status_code=422, detail="ids 无有效策略ID")
    rows = await db.execute(select(DataScopePolicy).where(DataScopePolicy.id.in_(cast_ids)))
    policies = rows.scalars().all()
    for row in policies:
        row.enabled = enabled
        row.updated_by = current_user.username
    await db.commit()
    for row in policies:
        await db.refresh(row)
    return [DataScopePolicyResponse.model_validate(r) for r in policies]


@router.get("/scope-policies/preview/{user_id}")
async def preview_scope_for_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.roles))
    )
    user = row.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    scope = await resolve_user_scope(user, db)
    return {
        "user_id": user_id,
        "username": user.username,
        "source": scope.source,
        "policy_ids": scope.policy_ids,
        "unrestricted": scope.unrestricted,
        "province_values": sorted(scope.province_values),
        "employee_values": sorted(scope.employee_values),
        "region_values": sorted(scope.region_values),
        "district_values": sorted(scope.district_values),
    }


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[LLMConfigResponse])
async def list_configs(
    config_type: Literal["llm", "embedding", "all"] = "all",
    db: AsyncSession = Depends(get_db),
) -> list[LLMConfigResponse]:
    stmt = select(LLMConfig).order_by(LLMConfig.config_type, LLMConfig.id)
    if config_type != "all":
        stmt = stmt.where(LLMConfig.config_type == config_type)
    result = await db.execute(stmt)
    return [_to_response(r) for r in result.scalars().all()]


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/", response_model=LLMConfigResponse, status_code=201)
async def create_config(
    payload: LLMConfigCreate,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigResponse:
    row = LLMConfig(
        name=payload.name,
        config_type=payload.config_type,
        model=payload.model,
        api_key=payload.api_key or None,
        api_base=payload.api_base or None,
        extra_params=payload.extra_params,
        is_active=False,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row)


# ── Read one ──────────────────────────────────────────────────────────────────

@router.get("/{config_id}", response_model=LLMConfigResponse)
async def get_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigResponse:
    row = await db.get(LLMConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return _to_response(row)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{config_id}", response_model=LLMConfigResponse)
async def update_config(
    config_id: int,
    payload: LLMConfigUpdate,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigResponse:
    row = await db.get(LLMConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "api_key":
            # Empty string → clear the key; non-empty → update; None → keep
            setattr(row, field, value if value else None)
        else:
            setattr(row, field, value)

    await db.commit()
    await db.refresh(row)
    return _to_response(row)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete(
    "/{config_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(LLMConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    if row.is_active:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the active config. Activate another config first.",
        )
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Activate ──────────────────────────────────────────────────────────────────

@router.post("/{config_id}/activate", response_model=LLMConfigResponse)
async def activate_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigResponse:
    """
    Set this config as the active one for its config_type.
    All other configs of the same type are automatically deactivated.
    """
    row = await db.get(LLMConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")

    # Deactivate all other configs of the same type
    await db.execute(
        update(LLMConfig)
        .where(LLMConfig.config_type == row.config_type)
        .where(LLMConfig.id != config_id)
        .values(is_active=False)
    )
    row.is_active = True
    await db.commit()
    await db.refresh(row)

    # Invalidate in-memory caches in LLM/Embedding services
    from app.services.llm import invalidate_cache
    from app.services.embedding import invalidate_cache as emb_invalidate_cache
    invalidate_cache()
    emb_invalidate_cache()

    return _to_response(row)


# ── Test connection ───────────────────────────────────────────────────────────

@router.post("/{config_id}/test", response_model=LLMConfigTestResult)
async def test_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
) -> LLMConfigTestResult:
    """
    Send a minimal request to verify the config is reachable and credentials are valid.
    """
    row = await db.get(LLMConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")

    start = time.monotonic()
    try:
        if row.config_type == "llm":
            kw = build_completion_kwargs(row)
            resp = await litellm.acompletion(
                messages=[{"role": "user", "content": "Reply with: OK"}],
                max_tokens=5,
                **kw,
            )
            model_used = resp.model or row.model
        else:
            kw = build_embedding_kwargs(row)
            kw["input"] = ["test"]
            resp = await litellm.aembedding(**kw)
            model_used = row.model

        latency_ms = int((time.monotonic() - start) * 1000)
        return LLMConfigTestResult(
            success=True,
            message="连接成功",
            latency_ms=latency_ms,
            model_used=model_used,
        )
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return LLMConfigTestResult(
            success=False,
            message=str(exc),
            latency_ms=latency_ms,
        )


# ── Active config shortcut ────────────────────────────────────────────────────

@router.get("/active/{config_type}", response_model=LLMConfigResponse | None)
async def get_active_config(
    config_type: Literal["llm", "embedding"],
    db: AsyncSession = Depends(get_db),
) -> LLMConfigResponse | None:
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.config_type == config_type,
            LLMConfig.is_active.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    return _to_response(row) if row else None
