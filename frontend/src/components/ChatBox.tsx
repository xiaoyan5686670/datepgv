"use client";

import { Database, Loader2, Send, Square, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "@/lib/utils";
import {
  buildChatStreamUrl,
  deleteChatSession,
  fetchChatHistory,
} from "@/lib/api";
import type {
  ChatMessage,
  DoneEvent,
  MetaEvent,
  SqlType,
  SSEEvent,
  TokenEvent,
} from "@/types";
import { QueryResultPreview } from "./QueryResultPreview";
import { SQLResult } from "./SQLResult";

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

export function ChatBox({
  sqlType,
  sessionId,
  onSessionChange,
  onMessageSent,
}: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  /** 是否在生成 SQL 后由服务端执行（PostgreSQL / MySQL） */
  const [executeQuery, setExecuteQuery] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load history when sessionId changes
  useEffect(() => {
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
            return { id: String(h.id), role: "user", content: h.content };
          }
          const savedSql = h.generated_sql ?? null;
          if (savedSql) {
            return {
              id: String(h.id),
              role: "assistant",
              content: h.content,
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
      } catch {
        setMessages([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, sqlType]);

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

  const send = useCallback(
    async (query: string) => {
      if (!query.trim() || isLoading) return;
      setInput("");

      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: query,
      };
      const assistantMsgId = uuidv4();
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
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

      try {
        const res = await fetch(buildChatStreamUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            query,
            sql_type: sqlType,
            top_k: 5,
            execute: executeQuery,
          }),
          signal: controller.signal,
        });
        responseAt = performance.now();

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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, sql: accumulatedSQL }
                    : m
                )
              );
            } else if (event.type === "done") {
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
                        executed: doneEvt.executed,
                        exec_error: doneEvt.exec_error ?? undefined,
                        result_preview: doneEvt.result_preview ?? undefined,
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: `错误: ${(event as { type: "error"; message: string }).message}`,
                        isStreaming: false,
                      }
                    : m
                )
              );
            }
          }
        }
        onMessageSent?.();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: "已停止生成", isStreaming: false }
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
                  }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, sessionId, sqlType, executeQuery, onMessageSent]
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
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && !loadingHistory && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-app-accent/10 border border-app-accent/20 flex items-center justify-center">
              <Database size={32} className="text-app-accent" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-app-text mb-1">
                自然语言转 SQL
              </h2>
              <p className="text-app-muted text-sm">
                描述你的数据需求，AI 生成 SQL；PostgreSQL / MySQL 模式下还可执行查询并生成中文结论
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-sm px-4 py-3 rounded-xl bg-app-surface border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/50 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingHistory && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-app-muted gap-2">
            <Loader2 size={16} className="animate-spin" />
            加载历史记录...
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Database size={14} className="text-app-accent" />
              </div>
            )}

            <div
              className={cn(
                "max-w-3xl",
                msg.role === "user" ? "max-w-lg" : "w-full"
              )}
            >
              {msg.role === "user" ? (
                <div className="bg-app-accent text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="space-y-3">
                  {msg.content ? (
                    <div className="text-sm text-app-text bg-app-surface rounded-xl px-4 py-3 border border-app-border whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  ) : null}
                  {msg.sql ? (
                    <>
                      <SQLResult
                        sql={msg.sql}
                        sqlType={msg.sql_type ?? sqlType}
                        referencedTables={msg.referenced_tables}
                        isStreaming={msg.isStreaming}
                      />
                      {!msg.isStreaming ? (
                        <QueryResultPreview
                          sqlType={msg.sql_type ?? sqlType}
                          executed={msg.executed}
                          execError={msg.exec_error}
                          resultPreview={msg.result_preview}
                        />
                      ) : null}
                      {msg.isStreaming ? (
                        <p className="text-xs text-app-muted flex items-center gap-2">
                          <Loader2 size={12} className="animate-spin" />
                          正在完成查询或生成回答…
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {!msg.sql && !msg.content && msg.isStreaming ? (
                    <div className="text-sm text-app-muted flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      正在生成 SQL…
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-app-border bg-app-bg p-4">
        <label className="flex items-center gap-2 mb-2 px-1 text-xs text-app-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={executeQuery}
            onChange={(e) => setExecuteQuery(e.target.checked)}
            disabled={isLoading}
            className="rounded border-app-border bg-app-input text-app-accent focus:ring-app-accent/40"
            suppressHydrationWarning
          />
          生成后执行查询并展示结果（仅 PostgreSQL / MySQL；Hive / Oracle 仍以生成 SQL 为主）
        </label>
        {messages.length > 0 && (
          <div className="flex justify-end mb-2 gap-3">
            {isLoading && (
              <button
                onClick={stopGeneration}
                className="flex items-center gap-1 text-xs text-app-muted hover:text-amber-400 transition-colors"
              >
                <Square size={12} />
                停止生成
              </button>
            )}
            <button
              onClick={clearSession}
              className="flex items-center gap-1 text-xs text-app-muted hover:text-red-400 transition-colors"
            >
              <Trash2 size={12} />
              清空对话
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end bg-app-surface border border-app-border rounded-2xl px-4 py-3 focus-within:border-app-accent/50 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`描述你的查询需求，按 Enter 发送 (${
              sqlType === "hive"
                ? "Hive"
                : sqlType === "postgresql"
                ? "PostgreSQL"
                : sqlType === "mysql"
                ? "MySQL"
                : "Oracle"
            } 模式)`}
            rows={1}
            className="flex-1 bg-transparent text-sm text-app-text placeholder:text-app-subtle resize-none outline-none max-h-40 overflow-y-auto"
            style={{ lineHeight: "1.6" }}
            disabled={isLoading}
            suppressHydrationWarning
          />
          <button
            onClick={() => send(input)}
            disabled={isLoading || !input.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-app-accent hover:bg-app-accent-hover disabled:bg-app-border disabled:text-app-subtle text-white flex items-center justify-center transition-colors"
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
        <p className="text-xs text-app-subtle mt-2 text-center">
          Enter 发送 · Shift+Enter 换行 · 多轮对话支持追问
        </p>
      </div>
    </div>
  );
}
