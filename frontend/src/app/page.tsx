"use client";

import {
  Database,
  LogOut,
  MessageSquarePlus,
  Settings,
  Table,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { AuthGuard } from "@/components/AuthGuard";
import { ChatBox } from "@/components/ChatBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
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

function HomePageInner() {
  const { user, logout } = useAuth();
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
    <div className="flex flex-col h-screen bg-app-bg">
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shadow-sm border border-primary/20">
            <Database size={18} className="text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight">DATEPGV</span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider hidden sm:block">
              NL-to-SQL System
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* SQL type toggle */}
          <div className="flex flex-col items-end gap-1">
          <div className="flex items-center bg-muted/50 border rounded-full p-1">
            <button
              onClick={() => setSqlType("hive")}
              className={cn(
                "px-4 py-1 rounded-full text-[11px] font-semibold transition-all",
                sqlType === "hive"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Hive
            </button>
            <button
              onClick={() => setSqlType("postgresql")}
              className={cn(
                "px-4 py-1 rounded-full text-[11px] font-semibold transition-all",
                sqlType === "postgresql"
                  ? "bg-blue-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              PostgreSQL
            </button>
            <button
              onClick={() => setSqlType("mysql")}
              className={cn(
                "px-4 py-1 rounded-full text-[11px] font-semibold transition-all",
                sqlType === "mysql"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              MySQL
            </button>
            <button
              onClick={() => setSqlType("oracle")}
              className={cn(
                "px-4 py-1 rounded-full text-[11px] font-semibold transition-all",
                sqlType === "oracle"
                  ? "bg-emerald-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Oracle
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground max-w-[280px] text-right leading-snug hidden lg:block">
            PostgreSQL / MySQL: 可执行 · Hive / Oracle: 仅生成
          </span>
          </div>

          <div className="h-8 w-px bg-border mx-1" />

          <ThemeToggle className="p-2 rounded-full border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all" />
          
          {user?.roles.includes("admin") ? (
            <div className="flex items-center gap-2">
              <Link
                href="/admin"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-full border bg-background hover:bg-accent transition-all"
              >
                <Table size={14} />
                元数据
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-full border bg-background hover:bg-accent transition-all"
              >
                <Settings size={14} />
                配置
              </Link>
            </div>
          ) : null}
          
          <div className="flex items-center gap-3 pl-2">
            <div className="flex flex-col items-end">
              <span className="text-xs font-semibold max-w-[100px] truncate" title={user?.username}>
                {user?.username}
              </span>
              <button
                onClick={() => logout()}
                className="text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors"
              >
                退出登录
              </button>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              {user?.username?.[0]?.toUpperCase() || "U"}
            </div>
          </div>
        </div>
      </header>

      {/* Main: sidebar + chat */}
      <main className="flex-1 overflow-hidden flex">
        {/* Session sidebar */}
        <aside className="hidden md:flex w-72 flex-col border-r bg-muted/30">
          {/* New session button */}
          <div className="p-4">
            <button
              onClick={handleNewSession}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-xl shadow-sm transition-all active:scale-[0.98]"
            >
              <MessageSquarePlus size={16} />
              开启新对话
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            <div className="px-3 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              历史会话
            </div>
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-xs text-muted-foreground text-center italic">
                暂无历史记录
              </div>
            ) : (
              <ul className="space-y-1">
                {sessions.map((s) => (
                  <li key={s.session_id} className="group">
                    <div
                      className={cn(
                        "relative w-full rounded-xl text-sm transition-all flex items-center group",
                        activeSessionId === s.session_id
                          ? "bg-background shadow-sm border ring-1 ring-primary/10"
                          : "hover:bg-background/50 border-transparent"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectSession(s.session_id)}
                        className={cn(
                          "flex-1 min-w-0 text-left px-4 py-3 rounded-xl",
                          activeSessionId === s.session_id
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <div className="truncate pr-6">{s.title}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-1 font-medium">
                          {new Date(s.last_message_at).toLocaleDateString()} · {new Date(s.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(s.session_id)}
                        className="absolute right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title="删除会话"
                      >
                        <Trash2 size={14} />
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

export default function HomePage() {
  return (
    <AuthGuard>
      <HomePageInner />
    </AuthGuard>
  );
}
