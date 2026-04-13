"use client";

import { Database, Loader2, Send, Square, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "@/lib/utils";
import {
  ApiError,
  authFetchInit,
  buildChatStreamUrl,
  deleteChatSession,
  fetchAnalyticsConnections,
  fetchChatHistory,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type {
  AnalyticsDbConnection,
  ChatMessage,
  DoneEvent,
  MetaEvent,
  SqlType,
  SSEEvent,
  TokenEvent,
} from "@/types";
import { MarkdownViewer } from "./MarkdownViewer";
import { QueryResultPreview } from "./QueryResultPreview";
import { SQLResult } from "./SQLResult";
import { DynamicChart, type ChartConfig } from "./DynamicChart";

const SUGGESTED_QUERIES = [
  "查询过去 7 天每个部门的销售总额",
  "统计各状态订单数量及占比",
  "找出最近一个月新注册且有过购买记录的用户",
  "按城市汇总近 30 天的 GMV，取 Top 10",
];

interface ChatBoxProps {
  sqlType: SqlType;
  sessionId: string;
  onSessionChange: (newSessionId: string) => void;
  onMessageSent?: () => void;
}

interface MessageListProps {
  messages: ChatMessage[];
  loadingHistory: boolean;
  sqlType: SqlType;
  isAdmin: boolean;
  send: (query: string) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${totalSec}s`;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}

function parseMessageContent(content: string) {
  if (!content) return { text: "", chartConfig: null };
  const chartRegex = /```(?:json)?\s*\n?\s*({[\s\S]*?"chart_type"[\s\S]*?})\s*\n?```/i;
  const match = content.match(chartRegex);
  if (match) {
    try {
      const chartConfig = JSON.parse(match[1]) as ChartConfig;
      const text = content.replace(chartRegex, "").trim();
      return { text, chartConfig };
    } catch {
      return { text: content, chartConfig: null };
    }
  }
  return { text: content, chartConfig: null };
}

const MessageList = memo(function MessageList({
  messages,
  loadingHistory,
  sqlType,
  isAdmin,
  send,
}: MessageListProps) {
  return (
    <>
      {messages.length === 0 && !loadingHistory && (
        <div className="flex flex-col items-center justify-center h-full gap-8 text-center max-w-2xl mx-auto">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center shadow-inner border border-primary/20 animate-in zoom-in duration-500">
            <Database size={40} className="text-primary" />
          </div>
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-3xl font-bold tracking-tight">
              你好，我是 DATEPGV
            </h2>
            <p className="text-muted-foreground text-base leading-relaxed">
              我可以帮你将自然语言转化为精准的 SQL 语句。
              <br />
              在 PostgreSQL / MySQL 模式下，我还可以执行查询并为你总结数据洞察。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="text-left text-sm px-5 py-4 rounded-2xl bg-card border hover:border-primary/50 hover:shadow-md hover:bg-accent/50 transition-all duration-300 group"
              >
                <span className="text-muted-foreground group-hover:text-foreground transition-colors">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loadingHistory && messages.length === 0 && (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-3 animate-pulse">
          <Loader2 size={18} className="animate-spin text-primary" />
          正在加载历史会话...
        </div>
      )}

      {messages.map((msg, idx) => (
        <div
          key={msg.id}
          className={cn(
            "flex gap-2 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
            msg.role === "user" ? "flex-row-reverse" : "flex-row"
          )}
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-1 shadow-sm border",
            msg.role === "user"
              ? "bg-primary text-primary-foreground border-primary/20"
              : "bg-background text-primary border-border"
          )}>
            {msg.role === "user" ? (
              <span className="text-xs font-bold">U</span>
            ) : (
              <Database size={16} />
            )}
          </div>

          <div
            className={cn(
              "flex flex-col gap-3",
              msg.role === "user" ? "items-end max-w-[88%] sm:max-w-[80%]" : "items-start w-full max-w-[95%] sm:max-w-[90%]"
            )}
          >
            {msg.role === "user" ? (
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none px-5 py-3 text-sm shadow-sm leading-relaxed">
                {msg.content}
              </div>
            ) : (
              <div className="w-full space-y-4">
                {(() => {
                  const { text, chartConfig } = parseMessageContent(msg.content);
                  return (
                    <>
                      {text ? (
                        <div className="text-sm text-foreground bg-card rounded-2xl rounded-tl-none px-5 py-4 border shadow-sm leading-relaxed animate-in fade-in duration-500 overflow-x-auto">
                          <MarkdownViewer source={text} />
                        </div>
                      ) : null}
                      {chartConfig && msg.result_preview && (
                        <div className="animate-in zoom-in-95 duration-500">
                          <DynamicChart 
                            config={chartConfig} 
                            columns={msg.result_preview.columns} 
                            rows={msg.result_preview.rows} 
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
                {msg.sql ? (
                  <div className="w-full animate-in zoom-in-95 duration-300">
                    {msg.isStreaming && isAdmin ? (
                      <p className="text-xs text-muted-foreground mb-2 px-1 leading-relaxed">
                        由于权限审核，最终以改写后的 SQL 为准。
                      </p>
                    ) : null}
                    {isAdmin && (
                      <SQLResult
                        sql={msg.sql}
                        sqlType={msg.sql_type ?? sqlType}
                        referencedTables={msg.referenced_tables}
                        isStreaming={msg.isStreaming}
                      />
                    )}
                    {!msg.isStreaming ? (
                      <div className={isAdmin ? "mt-3" : ""}>
                        <QueryResultPreview
                          sqlType={msg.sql_type ?? sqlType}
                          executed={msg.executed}
                          execError={msg.exec_error}
                          resultPreview={msg.result_preview}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {msg.isStreaming && !msg.sql && !msg.content && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/30 px-5 py-3 rounded-2xl border border-dashed">
                    <Loader2 size={16} className="animate-spin text-primary" />
                    <span>思考中，正在生成 SQL...</span>
                  </div>
                )}
                {msg.role === "assistant" && msg.elapsed_ms ? (
                  <div className="text-[11px] text-muted-foreground/80 px-1">
                    本轮耗时: {formatDuration(msg.elapsed_ms)}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
});

export function ChatBox({
  sqlType,
  sessionId,
  onSessionChange,
  onMessageSent,
}: ChatBoxProps) {
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes("admin") ?? false;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  /** 是否在生成 SQL 后由服务端执行（PostgreSQL / MySQL） */
  const [executeQuery, setExecuteQuery] = useState(true);
  /** 空字符串表示使用后端默认连接 */
  const [executeConnectionId, setExecuteConnectionId] = useState("");
  const [analyticsConnections, setAnalyticsConnections] = useState<
    AnalyticsDbConnection[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestStartedAtRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 当 session 因 403 重试而被替换时，跳过一次历史重载（消息已在 UI 中）
  const skipNextHistoryLoadRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (sqlType !== "mysql" && sqlType !== "postgresql") {
      setAnalyticsConnections([]);
      setExecuteConnectionId("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchAnalyticsConnections();
        if (!cancelled) {
          setAnalyticsConnections(list.filter((c) => c.engine === sqlType));
          setExecuteConnectionId("");
        }
      } catch {
        if (!cancelled) {
          setAnalyticsConnections([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sqlType]);

  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 300);
    return () => window.clearInterval(id);
  }, [isLoading]);

  // Load history when sessionId changes
  useEffect(() => {
    // 403 重试后 session 已切换，但消息已在 UI 中，跳过本次历史加载
    if (skipNextHistoryLoadRef.current) {
      skipNextHistoryLoadRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const history = await fetchChatHistory(sessionId);
        if (cancelled) return;
        if (!history.length) {
          setMessages([]);
          return;
        }
        const mapped: ChatMessage[] = history.map((h) => {
          if (h.role === "user") {
            return {
              id: String(h.id),
              role: "user",
              content: h.content,
              created_at: h.created_at,
            };
          }
          const savedSql = h.generated_sql ?? null;
          if (savedSql) {
            return {
              id: String(h.id),
              role: "assistant",
              content: h.content,
              created_at: h.created_at,
              sql: savedSql,
              sql_type: (h.sql_type as SqlType) ?? sqlType,
              referenced_tables: [],
              isStreaming: false,
              executed: h.executed ?? undefined,
              exec_error: h.exec_error ?? undefined,
              result_preview: h.result_preview ?? undefined,
            };
          }
          return {
            id: String(h.id),
            role: "assistant",
            content: "",
            created_at: h.created_at,
            sql: h.content,
            sql_type: (h.sql_type as SqlType) ?? sqlType,
            referenced_tables: [],
            isStreaming: false,
            executed: h.executed ?? undefined,
            exec_error: h.exec_error ?? undefined,
            result_preview: h.result_preview ?? undefined,
          };
        });
        setMessages(mapped);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            // session 属于其他用户，自动切换新 session
            onSessionChange?.(uuidv4());
          } else {
            // 404 = session 尚未入库（新会话，正常）；其他错误同理：清空消息，等用户发第一条时自动创建
            setMessages([]);
          }
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, sqlType, onSessionChange]);

  const clearSession = useCallback(async () => {
    try {
      await deleteChatSession(sessionId);
    } catch {
      // session may already be gone
    }
    const nextId = uuidv4();
    setMessages([]);
    onSessionChange(nextId);
    onMessageSent?.();
  }, [sessionId, onSessionChange, onMessageSent]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const elapsedCompletedMs = messages.reduce(
    (sum, msg) => sum + (msg.role === "assistant" ? msg.elapsed_ms ?? 0 : 0),
    0
  );
  const elapsedOngoingMs =
    isLoading && requestStartedAtRef.current
      ? Math.max(0, Math.round(nowMs - requestStartedAtRef.current))
      : 0;
  const sessionElapsedMs = elapsedCompletedMs + elapsedOngoingMs;

  const send = useCallback(
    async (query: string) => {
      if (!query.trim() || isLoading) return;
      setInput("");
      const requestStartAt = Date.now();
      requestStartedAtRef.current = requestStartAt;

      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: query,
        created_at: new Date().toISOString(),
      };
      const assistantMsgId = uuidv4();
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
        sql: "",
        sql_type: sqlType,
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const fetchStart = performance.now();
      let responseAt = fetchStart;
      let metaAt: number | null = null;
      let firstTokenAt: number | null = null;

      // 当前使用的 sessionId（403 时会替换为新 UUID 重试）
      let effectiveSessionId = sessionId;

      const doFetch = (sid: string) =>
        fetch(
          buildChatStreamUrl(),
          authFetchInit({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sid,
              query,
              sql_type: sqlType,
              top_k: 5,
              execute: executeQuery,
              ...(executeConnectionId !== ""
                ? { execute_connection_id: Number(executeConnectionId) }
                : {}),
            }),
            signal: controller.signal,
          })
        );

      try {
        let res = await doFetch(effectiveSessionId);
        responseAt = performance.now();

        // session 归属冲突时自动生成新 session 并重试一次
        // 注意：不在这里调用 onSessionChange，避免触发父组件 key 变化导致组件重新挂载
        if (res.status === 403) {
          const newSid = uuidv4();
          effectiveSessionId = newSid;
          res = await doFetch(newSid);
          responseAt = performance.now();
        }

        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const errData = await res.json();
            if (errData.detail) msg = errData.detail;
          } catch {}
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedSQL = "";
        let pendingSQL: string | null = null;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flushSQL = () => {
          if (pendingSQL === null) return;
          const nextSQL = pendingSQL;
          pendingSQL = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, sql: nextSQL }
                : m
            )
          );
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            const event: SSEEvent = JSON.parse(raw);

            if (event.type === "meta") {
              if (metaAt === null) metaAt = performance.now();
              const meta = event as MetaEvent;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        referenced_tables: meta.referenced_tables,
                        sql_type: meta.sql_type,
                      }
                    : m
                )
              );
            } else if (event.type === "token") {
              if (firstTokenAt === null) firstTokenAt = performance.now();
              const token = event as TokenEvent;
              accumulatedSQL += token.text;
              pendingSQL = accumulatedSQL;
              if (flushTimer === null) {
                flushTimer = setTimeout(() => {
                  flushTimer = null;
                  flushSQL();
                }, 50);
              }
            } else if (event.type === "done") {
              if (flushTimer !== null) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              flushSQL();
              if (process.env.NODE_ENV === "development") {
                const doneAt = performance.now();
                console.info("[chat/stream client timings ms]", {
                  ttfb: Number((responseAt - fetchStart).toFixed(1)),
                  toMeta:
                    metaAt != null
                      ? Number((metaAt - fetchStart).toFixed(1))
                      : null,
                  metaToFirstToken:
                    metaAt != null && firstTokenAt != null
                      ? Number((firstTokenAt - metaAt).toFixed(1))
                      : null,
                  toFirstToken:
                    firstTokenAt != null
                      ? Number((firstTokenAt - fetchStart).toFixed(1))
                      : null,
                  total: Number((doneAt - fetchStart).toFixed(1)),
                });
              }
              const doneEvt = event as DoneEvent;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        sql: doneEvt.sql,
                        content: doneEvt.answer ?? "",
                        isStreaming: false,
                        elapsed_ms: Math.max(
                          0,
                          Math.round(Date.now() - requestStartAt)
                        ),
                        executed: doneEvt.executed,
                        exec_error: doneEvt.exec_error ?? undefined,
                        result_preview: doneEvt.result_preview ?? undefined,
                        scope_applied: doneEvt.scope_applied ?? undefined,
                        scope_rewrite_note: doneEvt.scope_rewrite_note ?? undefined,
                        effective_sql: doneEvt.effective_sql ?? undefined,
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              if (flushTimer !== null) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              flushSQL();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: `错误: ${(event as { type: "error"; message: string }).message}`,
                        isStreaming: false,
                        elapsed_ms: Math.max(
                          0,
                          Math.round(Date.now() - requestStartAt)
                        ),
                      }
                    : m
                )
              );
            }
          }
        }
        // 流完成后，如果因 403 替换了 session，通知父组件更新
        // 同时设置 flag，跳过下一次 useEffect 历史加载，保留当前消息
        if (effectiveSessionId !== sessionId) {
          skipNextHistoryLoadRef.current = true;
          onSessionChange?.(effectiveSessionId);
        }
        onMessageSent?.();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: "已停止生成",
                    isStreaming: false,
                    elapsed_ms: Math.max(
                      0,
                      Math.round(Date.now() - requestStartAt)
                    ),
                  }
                : m
            )
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: `请求失败: ${err instanceof Error ? err.message : "未知错误"}`,
                    isStreaming: false,
                        elapsed_ms: Math.max(
                          0,
                          Math.round(Date.now() - requestStartAt)
                        ),
                  }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        requestStartedAtRef.current = null;
        abortRef.current = null;
      }
    },
    [
      isLoading,
      sessionId,
      sqlType,
      executeQuery,
      executeConnectionId,
      onMessageSent,
      onSessionChange,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-8 py-4 sm:py-8 space-y-6 sm:space-y-8">
        <MessageList
          messages={messages}
          loadingHistory={loadingHistory}
          sqlType={sqlType}
          isAdmin={isAdmin}
          send={send}
        />

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-background/80 backdrop-blur-md p-3 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={executeQuery}
                  onChange={(e) => setExecuteQuery(e.target.checked)}
                  disabled={isLoading}
                  className="rounded-sm border-muted-foreground/30 bg-background text-primary focus:ring-primary/20"
                  suppressHydrationWarning
                />
                <span>生成后尝试执行查询（仅 PostgreSQL / MySQL）</span>
              </label>
              {(sqlType === "mysql" || sqlType === "postgresql") &&
                executeQuery &&
                analyticsConnections.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap shrink-0">执行连接</span>
                    <select
                      value={executeConnectionId}
                      onChange={(e) => setExecuteConnectionId(e.target.value)}
                      disabled={isLoading}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs max-w-[min(100%,280px)] min-w-0"
                    >
                      <option value="">默认</option>
                      {analyticsConnections.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                          {c.is_default ? "（默认）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
            </div>
            <div className="text-[11px] text-muted-foreground/80 font-medium">
              会话累计耗时: {formatDuration(sessionElapsedMs)}
            </div>
            
            {messages.length > 0 && (
              <div className="flex items-center gap-4">
                {isLoading && (
                  <button
                    onClick={stopGeneration}
                    className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-500 transition-colors"
                  >
                    <Square size={12} fill="currentColor" />
                    停止生成
                  </button>
                )}
                <button
                  onClick={clearSession}
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 size={12} />
                  清空对话
                </button>
              </div>
            )}
          </div>

          <div className="relative flex items-end gap-2 sm:gap-3 bg-card border shadow-sm rounded-2xl p-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all duration-200">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`输入你的数据查询需求... (${
                sqlType === "hive"
                  ? "Hive"
                  : sqlType === "postgresql"
                  ? "PostgreSQL"
                  : sqlType === "mysql"
                  ? "MySQL"
                  : "Oracle"
              } 模式)`}
              rows={1}
              className="flex-1 bg-transparent text-sm px-2 sm:px-3 py-2.5 min-h-[44px] max-h-40 resize-none outline-none placeholder:text-muted-foreground/60"
              style={{ lineHeight: "1.6" }}
              disabled={isLoading}
              suppressHydrationWarning
            />
            <button
              onClick={() => send(input)}
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground flex items-center justify-center shadow-sm transition-all active:scale-95"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
          
          <p className="text-[10px] text-muted-foreground/60 text-center font-medium">
            Enter 发送 · Shift+Enter 换行 · 支持多轮对话
          </p>
        </div>
      </div>
    </div>
  );
}
