"""
LLM service – reads the active LLM config from the database at runtime
and delegates to LiteLLM. No provider-specific logic lives here.
"""
from __future__ import annotations

import time
from typing import AsyncGenerator

import litellm
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.llm_config import LLMConfig
from app.services.litellm_kwargs import build_completion_kwargs
from app.services.litellm_retry import async_retry_litellm

litellm.set_verbose = settings.DEBUG

# ── In-memory cache ───────────────────────────────────────────────────────────
# Holds the active LLM config for up to _CACHE_TTL seconds so we don't
# hit the database on every streaming token.

_CACHE_TTL = 30  # seconds
_cached_config: LLMConfig | None = None
_cache_ts: float = 0.0


def invalidate_cache() -> None:
    global _cached_config, _cache_ts
    _cached_config = None
    _cache_ts = 0.0


async def _get_active_config(db: AsyncSession) -> LLMConfig:
    global _cached_config, _cache_ts
    now = time.monotonic()
    if _cached_config is not None and (now - _cache_ts) < _CACHE_TTL:
        return _cached_config

    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.config_type == "llm",
            LLMConfig.is_active.is_(True),
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            status_code=400,
            detail="没有活跃的 LLM 配置。请前往 设置 → 模型配置，激活一个 LLM 模型。"
        )

    _cached_config = cfg
    _cache_ts = now
    return cfg


class LLMService:
    async def chat(
        self,
        messages: list[dict[str, str]],
        db: AsyncSession,
        temperature: float | None = None,
    ) -> str:
        """Non-streaming completion – returns the full response text."""
        cfg = await _get_active_config(db)
        temp = temperature if temperature is not None else (cfg.extra_params or {}).get("temperature", 0.1)
        response = await async_retry_litellm(
            lambda: litellm.acompletion(
                messages=messages,
                temperature=temp,
                **build_completion_kwargs(cfg),
            ),
            operation="llm.acompletion",
        )
        return response.choices[0].message.content or ""

    async def stream(
        self,
        messages: list[dict[str, str]],
        db: AsyncSession,
        temperature: float | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion – yields text chunks as they arrive."""
        cfg = await _get_active_config(db)
        temp = temperature if temperature is not None else (cfg.extra_params or {}).get("temperature", 0.1)
        response = await async_retry_litellm(
            lambda: litellm.acompletion(
                messages=messages,
                temperature=temp,
                stream=True,
                **build_completion_kwargs(cfg),
            ),
            operation="llm.acompletion_stream",
        )
        async for chunk in response:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            if not delta:
                continue
            content = getattr(delta, "content", None)
            if content:
                yield content

    async def model_name(self, db: AsyncSession) -> str:
        cfg = await _get_active_config(db)
        return cfg.model


_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
