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

from app.models.llm_config import LLMConfig
from app.services.litellm_kwargs import build_embedding_kwargs, embedding_target_dimensions
from app.services.litellm_retry import async_retry_litellm

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


class EmbeddingService:
    async def embed(self, text: str, db: AsyncSession) -> list[float]:
        """Return an embedding vector for the given text."""
        cfg = await _get_active_config(db)
        kw = build_embedding_kwargs(cfg)
        kw["input"] = [text.strip().replace("\n", " ")]

        response = await async_retry_litellm(
            lambda: litellm.aembedding(**kw),
            operation="embedding.aembedding",
        )
        vec = response.data[0]["embedding"]
        expected = embedding_target_dimensions(cfg)
        if len(vec) != expected:
            raise RuntimeError(
                f"嵌入向量维度为 {len(vec)}，与目标维度 {expected} 不一致（.env 的 EMBEDDING_DIM 或该嵌入配置的 "
                "extra_params 里 dimensions / dim）。须与 PostgreSQL table_metadata.embedding 的 vector(N) 一致；"
                "修改后请重嵌或调整模型/维度参数。"
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
