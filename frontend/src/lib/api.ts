import type { ChatMessage, SqlType, TableMetadata } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API = `${BASE}/api/v1`;

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
  if (!res.ok) throw new Error(await res.text());
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

// ── Chat sessions ───────────────────────────────────────────────────────────────

export interface ChatSessionSummary {
  session_id: string;
  title: string;
  first_message_at: string | null;
  last_message_at: string | null;
}

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API}/chat/sessions/${sessionId}/history`);
  if (!res.ok) {
    // 404 表示还没有历史，会话可以视为空
    if (res.status === 404) return [];
    throw new Error(await res.text());
  }
  const data = (await res.json()) as {
    id: number;
    role: ChatMessage["role"];
    content: string;
    sql_type: SqlType | null;
    created_at: string;
  }[];

  return data.map((m) => ({
    id: String(m.id),
    role: m.role,
    content: m.content,
    sql_type: m.sql_type ?? undefined,
  }));
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API}/chat/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(await res.text());
  }
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await fetch(`${API}/chat/sessions`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
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

// ── App settings (embedding dimension) ────────────────────────────────────────

export async function getEmbeddingDim(): Promise<{ embedding_dim: number }> {
  const res = await fetch(`${API}/settings/embedding-dim`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function setEmbeddingDim(embedding_dim: number): Promise<{ embedding_dim: number }> {
  const res = await fetch(`${API}/settings/embedding-dim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embedding_dim }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
