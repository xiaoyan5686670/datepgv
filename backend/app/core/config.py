import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Try multiple locations for .env file
        env_file=[
            Path(__file__).parent.parent.parent.parent / ".env",  # Project root
            Path(__file__).parent.parent.parent / ".env",  # Backend directory
            ".env",  # Current working directory
        ],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # -- Database ---------------------------------------------------------------
    DATABASE_URL: str = (
        "postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv"
    )

    # Optional overrides for NL→SQL execute (otherwise PostgreSQL reuses DATABASE_URL)
    ANALYTICS_POSTGRES_URL: str | None = None
    ANALYTICS_MYSQL_URL: str | None = None
    ANALYTICS_QUERY_TIMEOUT_SEC: int = 30
    ANALYTICS_MAX_ROWS: int = 500
    ANALYTICS_MAX_CELL_CHARS: int = 2000

    # -- RAG / Vector ----------------------------------------------------------
    RAG_TOP_K: int = 5
    RAG_SIMILARITY_THRESHOLD: float = 0.3
    # Schema graph: after vector Top-K, pull in related tables (same-db_type edges).
    RAG_GRAPH_EXPAND_ENABLED: bool = True
    RAG_GRAPH_MAX_HOPS: int = 2
    RAG_GRAPH_MAX_TABLES: int = 20
    # Approximate prompt budget for the "可用表结构" blocks (~chars/4 tokens).
    RAG_GRAPH_MAX_SCHEMA_CHARS: int = 32000
    # Must match PostgreSQL table_metadata.embedding vector(N) and the active model output size.
    # DashScope text-embedding-v4 经 LiteLLM 调用时无法传 dimensions（库校验与模型名冲突），默认多为 1024；
    # v2 多为 1536。OpenAI text-embedding-3-small/large 默认 1536/3072。
    EMBEDDING_DIM: int = 1536
    VECTOR_STORE: Literal["pgvector"] = "pgvector"  # Future: milvus, qdrant, etc.

    # Optional default Ollama API base when model is ollama/… and UI api_base is empty.
    OLLAMA_API_BASE: str | None = None

    # DashScope (通义): optional default compatible-mode base when UI api_base is empty.
    # China: https://dashscope.aliyuncs.com/compatible-mode/v1
    # International: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # https://docs.litellm.ai/docs/providers/dashscope
    DASHSCOPE_API_BASE: str | None = None

    # LiteLLM: retry 503 / 429 / overload (e.g. Vertex "high demand")
    LITELLM_RETRY_MAX_ATTEMPTS: int = 4
    LITELLM_RETRY_BASE_DELAY_SEC: float = 2.0
    LITELLM_RETRY_MAX_DELAY_SEC: float = 60.0

    # -- App --------------------------------------------------------------------
    APP_TITLE: str = "NL-to-SQL RAG System"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    def effective_analytics_postgres_url(self) -> str | None:
        """Sync postgres DSN for asyncpg execute; explicit override or derived from DATABASE_URL."""
        if self.ANALYTICS_POSTGRES_URL and str(self.ANALYTICS_POSTGRES_URL).strip():
            return str(self.ANALYTICS_POSTGRES_URL).strip()
        u = self.DATABASE_URL.strip()
        if "postgresql+asyncpg://" in u:
            return u.replace("postgresql+asyncpg://", "postgresql://", 1)
        if u.startswith("postgresql://"):
            return u
        return None


settings = Settings()
