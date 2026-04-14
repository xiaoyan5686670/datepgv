from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Column descriptor ─────────────────────────────────────────────────────────

class ColumnInfo(BaseModel):
    name: str
    type: str
    comment: str = ""
    nullable: bool = True
    is_partition_key: bool = False


# ── Table Metadata ────────────────────────────────────────────────────────────

class TableMetadataCreate(BaseModel):
    db_type: Literal["hive", "postgresql", "oracle", "mysql"]
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


class TableMetadataEdgeCreate(BaseModel):
    """User-drawn link between two catalog tables (for RAG graph expansion)."""

    from_metadata_id: int = Field(..., ge=1)
    to_metadata_id: int = Field(..., ge=1)
    relation_type: Literal["foreign_key", "logical", "coquery"]
    from_column: str | None = None
    to_column: str | None = None
    note: str | None = None


class TableMetadataEdgeResponse(BaseModel):
    id: int
    from_metadata_id: int
    to_metadata_id: int
    from_label: str
    to_label: str
    from_db_type: str
    to_db_type: str
    relation_type: str
    from_column: str | None
    to_column: str | None
    note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


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
    sql_type: Literal["hive", "postgresql", "oracle", "mysql"] = "mysql"
    top_k: int = Field(default=5, ge=1, le=20)
    execute: bool = True
    execute_connection_id: int | None = None


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


class ChatQuerySummaryBlock(BaseModel):
    total_questions: int
    active_days: int
    distinct_sessions: int
    last_question_at: datetime | None = None


class ChatQueryDailyBucket(BaseModel):
    date: str
    count: int


class ChatQueryTopItem(BaseModel):
    normalized_key: str
    count: int
    example_snippet: str
    example_query: str


class ChatQueryStatsFiltersBlock(BaseModel):
    user_id: int | None = None
    day_from: str | None = None
    day_to: str | None = None


class ChatQueryStatsResponse(BaseModel):
    summary: ChatQuerySummaryBlock
    daily_trend: list[ChatQueryDailyBucket]
    top_queries: list[ChatQueryTopItem]
    filters: ChatQueryStatsFiltersBlock


# ── Admin audit (login + NL→SQL) ───────────────────────────────────────────────

class LoginAuditItem(BaseModel):
    id: int
    user_id: int
    username: str
    full_name: str | None = None
    login_method: str
    client_ip: str | None = None
    user_agent: str | None = None
    created_at: datetime


class LoginAuditListResponse(BaseModel):
    items: list[LoginAuditItem]
    total: int
    skip: int
    limit: int


class QueryAuditItem(BaseModel):
    session_id: str
    user_id: int
    username: str
    full_name: str | None = None
    user_message_at: datetime
    assistant_message_at: datetime
    user_query: str
    generated_sql: str
    sql_type: str | None = None
    executed: bool | None = None
    elapsed_ms: int | None = None


class QueryAuditListResponse(BaseModel):
    items: list[QueryAuditItem]
    total: int
    skip: int
    limit: int


# ── DDL Import ────────────────────────────────────────────────────────────────

class DDLImportRequest(BaseModel):
    ddl: str = Field(..., min_length=10)
    db_type: Literal["hive", "postgresql", "oracle", "mysql"] = "hive"
    database_name: str | None = None


# ── Search ────────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    db_type: Literal["hive", "postgresql", "oracle", "mysql", "all"] = "all"
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


class AnalyticsDbConnectionResponse(BaseModel):
    id: int
    name: str
    engine: Literal["postgresql", "mysql"]
    url_masked: str | None
    is_default: bool
    created_at: datetime
    updated_at: datetime


class AnalyticsDbConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    engine: Literal["postgresql", "mysql"]
    url: str = Field(..., min_length=1)
    is_default: bool = False


class AnalyticsDbConnectionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    url: str | None = None
    is_default: bool | None = None


class AnalyticsDbConnectionTestRequest(BaseModel):
    engine: Literal["postgresql", "mysql"]
    url: str | None = Field(
        default=None,
        description="Explicit URL to ping; if set with connection_id, URL wins.",
    )
    connection_id: int | None = Field(
        default=None,
        description="Use stored URL for this connection row.",
    )


# ── Data Scope Policies ────────────────────────────────────────────────────────

