"""
Retry transient LiteLLM / Vertex / Google API failures (503, 429, overload text).
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


def _is_retryable_litellm_error(exc: BaseException) -> bool:
    name = type(exc).__name__
    if name in (
        "ServiceUnavailableError",
        "MidStreamFallbackError",
        "RateLimitError",
        "InternalServerError",
        "APIConnectionError",
    ):
        return True
    msg = str(exc)
    low = msg.lower()
    if "503" in msg or "429" in msg:
        return True
    if "unavailable" in low or "high demand" in low:
        return True
    if "rate limit" in low or "resource exhausted" in low:
        return True
    if "try again later" in low:
        return True
    if "midstreamfallbackerror" in low:
        return True
    return False


def is_retryable_litellm_error(exc: BaseException) -> bool:
    """Public helper for stream consumers that need retry decisions."""
    return _is_retryable_litellm_error(exc)


async def async_retry_litellm(
    factory: Callable[[], Awaitable[T]],
    *,
    operation: str = "litellm",
) -> T:
    """
    Call async factory with exponential backoff on retryable errors.
    """
    max_attempts = max(1, settings.LITELLM_RETRY_MAX_ATTEMPTS)
    base = settings.LITELLM_RETRY_BASE_DELAY_SEC
    cap = settings.LITELLM_RETRY_MAX_DELAY_SEC

    last: BaseException | None = None
    for attempt in range(max_attempts):
        try:
            return await factory()
        except Exception as e:
            last = e
            if attempt >= max_attempts - 1 or not _is_retryable_litellm_error(e):
                raise
            delay = min(base * (2**attempt), cap)
            logger.warning(
                "%s attempt %s/%s failed (%s), retry in %.1fs: %s",
                operation,
                attempt + 1,
                max_attempts,
                type(e).__name__,
                delay,
                e,
            )
            await asyncio.sleep(delay)
    assert last is not None
    raise last
