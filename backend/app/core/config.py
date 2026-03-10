from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = (
        "postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv"
    )

    # ── RAG ──────────────────────────────────────────────────────────────────
    RAG_TOP_K: int = 5
    RAG_SIMILARITY_THRESHOLD: float = 0.3

    # ── App ──────────────────────────────────────────────────────────────────
    APP_TITLE: str = "NL-to-SQL RAG System"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False


settings = Settings()
