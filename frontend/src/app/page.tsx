"use client";

import { Database, Settings, Table } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatBox } from "@/components/ChatBox";
import { cn } from "@/lib/utils";
import type { SqlType } from "@/types";
import { listChatSessions, type ChatSessionSummary } from "@/lib/api";

export default function HomePage() {
  const [sqlType, setSqlType] = useState<SqlType>("hive");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadSessions = async () => {
      setIsLoadingSessions(true);
      try {
        const data = await listChatSessions();
        if (cancelled) return;
        setSessions(data);
        if (!activeSessionId && typeof window !== "undefined") {
          const current = window.localStorage.getItem("datepgv_chat_session_id");
          setActiveSessionId(current ?? data[0]?.session_id ?? null);
        }
      } catch (err) {
        console.error("加载会话列表失败", err);
      } finally {
        if (!cancelled) setIsLoadingSessions(false);
      }
    };
    loadSessions();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

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
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-hidden flex">
        {/* Session list */}
        <aside className="hidden md:flex w-64 border-r border-[#2a2d3d] bg-[#0b0d14] flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d3d]">
            <span className="text-xs font-medium text-[#a0aec0]">会话</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingSessions ? (
              <div className="flex items-center justify-center h-full text-xs text-[#4a5568]">
                正在加载会话...
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[#4a5568]">
                暂无历史会话，开始提问以创建新会话。
              </div>
            ) : (
              <ul className="py-2">
                {sessions.map((s) => (
                  <li key={s.session_id}>
                    <button
                      onClick={() => setActiveSessionId(s.session_id)}
                      className={cn(
                        "w-full text-left px-4 py-2 text-xs rounded-md transition-colors",
                        activeSessionId === s.session_id
                          ? "bg-[#1a1d27] text-[#e2e8f0]"
                          : "text-[#a0aec0] hover:bg-[#111827]"
                      )}
                    >
                      <div className="truncate">{s.title}</div>
                      {s.last_message_at && (
                        <div className="mt-0.5 text-[10px] text-[#4a5568]">
                          {new Date(s.last_message_at).toLocaleString()}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Chat box */}
        <section className="flex-1 overflow-hidden">
          <ChatBox sqlType={sqlType} />
        </section>
      </main>
    </div>
  );
}
