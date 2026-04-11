import type {
  AdminPutRagPermissionRequest,
  AdminUserRagPermissionResponse,
  AuthUser,
  ChatSessionSummary,
  OrgGraphResponse,
  SqlType,
  SyncOrgCsvResponse,
  TableMetadata,
  TableMetadataEdge,
  TableRelationType,
  User,
  UserCreate,
  UserUpdate,
  UserImportRequest,
  UserImportResponse,
  DataScopePolicy,
  DataScopePreview,
} from "@/types";

export const ACCESS_TOKEN_KEY = "datepgv_access_token";

/** Cookie mirror lifetime — must cover typical JWT session; proxy reads this if `Authorization` is stripped. */
const ACCESS_TOKEN_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

function readAccessTokenCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${ACCESS_TOKEN_KEY}=`;
  for (const segment of document.cookie.split(";")) {
    const part = segment.trim();
    if (!part.startsWith(prefix)) continue;
    const raw = part.slice(prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function writeAccessTokenCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACCESS_TOKEN_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${ACCESS_TOKEN_COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
}

function clearAccessTokenCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACCESS_TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  let token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    token = readAccessTokenCookie();
    if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } else if (readAccessTokenCookie() !== token) {
    writeAccessTokenCookie(token);
  }
  return token;
}

export function setStoredAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    writeAccessTokenCookie(token);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    clearAccessTokenCookie();
  }
}

/**
 * In the real browser, always call same-origin `/api/backend/*` (App Route proxies to FastAPI).
 * Do not call `http://127.0.0.1:8000` from the page: that is cross-origin vs Next (e.g. :3000),
 * preflight/credentials differ, and you often get 401 even when logged in.
 *
 * Note: avoid `typeof window !== "undefined"` alone — some Next/Webpack shared chunks have
 * incorrectly folded that to the server branch, producing the wrong base URL in the browser.
 */
function apiV1Prefix(): string {
  // Frontend requests must always go through Next.js same-origin proxy.
  // This avoids cross-origin auth drift and prevents accidental direct calls to backend origin.
  return "/api/backend";
}

function normalizeBrowserApiUrl(input: string): string {
  if (typeof window === "undefined") return input;
  try {
    const u = new URL(input, window.location.origin);
    const backendOrigin = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    if (u.origin === backendOrigin && u.pathname.startsWith("/api/v1/")) {
      return `/api/backend${u.pathname.slice("/api/v1".length)}${u.search}`;
    }
  } catch {
    // ignore parse errors and fall back to original input
  }
  return input;
}

/** Custom header echoed by `/api/backend/*` when `Authorization` is stripped upstream. */
export const DATEPGV_AUTH_HEADER = "X-DatePGV-Authorization";

/** Merge Bearer token into fetch init (skips when no token). */
export function authFetchInit(init?: RequestInit): RequestInit {
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    const bearer = `Bearer ${token}`;
    headers.set("Authorization", bearer);
    headers.set(DATEPGV_AUTH_HEADER, bearer);
  }
  return { ...init, headers };
}

function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(normalizeBrowserApiUrl(input), authFetchInit(init));
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

// ── Chat LLM model list / switch ─────────────────────────────────────────────

export interface LLMModelOption {
  id: number;
  name: string;
  model: string;
  is_active: boolean;
}

export async function fetchLLMModels(): Promise<LLMModelOption[]> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/models`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "加载模型列表失败"));
  return res.json();
}

export async function activateLLMModel(configId: number): Promise<LLMModelOption> {
  const res = await apiFetch(`${apiV1Prefix()}/chat/models/${configId}/activate`, { method: "POST" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "切换模型失败"));
  return res.json();
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
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载模型配置失败"));
  }
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

export async function fetchScopePolicies(): Promise<DataScopePolicy[]> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "加载权限策略失败"));
  return res.json();
}

export async function createScopePolicy(
  payload: Omit<DataScopePolicy, "id" | "created_at" | "updated_at">
): Promise<DataScopePolicy> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "创建权限策略失败"));
  return res.json();
}

export async function updateScopePolicy(
  id: number,
  payload: Partial<Omit<DataScopePolicy, "id" | "created_at" | "updated_at">>
): Promise<DataScopePolicy> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "更新权限策略失败"));
  return res.json();
}

export async function deleteScopePolicy(id: number): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "删除权限策略失败"));
  }
}

export async function bulkSetScopePoliciesEnabled(
  ids: number[],
  enabled: boolean
): Promise<DataScopePolicy[]> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies/bulk-set-enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, enabled }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "批量更新策略失败"));
  return res.json();
}

export async function previewScopeForUser(userId: number): Promise<DataScopePreview> {
  const res = await apiFetch(`${apiV1Prefix()}/config/scope-policies/preview/${userId}`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "获取策略预览失败"));
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

// ── User Management ───────────────────────────────────────────────────────────

export async function fetchAdminUserRagPermission(
  userId: number
): Promise<AdminUserRagPermissionResponse> {
  const res = await apiFetch(`${apiV1Prefix()}/admin/users/${userId}/rag-permission`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载 RAG 层级权限失败"));
  }
  return res.json();
}

export async function putAdminUserRagPermission(
  userId: number,
  body: AdminPutRagPermissionRequest
): Promise<AdminUserRagPermissionResponse> {
  const res = await apiFetch(`${apiV1Prefix()}/admin/users/${userId}/rag-permission`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "保存 RAG 层级权限失败"));
  }
  return res.json();
}

export async function fetchUsers(
  province?: string,
  employeeLevel?: string,
  skip = 0,
  limit = 50
): Promise<User[]> {
  const params = new URLSearchParams({
    skip: String(skip),
    limit: String(limit),
  });
  if (province) params.append("province", province);
  if (employeeLevel) params.append("employee_level", employeeLevel);

  const res = await apiFetch(`${apiV1Prefix()}/users/?${params}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载用户列表失败"));
  }
  return res.json();
}

export async function createUser(payload: UserCreate): Promise<User> {
  const res = await apiFetch(`${apiV1Prefix()}/users/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "创建用户失败"));
  }
  return res.json();
}

export async function updateUser(id: number, payload: UserUpdate): Promise<User> {
  const res = await apiFetch(`${apiV1Prefix()}/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "更新用户失败"));
  }
  return res.json();
}

export async function deleteUser(id: number): Promise<void> {
  const res = await apiFetch(`${apiV1Prefix()}/users/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorMessage(res, "删除用户失败"));
  }
}

export async function importUsers(payload: UserImportRequest): Promise<UserImportResponse> {
  const res = await apiFetch(`${apiV1Prefix()}/users/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "用户导入失败"));
  }
  return res.json();
}

export async function importUsersCsv(
  file: File,
  overwriteExisting = false
): Promise<UserImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(
    `${apiV1Prefix()}/users/import/csv?overwrite_existing=${overwriteExisting}`,
    {
      method: "POST",
      body: form,
    }
  );
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "CSV 导入失败"));
  }
  return res.json();
}

export async function syncUsersFromOrgCsv(
  overwriteExisting = false,
  defaultPassword?: string
): Promise<SyncOrgCsvResponse> {
  const params = new URLSearchParams();
  if (overwriteExisting) params.set("overwrite_existing", "true");
  if (defaultPassword?.trim()) params.set("default_password", defaultPassword.trim());
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`${apiV1Prefix()}/users/sync/org-csv${suffix}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "同步通讯录失败"));
  }
  return res.json();
}

export async function fetchOrgGraph(): Promise<OrgGraphResponse> {
  const res = await apiFetch(`${apiV1Prefix()}/users/org-graph`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "加载组织架构失败"));
  }
  return res.json();
}
