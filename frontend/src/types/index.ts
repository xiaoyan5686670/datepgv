export type SqlType = "hive" | "postgresql" | "oracle";

export interface ColumnInfo {
  name: string;
  type: string;
  comment: string;
  nullable: boolean;
  is_partition_key: boolean;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  sql_type?: SqlType;
  referenced_tables?: string[];
  isStreaming?: boolean;
}

export interface ChatSession {
  session_id: string;
  messages: ChatMessage[];
}

export interface ChatSessionSummary {
  session_id: string;
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
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent = MetaEvent | TokenEvent | DoneEvent | ErrorEvent;
