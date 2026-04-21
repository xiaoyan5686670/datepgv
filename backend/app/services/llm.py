"""
LLM service – reads the active LLM config from the database at runtime
and delegates to LiteLLM. For Ollama models, calls the native API directly
to avoid LiteLLM's ~50-second overhead.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.request
from typing import Any, AsyncGenerator

import litellm
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.llm_config import LLMConfig, LLMConfigRuntime
from app.services.litellm_kwargs import (
    DEFAULT_OLLAMA_BASE,
    build_completion_kwargs,
    is_ollama_family,
)
from app.services.litellm_retry import async_retry_litellm, is_retryable_litellm_error

litellm.set_verbose = settings.DEBUG
logger = logging.getLogger(__name__)

# ── In-memory cache ───────────────────────────────────────────────────────────

_CACHE_TTL = 30  # seconds
_cached_config: LLMConfigRuntime | None = None
_cache_ts: float = 0.0


def invalidate_cache() -> None:
    global _cached_config, _cache_ts
    _cached_config = None
    _cache_ts = 0.0


async def _get_active_config(db: AsyncSession) -> LLMConfigRuntime:
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

    snap = LLMConfigRuntime.from_orm(cfg)
    _cached_config = snap
    _cache_ts = now
    return snap


async def get_active_llm_extra_params(db: AsyncSession) -> dict[str, Any]:
    """extra_params from the active LLM row (e.g. sql_output_mode)."""
    snap = await _get_active_config(db)
    return dict(snap.extra_params or {})


# ── Direct Ollama client (bypasses LiteLLM) ──────────────────────────────────
# LiteLLM adds ~50s overhead per Ollama request due to internal processing.
# These functions call Ollama's native /api/chat endpoint directly using
# Python's built-in urllib (no extra dependencies needed).


def _ollama_bare_model(model: str) -> str:
    """Strip LiteLLM prefix: 'ollama_chat/qwen2.5-coder:32b' → 'qwen2.5-coder:32b'."""
    if "/" in model:
        return model.split("/", 1)[1]
    return model


def _ollama_api_base(cfg: LLMConfigRuntime) -> str:
    return (cfg.api_base or "").strip() or DEFAULT_OLLAMA_BASE


def _ollama_request_body(
    model: str,
    messages: list[dict],
    temperature: float,
    stream: bool,
    extra_params: dict | None = None,
) -> bytes:
    """Build the JSON body for Ollama /api/chat."""
    options: dict[str, Any] = {"temperature": temperature}
    # Forward Ollama-native options from extra_params (e.g. num_ctx, num_predict)
    _NATIVE_KEYS = ("num_ctx", "num_predict", "num_keep", "repeat_penalty",
                    "repeat_last_n", "mirostat", "mirostat_tau", "mirostat_eta",
                    "tfs_z", "seed")
    if extra_params:
        for k in _NATIVE_KEYS:
            v = extra_params.get(k)
            if v is not None:
                try:
                    options[k] = int(v) if k in ("num_ctx", "num_predict", "num_keep",
                                                  "repeat_last_n", "mirostat", "seed") else float(v)
                except (TypeError, ValueError):
                    pass
    body = {
        "model": _ollama_bare_model(model),
        "messages": messages,
        "stream": stream,
        "options": options,
    }
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


async def _ollama_stream(
    cfg: LLMConfigRuntime,
    messages: list[dict],
    temperature: float,
) -> AsyncGenerator[str, None]:
    """Stream from Ollama /api/chat directly, yielding content tokens."""
    api_base = _ollama_api_base(cfg)
    payload = _ollama_request_body(
        cfg.model, messages, temperature, stream=True,
        extra_params=cfg.extra_params,
    )
    url = f"{api_base}/api/chat"
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _worker():
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                for line in resp:
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    content = data.get("message", {}).get("content", "")
                    if content:
                        loop.call_soon_threadsafe(queue.put_nowait, content)
                    if data.get("done"):
                        break
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    loop.run_in_executor(None, _worker)

    while True:
        item = await queue.get()
        if item is None:
            return
        if isinstance(item, Exception):
            raise item
        yield item


async def _ollama_chat(
    cfg: LLMConfigRuntime,
    messages: list[dict],
    temperature: float,
) -> str:
    """Non-streaming call to Ollama /api/chat, returns full response text."""
    api_base = _ollama_api_base(cfg)
    payload = _ollama_request_body(
        cfg.model, messages, temperature, stream=False,
        extra_params=cfg.extra_params,
    )
    url = f"{api_base}/api/chat"

    def _worker():
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
        return data.get("message", {}).get("content", "")

    return await asyncio.to_thread(_worker)


# ── LLM Service ──────────────────────────────────────────────────────────────


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

        # Ollama: bypass LiteLLM, call native API directly
        if is_ollama_family(cfg.model):
            logger.info("PERF llm.chat: using direct Ollama client for %s", cfg.model)
            return await _ollama_chat(cfg, messages, temp)

        # All other providers: use LiteLLM
        kw = build_completion_kwargs(cfg)
        response = await async_retry_litellm(
            lambda: litellm.acompletion(
                messages=messages,
                temperature=temp,
                **kw,
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
        _t0 = time.perf_counter()
        cfg = await _get_active_config(db)
        temp = temperature if temperature is not None else (cfg.extra_params or {}).get("temperature", 0.1)

        # Ollama: bypass LiteLLM, call native API directly
        if is_ollama_family(cfg.model):
            logger.info("PERF llm.stream: using direct Ollama client for %s", cfg.model)
            first_emitted = False
            async for token in _ollama_stream(cfg, messages, temp):
                if not first_emitted:
                    logger.info(
                        "PERF llm.stream phase=first_content_token ms=%.0f (direct Ollama)",
                        (time.perf_counter() - _t0) * 1000,
                    )
                    first_emitted = True
                yield token
            return

        # All other providers: use LiteLLM
        kw = build_completion_kwargs(cfg)
        stream_attempts = 0
        max_stream_attempts = 2
        while stream_attempts < max_stream_attempts:
            stream_attempts += 1
            emitted_any = False
            _t1 = time.perf_counter()
            response = await async_retry_litellm(
                lambda: litellm.acompletion(
                    messages=messages,
                    temperature=temp,
                    stream=True,
                    **kw,
                ),
                operation="llm.acompletion_stream",
            )
            logger.info("PERF llm.stream phase=acompletion_returned attempt=%d ms=%.0f", stream_attempts, (time.perf_counter() - _t1) * 1000)
            try:
                async for chunk in response:
                    choices = getattr(chunk, "choices", None) or []
                    if not choices:
                        continue
                    delta = getattr(choices[0], "delta", None)
                    if not delta:
                        continue
                    content = getattr(delta, "content", None)
                    if content:
                        if not emitted_any:
                            logger.info("PERF llm.stream phase=first_content_token attempt=%d ms=%.0f (via LiteLLM)", stream_attempts, (time.perf_counter() - _t0) * 1000)
                        emitted_any = True
                        yield content
                return
            except Exception as exc:
                logger.warning("PERF llm.stream phase=stream_error attempt=%d ms=%.0f error=%s", stream_attempts, (time.perf_counter() - _t1) * 1000, exc)
                # If stream fails before first token, retry once end-to-end.
                if (
                    emitted_any
                    or stream_attempts >= max_stream_attempts
                    or not is_retryable_litellm_error(exc)
                ):
                    raise
                continue

    async def model_name(self, db: AsyncSession) -> str:
        cfg = await _get_active_config(db)
        return cfg.model


_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
