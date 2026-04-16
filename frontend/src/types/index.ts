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





export interface UserScopeItem {
  dimension: "province" | "employee" | "region" | "district";
  allowed_values: string[];
  merge_mode?: "union" | "replace";
}


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
  data_scope: UserScopeItem[];
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
  data_scope?: UserScopeItem[];
}

export interface UserUpdate {
  username?: string;
  is_active?: boolean;
  province?: string | null;
  org_region?: string | null;
  employee_level?: EmployeeOrgLevel;
  district?: string | null;
  full_name?: string | null;
  password?: string;
  data_scope?: UserScopeItem[];
}

/** RAG 层级检索 ABAC（与后端 UserPermission 对齐） */
export interface UserPermission {
  unrestricted: boolean;
  allowed_prefix: string[] | null;
  allowed_prefixes: string[][];
  attributes: Record<string, unknown>;
}

export interface AdminUserRagPermissionResponse {
  effective: UserPermission;
  org_baseline: UserPermission;
  stored_override: Record<string, unknown> | null;
}

export interface RagPermissionOverrideInput {
  unrestricted: boolean;
  prefixes: string[][];
}

export interface AdminPutRagPermissionRequest {
  /** null 表示清除覆盖、恢复通讯录自动推导 */
  override: RagPermissionOverrideInput | null;
}

/** GET /admin/users/lookup-for-rag */
export interface AdminRagUserLookupResponse {
  id: number;
  username: string;
  full_name: string | null;
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
  scope_applied?: boolean;
  scope_rewrite_note?: string | null;
  scope_blocked?: boolean;
  scope_block_reason?: string | null;
  scope_disallowed_provinces?: string[];
  effective_sql?: string;
  isError?: boolean;
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

/** GET /stats/chat-queries/me | /stats/chat-queries */
export interface ChatQuerySummaryBlock {
  total_questions: number;
  active_days: number;
  distinct_sessions: number;
  last_question_at: string | null;
}

export interface ChatQueryDailyBucket {
  date: string;
  count: number;
}

export interface ChatQueryTopItem {
  normalized_key: string;
  count: number;
  example_snippet: string;
  example_query: string;
}

export interface ChatQueryStatsFiltersBlock {
  user_id: number | null;
  day_from: string | null;
  day_to: string | null;
}

export interface ChatQueryStatsResponse {
  summary: ChatQuerySummaryBlock;
  daily_trend: ChatQueryDailyBucket[];
  top_queries: ChatQueryTopItem[];
  filters: ChatQueryStatsFiltersBlock;
}

/** GET /audit/logins | /audit/queries */
export interface LoginAuditItem {
  id: number;
  user_id: number;
  username: string;
  full_name: string | null;
  login_method: string;
  client_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface LoginAuditListResponse {
  items: LoginAuditItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface QueryAuditItem {
  session_id: string;
  user_id: number;
  username: string;
  full_name: string | null;
  user_message_at: string;
  assistant_message_at: string;
  user_query: string;
  generated_sql: string;
  sql_type: SqlType | null;
  executed: boolean | null;
  elapsed_ms: number | null;
  selected_skill_names?: string[];
  scope_block_reason?: string | null;
  execution_error_category?: string | null;
}

export interface QueryAuditListResponse {
  items: QueryAuditItem[];
  total: number;
  skip: number;
  limit: number;
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

export interface AnalyticsDbConnection {
  id: number;
  name: string;
  engine: "postgresql" | "mysql";
  url_masked: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsDbConnectionCreate {
  name: string;
  engine: "postgresql" | "mysql";
  url: string;
  is_default: boolean;
}

export interface AnalyticsDbConnectionUpdate {
  name?: string;
  url?: string;
  is_default?: boolean;
}

export interface DataScopePolicy {
  id: number;
  subject_type: "user" | "user_id" | "role" | "level" | "user_name";
  subject_key: string;
  dimension: "province" | "employee" | "region" | "district";
  allowed_values: string[];
  deny_values: string[];
  merge_mode: "union" | "replace";
  priority: number;
  enabled: boolean;
  note?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DataScopePreview {
  user_id: number;
  username: string;
  source: string;
  policy_ids: number[];
  unrestricted: boolean;
  province_values: string[];
  employee_values: string[];
  region_values: string[];
  district_values: string[];
}

export interface ProvinceAlias {
  id: number;
  canonical_name: string;
  alias: string;
  enabled: boolean;
  priority: number;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

// ── SSE Events ────────────────────────────────────────────────────────────────

export interface WaitingTipSuggestion {
  id: string;
  text: string;
  rewrite_query: string;
}

export interface MetaEvent {
  type: "meta";
  session_id: string;
  referenced_tables: string[];
  model: string;
  sql_type: SqlType;
  waiting_tips?: WaitingTipSuggestion[];
}

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface DoneEvent {
  type: "done";
  sql: string;
  effective_sql?: string;
  answer?: string;
  executed?: boolean;
  exec_error?: string | null;
  result_preview?: ResultPreview | null;
  scope_applied?: boolean;
  scope_rewrite_note?: string | null;
  scope_blocked?: boolean;
  scope_block_reason?: string | null;
  scope_disallowed_provinces?: string[];
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent = MetaEvent | TokenEvent | DoneEvent | ErrorEvent;
