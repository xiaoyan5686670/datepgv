import type { ChatSessionSummary, SqlType, TableMetadata } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API = `${BASE}/api/v1`;

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await res.json()) as { detail?: string };
      if (payload?.detail) return payload.detail;
    } else {
      const text = (await res.text()).trim();
      if (text) return text;
    }
  } catch {
    // ignore parse errors and return fallback
  }
  return fallback;
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
  const res = await fetch(`${API}/metadata/?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMetadata(id: number): Promise<void> {
  const res = await fetch(`${API}/metadata/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function importDDL(
  ddl: string,
  dbType: SqlType,
  databaseName?: string
): Promise<TableMetadata[]> {
  const res = await fetch(`${API}/metadata/import/ddl`, {
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
  const res = await fetch(`${API}/metadata/import/ddl-file`, {
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
  const res = await fetch(`${API}/metadata/import/csv`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMetadata(
  payload: Omit<TableMetadata, "id" | "has_embedding" | "created_at" | "updated_at">
): Promise<TableMetadata> {
  const res = await fetch(`${API}/metadata/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function reembedAll(): Promise<{ reembedded: number }> {
  const res = await fetch(`${API}/metadata/reembed`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function buildChatStreamUrl(): string {
  return `${API}/chat/stream`;
}

export async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await fetch(`${API}/chat/sessions`);
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
    created_at: string;
  }[]
> {
  const res = await fetch(`${API}/chat/sessions/${sessionId}/history`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API}/chat/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

// ── LLM Config ────────────────────────────────────────────────────────────────

import type { LLMConfig, LLMConfigCreate, LLMConfigTestResult } from "@/types";

export async function fetchConfigs(
  configType: "llm" | "embedding" | "all" = "all"
): Promise<LLMConfig[]> {
  const res = await fetch(`${API}/config/?config_type=${configType}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createConfig(payload: LLMConfigCreate): Promise<LLMConfig> {
  const res = await fetch(`${API}/config/`, {
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
  const res = await fetch(`${API}/config/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteConfig(id: number): Promise<void> {
  const res = await fetch(`${API}/config/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export async function activateConfig(id: number): Promise<LLMConfig> {
  const res = await fetch(`${API}/config/${id}/activate`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function testConfig(id: number): Promise<LLMConfigTestResult> {
  const res = await fetch(`${API}/config/${id}/test`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getActiveConfig(
  configType: "llm" | "embedding"
): Promise<LLMConfig | null> {
  const res = await fetch(`${API}/config/active/${configType}`);
  if (!res.ok) return null;
  return res.json();
}
