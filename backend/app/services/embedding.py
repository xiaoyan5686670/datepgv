"""
Embedding service – reads the active Embedding config from the database
and delegates to litellm.aembedding(). Zero provider-specific logic.
"""
from __future__ import annotations

import asyncio
import time
from functools import lru_cache

import litellm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.embedding_dim import get_embedding_dim
from app.models.llm_config import LLMConfig

try:
    from google.auth.exceptions import DefaultCredentialsError
except ImportError:
    DefaultCredentialsError = type(None)  # noqa: F811

# ── In-memory cache ───────────────────────────────────────────────────────────

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
            LLMConfig.config_type == "embedding",
            LLMConfig.is_active.is_(True),
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise RuntimeError(
            "没有活跃的 Embedding 配置。请前往 设置 → 模型配置，激活一个 Embedding 模型。"
        )

    _cached_config = cfg
    _cache_ts = now
    return cfg


def _normalize_embedding_model(model: str, api_key: str | None) -> str:
    """Use Gemini API (api_key) instead of Vertex (ADC) when model looks like Gemini and we have a key."""
    if not api_key or not model:
        return model
    m = model.strip()
    if m.startswith("vertex_ai/") or m.startswith("gemini/"):
        return model
    if m.lower().startswith("gemini-"):
        return f"gemini/{m}"
    return model


class EmbeddingService:
    async def embed(self, text: str, db: AsyncSession) -> list[float]:
        """Return an embedding vector for the given text."""
        cfg = await _get_active_config(db)
        model = _normalize_embedding_model(cfg.model, cfg.api_key)
        kw: dict = {"model": model, "input": [text.strip().replace("\n", " ")]}
        if cfg.api_key:
            kw["api_key"] = cfg.api_key
        api_base = (cfg.extra_params or {}).get("api_base") or cfg.api_base
        if api_base:
            kw["api_base"] = api_base

        try:
            response = await litellm.aembedding(**kw)
        except Exception as e:
            if isinstance(e, DefaultCredentialsError):
                raise RuntimeError(
                    "当前使用了需要 Google 应用默认凭证(ADC) 的调用方式。若使用 API Key，请将 Embedding 模型名改为带 gemini/ 前缀（如 gemini/embedding-001），并在设置中填写 API Key。详见：https://cloud.google.com/docs/authentication/external/set-up-adc"
                ) from e
            raise
        vec = response.data[0]["embedding"]
        dim = len(vec)
        expected = get_embedding_dim()
        if dim != expected:
            raise RuntimeError(
                f"Embedding 维度不一致：当前模型输出 {dim} 维，系统配置为 {expected} 维。"
                f"请在 设置 → Embedding 向量维度 中选择 {dim} 维并保存（将自动迁移数据库），重启后端后在元数据管理页执行「全部重新向量化」。"
            )
        return vec

    async def embed_batch(self, texts: list[str], db: AsyncSession) -> list[list[float]]:
        """Embed multiple texts concurrently."""
        tasks = [self.embed(t, db) for t in texts]
        return await asyncio.gather(*tasks)


def build_table_text(row: dict) -> str:
    """
    Construct a rich text representation of a table for embedding.
    Includes table name, comment, and column details.
    """
    parts: list[str] = []
    full_name = ".".join(
        filter(None, [row.get("database_name"), row.get("schema_name"), row.get("table_name")])
    )
    parts.append(f"表名: {full_name}")
    if row.get("table_comment"):
        parts.append(f"说明: {row['table_comment']}")

    cols = row.get("columns", [])
    if cols:
        col_lines = []
        for c in cols:
            if isinstance(c, dict):
                name = c.get("name", "")
                ctype = c.get("type", "")
                comment = c.get("comment", "")
                partition = " [分区键]" if c.get("is_partition_key") else ""
                col_lines.append(f"  - {name} ({ctype}): {comment}{partition}")
        if col_lines:
            parts.append("字段:\n" + "\n".join(col_lines))

    if row.get("tags"):
        parts.append("标签: " + ", ".join(row["tags"]))

    return "\n".join(parts)


@lru_cache(maxsize=1)
def get_embedding_service() -> EmbeddingService:
    return EmbeddingService()
