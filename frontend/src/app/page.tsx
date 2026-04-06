"use client";

import {
  Database,
  MessageSquarePlus,
  Settings,
  Table,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ChatBox } from "@/components/ChatBox";
import { cn } from "@/lib/utils";
import { deleteChatSession, fetchChatSessions } from "@/lib/api";
import type { ChatSessionSummary, SqlType } from "@/types";

const LS_KEY = "datepgv_chat_session_id";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return uuidv4();
  const saved = window.localStorage.getItem(LS_KEY);
  if (saved) return saved;
  const id = uuidv4();
  window.localStorage.setItem(LS_KEY, id);
  return id;
}

function persistSessionId(id: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LS_KEY, id);
  }
}

export default function HomePage() {
  const [sqlType, setSqlType] = useState<SqlType>("mysql");
  const [activeSessionId, setActiveSessionId] = useState<string>(getOrCreateSessionId);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load sessions on mount and whenever refreshKey changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchChatSessions();
        if (!cancelled) setSessions(data);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSessionChange = useCallback((newId: string) => {
    persistSessionId(newId);
    setActiveSessionId(newId);
  }, []);

  const handleNewSession = useCallback(() => {
    const id = uuidv4();
    persistSessionId(id);
    setActiveSessionId(id);
  }, []);

  const handleSelectSession = useCallback(
    (sid: string) => {
      if (sid === activeSessionId) return;
      persistSessionId(sid);
      setActiveSessionId(sid);
    },
    [activeSessionId]
  );

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      if (!confirm("确定删除该会话及其所有历史记录？")) return;
      try {
        await deleteChatSession(sid);
        setSessions((prev) => prev.filter((s) => s.session_id !== sid));
        if (sid === activeSessionId) {
          handleNewSession();
        }
      } catch (err) {
        alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeSessionId, handleNewSession]
  );

  return (
    <div className="flex flex-col h-screen bg-[#0f1117]">
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2d3d] bg-[#12151f]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center">
            <Database size={16} className="text-[#0ea5e9]" />
          </div>
          <span className="font-semibold text-[#e2e8f0]">NL-to-SQL</span>
          <span className="text-xs text-[#4a5568] hidden sm:block">
            自然语言转 SQL 生成系统
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* SQL type toggle */}
          <div className="flex flex-col items-end gap-1">
          <div className="flex items-center bg-[#1a1d27] border border-[#2a2d3d] rounded-lg p-0.5">
            <button
              onClick={() => setSqlType("hive")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "hive"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              Hive
            </button>
            <button
              onClick={() => setSqlType("postgresql")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "postgresql"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              PostgreSQL
            </button>
            <button
              onClick={() => setSqlType("mysql")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "mysql"
                  ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              MySQL
            </button>
            <button
              onClick={() => setSqlType("oracle")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "oracle"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              Oracle
            </button>
          </div>
          <span className="text-[10px] text-[#4a5568] max-w-[280px] text-right leading-snug hidden lg:block">
            PostgreSQL / MySQL：可生成并在服务端执行 SQL；Hive / Oracle：仅生成 SQL
          </span>
          </div>

          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
          >
            <Table size={13} />
            元数据管理
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
          >
            <Settings size={13} />
            模型配置
          </Link>
          <Link
            href="/docs"
            className="flex items-center gap-1.5 text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
          >
            文档
          </Link>
        </div>
      </header>

      {/* Main: sidebar + chat */}
      <main className="flex-1 overflow-hidden flex">
        {/* Session sidebar */}
        <aside className="hidden md:flex w-64 flex-col border-r border-[#2a2d3d] bg-[#0b0d14]">
          {/* New session button */}
          <div className="px-3 py-3 border-b border-[#2a2d3d]">
            <button
              onClick={handleNewSession}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-[#e2e8f0] bg-[#1a1d27] border border-[#2a2d3d] rounded-lg hover:border-[#0ea5e9]/50 transition-all"
            >
              <MessageSquarePlus size={14} className="text-[#0ea5e9]" />
              新建会话
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[#4a5568] text-center">
                暂无历史会话
              </div>
            ) : (
              <ul className="py-1">
                {sessions.map((s) => (
                  <li key={s.session_id} className="group px-2 py-0.5">
                    <div
                      className={cn(
                        "w-full rounded-lg text-xs transition-all flex items-stretch gap-0 border",
                        activeSessionId === s.session_id
                          ? "bg-[#1a1d27] border-[#0ea5e9]/30"
                          : "border-transparent hover:bg-[#111827]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectSession(s.session_id)}
                        className={cn(
                          "flex-1 min-w-0 text-left px-3 py-2 rounded-l-lg",
                          activeSessionId === s.session_id
                            ? "text-[#e2e8f0]"
                            : "text-[#a0aec0]"
                        )}
                      >
                        <div className="truncate leading-5">{s.title}</div>
                        <div className="text-[10px] text-[#4a5568] mt-0.5">
                          {new Date(s.last_message_at).toLocaleString()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(s.session_id)}
                        className="flex-shrink-0 self-start mt-1 mr-1 p-1 rounded opacity-0 group-hover:opacity-100 text-[#4a5568] hover:text-red-400 transition-all"
                        title="删除会话"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Chat area */}
        <section className="flex-1 overflow-hidden">
          <ChatBox
            key={activeSessionId}
            sqlType={sqlType}
            sessionId={activeSessionId}
            onSessionChange={handleSessionChange}
            onMessageSent={triggerRefresh}
          />
        </section>
      </main>
    </div>
  );
}
