export type SqlType = "hive" | "postgresql" | "oracle" | "mysql";

/**
 * 与通讯录推导的组织层级一致（同步 / 管理端）。
 * 从高到低：admin > region_executive > province_executive
 *           > province_manager > area_executive > area_manager > staff
 */
export type EmployeeOrgLevel =
  | "admin"
  | "region_executive"
  | "province_executive"
  | "province_manager"
  | "area_executive"
  | "area_manager"
  | "staff";

/** 当前登录用户（GET /auth/me） */
export interface AuthUser {
  id: number;
  username: string;
  is_active: boolean;
  roles: string[];
  province?: string | null;
  org_region?: string | null;
  employee_level: string;
  district?: string | null;
  full_name?: string | null;
}

/** 用户管理 */
export interface User {
  id: number;
  username: string;
  is_active: boolean;
  province?: string | null;
  org_region?: string | null;
  employee_level: EmployeeOrgLevel;
  district?: string | null;
  full_name?: string | null;
  roles: string[];
  created_at: string;
  updated_at: string;
}

export interface UserCreate {
  username: string;
  password: string;
  is_active?: boolean;
  province?: string | null;
  org_region?: string | null;
  employee_level?: EmployeeOrgLevel;
  district?: string | null;
  full_name?: string | null;
}

export interface UserUpdate {
  is_active?: boolean;
  province?: string | null;
  org_region?: string | null;
  employee_level?: EmployeeOrgLevel;
  district?: string | null;
  full_name?: string | null;
  password?: string;
}

export interface UserImportRow {
  username: string;
  password?: string;
  full_name?: string;
  province?: string;
  org_region?: string;
  employee_level?: EmployeeOrgLevel;
  district?: string;
  is_active?: boolean;
}

export interface UserImportRequest {
  users: UserImportRow[];
  overwrite_existing?: boolean;
}

export interface UserImportResponse {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface SyncOrgCsvResponse {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface OrgGraphNode {
  name: string;
  employee_code?: string | null;
  title?: string | null;
  region?: string | null;
  province?: string | null;
  district?: string | null;
}

export interface OrgGraphEdge {
  from: string;
  to: string;
  relation: "daquzong_to_shengzong" | "shengzong_to_quyuzong" | "quyuzong_to_manager" | string;
}

export interface OrgGraphResponse {
  source_csv: string;
  node_count: number;
  edge_count: number;
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  comment: string;
  nullable: boolean;
  is_partition_key: boolean;
}

export type TableRelationType = "foreign_key" | "logical" | "coquery";

export interface TableMetadataEdge {
  id: number;
  from_metadata_id: number;
  to_metadata_id: number;
  from_label: string;
  to_label: string;
  from_db_type: string;
  to_db_type: string;
  relation_type: TableRelationType;
  from_column: string | null;
  to_column: string | null;
  note: string | null;
  created_at: string;
}

export interface TableMetadata {
  id: number;
  db_type: SqlType;
  database_name: string | null;
  schema_name: string | null;
  table_name: string;
  table_comment: string | null;
  columns: ColumnInfo[];
  sample_data: Record<string, unknown>[] | null;
  tags: string[] | null;
  has_embedding: boolean;
  created_at: string;
  updated_at: string;
}

/** 查询结果摘要（与 SSE done / 历史接口一致） */
export interface ResultPreview {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  sql?: string;
  sql_type?: SqlType;
  referenced_tables?: string[];
  isStreaming?: boolean;
  elapsed_ms?: number;
  /** 服务端是否已执行 SQL（PostgreSQL / MySQL） */
  executed?: boolean;
  exec_error?: string | null;
  result_preview?: ResultPreview | null;
}

export interface ChatSession {
  session_id: string;
  messages: ChatMessage[];
}

export interface ChatSessionSummary {
  session_id: string;
  title: string;
  created_at: string;
  last_message_at: string;
}

// ── LLM Config ────────────────────────────────────────────────────────────────

export interface LLMConfig {
  id: number;
  name: string;
  config_type: "llm" | "embedding";
  model: string;
  api_key_set: boolean;
  api_base: string | null;
  extra_params: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMConfigCreate {
  name: string;
  config_type: "llm" | "embedding";
  model: string;
  api_key?: string;
  api_base?: string;
  extra_params?: Record<string, unknown>;
}

export interface LLMConfigTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
  model_used?: string;
}

// ── Analytics execute DB (NL→SQL) ─────────────────────────────────────────────

export interface AnalyticsDbSettings {
  postgres_url_masked: string | null;
  mysql_url_masked: string | null;
  postgres_stored: boolean;
  mysql_stored: boolean;
  postgres_effective_configured: boolean;
  mysql_effective_configured: boolean;
}

export interface AnalyticsDbSettingsWrite {
  postgres_url?: string | null;
  mysql_url?: string | null;
  clear_postgres?: boolean;
  clear_mysql?: boolean;
}

// ── SSE Events ────────────────────────────────────────────────────────────────

export interface MetaEvent {
  type: "meta";
  session_id: string;
  referenced_tables: string[];
  model: string;
  sql_type: SqlType;
}

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface DoneEvent {
  type: "done";
  sql: string;
  answer?: string;
  executed?: boolean;
  exec_error?: string | null;
  result_preview?: ResultPreview | null;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent = MetaEvent | TokenEvent | DoneEvent | ErrorEvent;
