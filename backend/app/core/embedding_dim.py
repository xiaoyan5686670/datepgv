"""
Embedding dimension: read from DB (app_settings) at startup so the UI can change it
without editing .env. Fallback to config.EMBEDDING_DIM if not set in DB.
"""
from __future__ import annotations

from app.core.config import settings

_value: int | None = None


def set_embedding_dim(dim: int) -> None:
    global _value
    _value = dim


def get_embedding_dim() -> int:
    return _value if _value is not None else settings.EMBEDDING_DIM
