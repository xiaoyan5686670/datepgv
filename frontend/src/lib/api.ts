import type {
  AuthUser,
  ChatSessionSummary,
  SqlType,
  TableMetadata,
  TableMetadataEdge,
  TableRelationType,
} from "@/types";

export const ACCESS_TOKEN_KEY = "datepgv_access_token";

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setStoredAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
}

/**
 * FastAPI is reached via Next.js rewrite `/api/backend/*` → backend `/api/v1/*`
 * (see next.config.js). No frontend .env needed for the API base URL.
 */
function apiV1Prefix(): string {
  if (typeof window !== "undefined") {
    return "/api/backend";
  }
  return `${(process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/api/v1`;
}

/** Merge Bearer token into fetch init (skips when no token). */
export function authFetchInit(init?: RequestInit): RequestInit {
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, authFetchInit(init));
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as {
        detail?: string | Array<string | { msg?: string }>;
      };
      const d = payload?.detail;
      if (typeof d === "string") return d;
      if (Array.isArray(d) && d.length > 0) {
        const first = d[0];
        if (typeof first === "string") return first;
        if (first && typeof first === "object" && "msg" in first) {
          return String(first.msg);
        }
      }
    } else {
      const text = (await res.text()).trim();
      if (text) return text;
    }
  } catch {
    // ignore parse errors and return fallback
  }
  return fallback;
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{ access_token: string; token_type: string }> {
  const body = new URLSearchParams();
  body.set("username", username);
  body.set("password", password);
  const res = await fetch(`${apiV1Prefix()}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "登录失败"));
  }
  return res.json() as Promise<{ access_token: string; token_type: string }>;
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await apiFetch(`${apiV1Prefix()}/auth/me`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "未登录或凭证已失效"));
  }
  return res.json() as Promise<AuthUser>;
}

export async function fetchTableEdges(): Promise<TableMetadataEdge[]> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/edges`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载表关系失败"));
  }
  return res.json();
}

export async function createTableEdge(payload: {
  from_metadata_id: number;
  to_metadata_id: number;
  relation_type: TableRelationType;
  from_column?: string | null;
  to_column?: string | null;
  note?: string | null;
}): Promise<TableMetadataEdge> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/edges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "添加表关系失败"));
  }
  return res.json();
}

export async function deleteTableEdge(id: number): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/edges/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "删除失败"));
  }
}

export async function fetchMetadata(
  dbType: "all" | SqlType = "all",
  skip = 0,
  limit = 50
): Promise<TableMetadata[]> {
  const params = new URLSearchParams({
    db_type: dbType,
    skip: String(skip),
    limit: String(limit),
  });
  const res = await apiFetch(`${apiV1Prefix()}/metadata/?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMetadata(id: number): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function importDDL(
  ddl: string,
  dbType: SqlType,
  databaseName?: string
): Promise<TableMetadata[]> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/import/ddl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ddl, db_type: dbType, database_name: databaseName }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "DDL 导入失败"));
  }
  return res.json();
}

export async function importDDLFile(
  file: File,
  dbType: SqlType,
  databaseName?: string
): Promise<TableMetadata[]> {
  const form = new FormData();
  form.append("file", file);
  form.append("db_type", dbType);
  form.append("database_name", databaseName ?? "");
  const res = await apiFetch(`${apiV1Prefix()}/metadata/import/ddl-file`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "DDL 文件导入失败"));
  }
  return res.json();
}

export async function importCSV(
  file: File,
  dbType: SqlType,
  databaseName: string
): Promise<TableMetadata[]> {
  const form = new FormData();
  form.append("file", file);
  form.append("db_type", dbType);
  form.append("database_name", databaseName);
  const res = await apiFetch(`${apiV1Prefix()}/metadata/import/csv`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMetadata(
  payload: Omit<TableMetadata, "id" | "has_embedding" | "created_at" | "updated_at">
): Promise<TableMetadata> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function reembedAll(): Promise<{ reembedded: number }> {
  const res = await apiFetch(`${apiV1Prefix()}/metadata/reembed`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function buildChatStreamUrl(): string {
  return `${apiV1Prefix()}/chat/stream`;
}

export async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/sessions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchChatHistory(
  sessionId: string
): Promise<
  {
    id: number;
    role: "user" | "assistant";
    content: string;
    sql_type: SqlType | null;
    generated_sql?: string | null;
    executed?: boolean | null;
    exec_error?: string | null;
    result_preview?: {
      columns: string[];
      rows: Record<string, unknown>[];
      truncated?: boolean;
    } | null;
    created_at: string;
  }[]
> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/sessions/${sessionId}/history`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

// ── LLM Config ────────────────────────────────────────────────────────────────

import type {
  AnalyticsDbSettings,
  AnalyticsDbSettingsWrite,
  LLMConfig,
  LLMConfigCreate,
  LLMConfigTestResult,
} from "@/types";

export async function fetchConfigs(
  configType: "llm" | "embedding" | "all" = "all"
): Promise<LLMConfig[]> {
  const res = await apiFetch(`${apiV1Prefix()}/config/?config_type=${configType}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createConfig(payload: LLMConfigCreate): Promise<LLMConfig> {
  const res = await apiFetch(`${apiV1Prefix()}/config/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateConfig(
  id: number,
  payload: Partial<LLMConfigCreate>
): Promise<LLMConfig> {
  const res = await apiFetch(`${apiV1Prefix()}/config/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteConfig(id: number): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/config/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function activateConfig(id: number): Promise<LLMConfig> {
  const res = await apiFetch(`${apiV1Prefix()}/config/${id}/activate`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function testConfig(id: number): Promise<LLMConfigTestResult> {
  const res = await apiFetch(`${apiV1Prefix()}/config/${id}/test`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getActiveConfig(
  configType: "llm" | "embedding"
): Promise<LLMConfig | null> {
  const res = await apiFetch(`${apiV1Prefix()}/config/active/${configType}`);
  if (!res.ok) return null;
  return res.json();
}

/** List model names from a running Ollama instance (via backend proxy). */
// ── Analytics DB (execute targets) ────────────────────────────────────────────

export async function fetchAnalyticsDbSettings(): Promise<AnalyticsDbSettings> {
  const res = await apiFetch(`${apiV1Prefix()}/config/analytics-db`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载数据连接配置失败"));
  }
  return res.json();
}

export async function updateAnalyticsDbSettings(
  payload: AnalyticsDbSettingsWrite
): Promise<AnalyticsDbSettings> {
  const res = await apiFetch(`${apiV1Prefix()}/config/analytics-db`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "保存失败"));
  }
  return res.json();
}

export async function testAnalyticsDbConnection(
  engine: "postgresql" | "mysql",
  url?: string | null
): Promise<LLMConfigTestResult> {
  const res = await apiFetch(`${apiV1Prefix()}/config/analytics-db/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine, url: url?.trim() || null }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "测试请求失败"));
  }
  return res.json();
}

export async function fetchOllamaModels(apiBase: string): Promise<string[]> {
  const params = new URLSearchParams({
    api_base: apiBase.trim() || "http://127.0.0.1:11434",
  });
  const res = await apiFetch(`${apiV1Prefix()}/config/ollama/models?${params}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "获取 Ollama 模型列表失败"));
  }
  const data = (await res.json()) as { models?: string[] };
  return data.models ?? [];
}