class DataScopePolicyBase(BaseModel):
    subject_type: Literal["user", "user_id", "role", "level", "user_name"]
    subject_key: str = Field(..., min_length=1, max_length=120)
    dimension: Literal["province", "employee", "region", "district"]
    allowed_values: list[str] = Field(default_factory=list)
    deny_values: list[str] = Field(default_factory=list)
    merge_mode: Literal["union", "replace"] = "union"
    priority: int = Field(default=100, ge=0, le=10000)
    enabled: bool = True
    note: str | None = None
    updated_by: str | None = None

    @field_validator("subject_key")
    @classmethod
    def normalize_subject_key(cls, v: str) -> str:
        out = v.strip()
        if not out:
            raise ValueError("subject_key 不能为空")
        return out

    @field_validator("allowed_values", "deny_values", mode="before")
    @classmethod
    def normalize_values(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("值必须为数组")
        out: list[str] = []
        seen: set[str] = set()
        for item in v:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(text)
        return out

    @model_validator(mode="after")
    def validate_policy_consistency(self) -> "DataScopePolicyBase":
        if self.subject_type in ("user", "user_id") and not self.subject_key.isdigit():
            raise ValueError("subject_type=user_id 时 subject_key 必须是数字用户ID")
        overlap = set(self.allowed_values) & set(self.deny_values)
        if overlap:
            raise ValueError(f"allowed_values 与 deny_values 不能重叠: {sorted(overlap)}")
        return self


class DataScopePolicyCreate(DataScopePolicyBase):
    pass


class DataScopePolicyUpdate(BaseModel):
    subject_type: Literal["user", "user_id", "role", "level", "user_name"] | None = None
    subject_key: str | None = Field(default=None, min_length=1, max_length=120)
    dimension: Literal["province", "employee", "region", "district"] | None = None
    allowed_values: list[str] | None = None
    deny_values: list[str] | None = None
    merge_mode: Literal["union", "replace"] | None = None
    priority: int | None = Field(default=None, ge=0, le=10000)
    enabled: bool | None = None
    note: str | None = None
    updated_by: str | None = None

    @field_validator("subject_key")
    @classmethod
    def normalize_subject_key(cls, v: str | None) -> str | None:
        if v is None:
            return None
        out = v.strip()
        if not out:
            raise ValueError("subject_key 不能为空")
        return out

    @field_validator("allowed_values", "deny_values", mode="before")
    @classmethod
    def normalize_values(cls, v: Any) -> list[str] | None:
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("值必须为数组")
        out: list[str] = []
        seen: set[str] = set()
        for item in v:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(text)
        return out


class DataScopePolicyResponse(DataScopePolicyBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Auth ────────────────────────────────────────────────────────────────────────


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserMeResponse(BaseModel):
    id: int
    username: str
    is_active: bool
    roles: list[str]
    province: str | None = None
    org_region: str | None = None
    employee_level: str = "staff"
    district: str | None = None
    full_name: str | None = None


# ── User Management ───────────────────────────────────────────────────────────

EmployeeOrgLevel = Literal[
    "admin",
    "region_executive",
    "province_executive",
    "area_executive",
    "province_manager",
    "area_manager",
    "staff",
]


class UserScopeItem(BaseModel):
    dimension: Literal["province", "employee", "region", "district"]
    allowed_values: list[str] = Field(default_factory=list)


class UserBase(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    is_active: bool = True
    province: str | None = None
    org_region: str | None = Field(None, description="大区(daqua)")
    employee_level: EmployeeOrgLevel = "staff"
    district: str | None = None
    full_name: str | None = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=6)
    data_scope: list[UserScopeItem] | None = None


class UserUpdate(BaseModel):
    username: str | None = Field(None, min_length=1, max_length=100, description="工号/登录账号")
    is_active: bool | None = None
    province: str | None = Field(None, description="省份")
    org_region: str | None = None
    employee_level: EmployeeOrgLevel | None = None
    district: str | None = None
    full_name: str | None = None
    password: str | None = Field(None, min_length=6, description="如果提供则更新密码")
    data_scope: list[UserScopeItem] | None = None


class UserResponse(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime
    roles: list[str] = Field(default_factory=list)
    data_scope: list[UserScopeItem] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserImportResponse(BaseModel):
    total: int
    created: int
    updated: int
    skipped: int
    errors: list[str] = Field(default_factory=list)


class UserImportRow(BaseModel):
    """For bulk import from CSV/Excel."""
    username: str
    password: str | None = None  # if omitted, use default or skip
    full_name: str | None = None
    province: str | None = None
    org_region: str | None = None
    employee_level: EmployeeOrgLevel = "staff"
    district: str | None = None
    is_active: bool = True


class UserImportRequest(BaseModel):
    users: list[UserImportRow]
    overwrite_existing: bool = False
