from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# ── Column descriptor ─────────────────────────────────────────────────────────

class ColumnInfo(BaseModel):
    name: str
    type: str
    comment: str = ""
    nullable: bool = True
    is_partition_key: bool = False


# ── Table Metadata ────────────────────────────────────────────────────────────

class TableMetadataCreate(BaseModel):
    db_type: Literal["hive", "postgresql", "oracle"]
    database_name: str | None = None
    schema_name: str | None = None
    table_name: str
    table_comment: str | None = None
    columns: list[ColumnInfo] = Field(default_factory=list)
    sample_data: list[dict[str, Any]] | None = None
    tags: list[str] | None = None


class TableMetadataUpdate(BaseModel):
    table_comment: str | None = None
    columns: list[ColumnInfo] | None = None
    sample_data: list[dict[str, Any]] | None = None
    tags: list[str] | None = None


class TableMetadataResponse(BaseModel):
    id: int
    db_type: str
    database_name: str | None
    schema_name: str | None
    table_name: str
    table_comment: str | None
    columns: list[ColumnInfo]
    sample_data: list[dict[str, Any]] | None
    tags: list[str] | None
    has_embedding: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("columns", mode="before")
    @classmethod
    def parse_columns(cls, v: Any) -> list[ColumnInfo]:
        if isinstance(v, list):
            return [ColumnInfo(**c) if isinstance(c, dict) else c for c in v]
        return v

    @field_validator("has_embedding", mode="before")
    @classmethod
    def compute_has_embedding(cls, v: Any) -> bool:
        return v is not None


# ── Chat ──────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    session_id: str | None = None
    query: str = Field(..., min_length=1, max_length=2000)
    sql_type: Literal["hive", "postgresql", "oracle"] = "hive"
    top_k: int = Field(default=5, ge=1, le=20)


class ChatResponse(BaseModel):
    session_id: str
    sql: str
    sql_type: str
    referenced_tables: list[str]
    model_used: str


class ChatSessionSummary(BaseModel):
    session_id: str
    title: str = "新会话"
    created_at: datetime
    last_message_at: datetime


# ── DDL Import ────────────────────────────────────────────────────────────────

class DDLImportRequest(BaseModel):
    ddl: str = Field(..., min_length=10)
    db_type: Literal["hive", "postgresql", "oracle"] = "hive"
    database_name: str | None = None


# ── Search ────────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    db_type: Literal["hive", "postgresql", "oracle", "all"] = "all"
    top_k: int = Field(default=5, ge=1, le=50)


# ── LLM Config ────────────────────────────────────────────────────────────────

class LLMConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    config_type: Literal["llm", "embedding"]
    model: str = Field(..., min_length=1, max_length=200)
    api_key: str | None = None
    api_base: str | None = None
    extra_params: dict[str, Any] = Field(default_factory=dict)


class LLMConfigUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    # Empty string means "clear the key"; None means "leave unchanged"
    api_key: str | None = None
    api_base: str | None = None
    extra_params: dict[str, Any] | None = None


class LLMConfigResponse(BaseModel):
    id: int
    name: str
    config_type: str
    model: str
    # API key is always masked in responses
    api_key_set: bool
    api_base: str | None
    extra_params: dict[str, Any]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LLMConfigTestResult(BaseModel):
    success: bool
    message: str
    latency_ms: int | None = None
    model_used: str | None = None
