"""
LLM & Embedding configuration management API.
Provides CRUD operations, activation, and connection testing for model configs.
"""
from __future__ import annotations

import time
from typing import Literal

import litellm
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.llm_config import LLMConfig
from app.services.llm import _normalize_model_for_litellm
from app.models.schemas import (
    LLMConfigCreate,
    LLMConfigResponse,
    LLMConfigTestResult,
    LLMConfigUpdate,
)

router = APIRouter(prefix="/config", tags=["config"])


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

@router.delete("/{config_id}", status_code=200)
async def delete_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
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
    return {"detail": "deleted"}


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
        model = _normalize_model_for_litellm(row.model, row.api_key)
        kw: dict = {"model": model}
        if row.api_key:
            kw["api_key"] = row.api_key
        # Prefer api_base from extra_params, fall back to the dedicated field
        api_base = (row.extra_params or {}).get("api_base") or row.api_base
        if api_base:
            kw["api_base"] = api_base

        if row.config_type == "llm":
            resp = await litellm.acompletion(
                messages=[{"role": "user", "content": "Reply with: OK"}],
                max_tokens=5,
                **kw,
            )
            model_used = resp.model or row.model
        else:
            resp = await litellm.aembedding(input=["test"], **kw)
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
        msg = str(exc)
        if "DefaultCredentialsError" in type(exc).__name__ or "default credentials" in msg.lower():
            msg = "请使用带 gemini/ 前缀的模型名（如 gemini/gemini-2.0-flash）并在设置中填写 API Key，勿使用需 Google 云凭证的 Vertex 方式。"
        return LLMConfigTestResult(
            success=False,
            message=msg,
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
