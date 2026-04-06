from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LLMConfig(Base):
    __tablename__ = "llm_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    config_type: Mapped[str] = mapped_column(
        String(20), nullable=False, comment="'llm' or 'embedding'"
    )
    # LiteLLM model string, e.g. "gemini/gemini-2.0-flash", "ollama/qwen2.5-coder:32b"
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    # Stored as plain text; masked to "****" in API responses
    api_key: Mapped[str | None] = mapped_column(Text)
    # Optional custom API endpoint (Ollama, Azure, private proxies, etc.)
    api_base: Mapped[str | None] = mapped_column(String(500))
    # Flexible extra params: temperature, max_tokens, dim, etc.
    extra_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("llm_configs_type_idx", "config_type"),
        # Partial unique index handled in SQL migration; defined here for awareness only
    )


@dataclass(frozen=True)
class LLMConfigRuntime:
    """
    Scalar copy of active config for in-process caching.
    Do not cache SQLAlchemy ORM instances across requests: they stay bound to the
    AsyncSession that loaded them and confuse asyncpg pool check-in when the GC runs.
    """

    id: int
    model: str
    api_key: str | None
    api_base: str | None
    extra_params: dict[str, Any]

    @staticmethod
    def from_orm(row: LLMConfig) -> LLMConfigRuntime:
        return LLMConfigRuntime(
            id=row.id,
            model=row.model,
            api_key=row.api_key,
            api_base=row.api_base,
            extra_params=dict(row.extra_params or {}),
        )
