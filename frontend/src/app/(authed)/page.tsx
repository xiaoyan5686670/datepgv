"use client";

import {
  BarChart3,
  Menu,
  MessageSquarePlus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ChatBox } from "@/components/ChatBox";
import { ChatQueryStatsPanel } from "@/components/ChatQueryStatsPanel";
import { ModelSwitcher } from "@/components/ModelSwitcher";
import { AppTopNav } from "@/components/navigation/AppTopNav";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { deleteChatSession, fetchChatSessions } from "@/lib/api";
import type { ChatSessionSummary, SqlType } from "@/types";

function lsKey(userId: number): string {
  return `datepgv_chat_session_id_${userId}`;
}

function getOrCreateSessionId(userId: number): string {
  if (typeof window === "undefined") return uuidv4();
  const key = lsKey(userId);
  const saved = window.localStorage.getItem(key);
  if (saved) return saved;
  const id = uuidv4();
  window.localStorage.setItem(key, id);
  return id;
}

function persistSessionId(id: string, userId: number) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(lsKey(userId), id);
  }
}

function HomePageInner() {
  const { user } = useAuth();
  const userId = user!.id;
  const isAdmin = user?.roles?.includes("admin") ?? false;
  const [sqlType, setSqlType] = useState<SqlType>("mysql");
  // AuthGuard guarantees user is non-null before this component renders.
  const [activeSessionId, setActiveSessionId] = useState<string>(() => getOrCreateSessionId(userId));
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showMyStats, setShowMyStats] = useState(false);

  // Reset session when the logged-in account changes (same browser, different user).
  useEffect(() => {
    if (!user) return;
    setActiveSessionId(getOrCreateSessionId(userId));
  }, [user, userId]);

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
    persistSessionId(newId, userId);
    setActiveSessionId(newId);
  }, [userId]);

  const handleNewSession = useCallback(() => {
    const id = uuidv4();
    persistSessionId(id, userId);
    setActiveSessionId(id);
    setMobileSidebarOpen(false);
  }, [userId]);

  const handleSelectSession = useCallback(
    (sid: string) => {
      if (sid === activeSessionId) return;
      persistSessionId(sid, userId);
      setActiveSessionId(sid);
      setMobileSidebarOpen(false);
    },
    [activeSessionId, userId]
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
      <AppTopNav
        activeKey="home"
        title="DATEPGV"
        subtitle="NL-to-SQL System"
        rightActions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-2 rounded-lg border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
              aria-label="打开历史会话"
            >
              <Menu size={16} />
            </button>
            <div className="hidden sm:block">
              <ModelSwitcher />
            </div>
            {isAdmin ? (
              <div className="hidden lg:flex items-center bg-muted/50 border rounded-full p-1 max-w-full overflow-x-auto">
                <button
                  onClick={() => setSqlType("hive")}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap",
                    sqlType === "hive" ? "bg-amber-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Hive
                </button>
                <button
                  onClick={() => setSqlType("postgresql")}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap",
                    sqlType === "postgresql" ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  PostgreSQL
                </button>
                <button
                  onClick={() => setSqlType("mysql")}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap",
                    sqlType === "mysql" ? "bg-orange-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  MySQL
                </button>
                <button
                  onClick={() => setSqlType("oracle")}
                  className={cn(
                    "px-3 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap",
                    sqlType === "oracle" ? "bg-emerald-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Oracle
                </button>
              </div>
            ) : null}
          </div>
        }
      />

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
            <button
              type="button"
              onClick={() => setShowMyStats((v) => !v)}
              className="mt-2 flex items-center justify-center gap-2 w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground border rounded-xl bg-background hover:bg-muted/40 transition-all"
            >
              <BarChart3 size={14} />
              {showMyStats ? "收起提问统计" : "我的提问统计"}
            </button>
          </div>

          {showMyStats && (
            <div className="px-3 pb-3 max-h-[50vh] overflow-y-auto">
              <ChatQueryStatsPanel variant="me" theme="default" />
            </div>
          )}

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

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="关闭历史会话面板"
            />
            <aside className="relative z-10 w-[86vw] max-w-xs h-full flex flex-col border-r bg-background">
              <div className="flex items-center justify-between p-4 border-b">
                <div className="text-sm font-semibold">历史会话</div>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-4">
                <button
                  onClick={handleNewSession}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-xl shadow-sm transition-all active:scale-[0.98]"
                >
                  <MessageSquarePlus size={16} />
                  开启新对话
                </button>
                <button
                  type="button"
                  onClick={() => setShowMyStats((v) => !v)}
                  className="mt-2 flex items-center justify-center gap-2 w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground border rounded-xl bg-background hover:bg-muted/40 transition-all"
                >
                  <BarChart3 size={14} />
                  {showMyStats ? "收起提问统计" : "我的提问统计"}
                </button>
              </div>
              {showMyStats && (
                <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto border-b">
                  <ChatQueryStatsPanel variant="me" theme="default" />
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-2 pb-4">
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
                              ? "bg-muted shadow-sm border ring-1 ring-primary/10"
                              : "hover:bg-muted/60 border-transparent"
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
                              {new Date(s.last_message_at).toLocaleDateString()} · {new Date(s.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(s.session_id)}
                            className="absolute right-2 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
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
          </div>
        )}

        {/* Chat area */}
        <section className="flex-1 overflow-hidden">
          <ChatBox
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
  return <HomePageInner />;
}
