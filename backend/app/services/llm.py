"""
LLM service – reads the active LLM config from the database at runtime
and delegates to LiteLLM. No provider-specific logic lives here.
"""
from __future__ import annotations

import time
from typing import AsyncGenerator

import litellm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.llm_config import LLMConfig

# Optional: only used to give a clear error when Gemini is routed to Vertex by mistake
try:
    from google.auth.exceptions import DefaultCredentialsError
except ImportError:
    DefaultCredentialsError = type(None)  # noqa: F811

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
        raise RuntimeError(
            "没有活跃的 LLM 配置。请前往 设置 → 模型配置，激活一个 LLM 模型。"
        )

    _cached_config = cfg
    _cache_ts = now
    return cfg


def _normalize_model_for_litellm(model: str, api_key: str | None) -> str:
    """Use Gemini API (api_key) instead of Vertex (ADC) when model looks like Gemini and we have a key."""
    if not api_key or not model:
        return model
    m = model.strip()
    if m.startswith("vertex_ai/") or m.startswith("gemini/"):
        return model
    if m.lower().startswith("gemini-"):
        return f"gemini/{m}"
    return model


def _build_kwargs(cfg: LLMConfig) -> dict:
    """Build the kwargs dict for litellm.acompletion from a config row."""
    model = _normalize_model_for_litellm(cfg.model, cfg.api_key)
    kw: dict = {"model": model}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    # api_base can live in extra_params (e.g. custom endpoint) or the dedicated column
    api_base = (cfg.extra_params or {}).get("api_base") or cfg.api_base
    if api_base:
        kw["api_base"] = api_base
    return kw


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
        try:
            response = await litellm.acompletion(
                messages=messages,
                temperature=temp,
                **_build_kwargs(cfg),
            )
        except Exception as e:
            if isinstance(e, DefaultCredentialsError):
                raise RuntimeError(
                    "当前使用了需要 Google 应用默认凭证(ADC) 的调用方式。若使用 API Key，请将模型名改为带 gemini/ 前缀（如 gemini/gemini-2.0-flash），并在设置中填写 API Key。详见：https://cloud.google.com/docs/authentication/external/set-up-adc"
                ) from e
            raise
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
        try:
            response = await litellm.acompletion(
                messages=messages,
                temperature=temp,
                stream=True,
                **_build_kwargs(cfg),
            )
        except Exception as e:
            if isinstance(e, DefaultCredentialsError):
                raise RuntimeError(
                    "当前使用了需要 Google 应用默认凭证(ADC) 的调用方式。若使用 API Key，请将模型名改为带 gemini/ 前缀（如 gemini/gemini-2.0-flash），并在设置中填写 API Key。详见：https://cloud.google.com/docs/authentication/external/set-up-adc"
                ) from e
            raise
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content

    async def model_name(self, db: AsyncSession) -> str:
        cfg = await _get_active_config(db)
        return cfg.model


_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
