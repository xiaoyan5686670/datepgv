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
    # Vertex AI default location (used when active model is Vertex/Gemini route and
    # config extra_params does not provide location/vertex_location).
    VERTEXAI_LOCATION: str = "us-central1"

    # LiteLLM: retry 503 / 429 / overload (e.g. Vertex "high demand")
    LITELLM_RETRY_MAX_ATTEMPTS: int = 4
    LITELLM_RETRY_BASE_DELAY_SEC: float = 2.0
    LITELLM_RETRY_MAX_DELAY_SEC: float = 60.0

    # -- Auth (JWT) -------------------------------------------------------------
    # 生产环境必须通过环境变量设置强随机密钥。
    JWT_SECRET_KEY: str = "dev-only-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # 办公网免密：`GET /auth/trusted-login?user_id=` → 302 到前端 `/sso/callback#access_token=…`
    TRUSTED_SSO_FRONTEND_BASE: str = "http://localhost:3000"
    # 非空则必须携带请求头 X-Trusted-Sso-Secret（可由网关注入，上游应用仍只拼 user_id）
    TRUSTED_SSO_SECRET: str | None = None
    # 不设置则与 ACCESS_TOKEN_EXPIRE_MINUTES 相同；仅影响 trusted-login 签发的 JWT
    TRUSTED_SSO_ACCESS_TOKEN_MINUTES: int | None = None

    # -- App --------------------------------------------------------------------
    APP_TITLE: str = "NL-to-SQL RAG System"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    # Root log level. Set WARNING in production to reduce noise; DEBUG for local dev.
    LOG_LEVEL: str = "INFO"
    # Path to rotating log file. Set to empty string "" to disable file logging.
    LOG_FILE: str = "logs/app.log"
    # Max size per log file in bytes before rotation (default 10 MB).
    LOG_FILE_MAX_BYTES: int = 10 * 1024 * 1024
    # Number of rotated backup files to keep.
    LOG_FILE_BACKUP_COUNT: int = 7
    # Log INFO lines with per-stage ms for POST /chat/stream (RAG, LLM stream, execute, summarize).
    CHAT_STREAM_TIMING_LOG: bool = False
    # If analytics SELECT exceeds this many ms, log WARNING with SQL preview and EXPLAIN hint.
    ANALYTICS_SLOW_QUERY_LOG_MS: int = 2000
    SCOPE_REWRITE_ENABLED: bool = True
    # Temporary rollback flag: when true, users without policy rows can still
    # resolve scope from org CSV. Default false for policy-as-source-of-truth.
    SCOPE_POLICY_CSV_FALLBACK_ENABLED: bool = False
    # Bootstrap baseline scope policies from existing users profile fields.
    SCOPE_POLICY_AUTO_BACKFILL_ON_STARTUP: bool = True

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
