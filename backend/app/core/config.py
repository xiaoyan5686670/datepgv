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

    # -- RAG / Vector ----------------------------------------------------------
    RAG_TOP_K: int = 5
    RAG_SIMILARITY_THRESHOLD: float = 0.3
    EMBEDDING_DIM: int = 1536  # Must match init-db vector(N) and embedding model (e.g. 768 for Gemini)
    VECTOR_STORE: Literal["pgvector"] = "pgvector"  # Future: milvus, qdrant, etc.

    # -- App --------------------------------------------------------------------
    APP_TITLE: str = "NL-to-SQL RAG System"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False


settings = Settings()
