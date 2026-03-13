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
          return {
            id: String(h.id),
            role: "assistant",
            content: "",
            sql: h.content,
            sql_type: (h.sql_type as SqlType) ?? sqlType,
            referenced_tables: [],
            isStreaming: false,
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

      try {
        const res = await fetch(buildChatStreamUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            query,
            sql_type: sqlType,
            top_k: 5,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
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
              const doneEvt = event as DoneEvent;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, sql: doneEvt.sql, isStreaming: false }
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
    [isLoading, sessionId, sqlType, onMessageSent]
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
            <div className="w-16 h-16 rounded-2xl bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center">
              <Database size={32} className="text-[#0ea5e9]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[#e2e8f0] mb-1">
                自然语言转 SQL
              </h2>
              <p className="text-[#8892a4] text-sm">
                描述你的数据需求，AI 自动生成{" "}
                {sqlType === "hive"
                  ? "Hive"
                  : sqlType === "postgresql"
                  ? "PostgreSQL"
                  : "Oracle"}{" "}
                SQL
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-sm px-4 py-3 rounded-xl bg-[#1a1d27] border border-[#2a2d3d] text-[#8892a4] hover:text-[#e2e8f0] hover:border-[#0ea5e9]/50 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingHistory && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-[#8892a4] gap-2">
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
              <div className="w-8 h-8 rounded-lg bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Database size={14} className="text-[#0ea5e9]" />
              </div>
            )}

            <div
              className={cn(
                "max-w-3xl",
                msg.role === "user" ? "max-w-lg" : "w-full"
              )}
            >
              {msg.role === "user" ? (
                <div className="bg-[#0ea5e9] text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="space-y-3">
                  {msg.sql ? (
                    <SQLResult
                      sql={msg.sql}
                      sqlType={msg.sql_type ?? sqlType}
                      referencedTables={msg.referenced_tables}
                      isStreaming={msg.isStreaming}
                    />
                  ) : msg.content ? (
                    <div className="text-sm text-[#8892a4] bg-[#1a1d27] rounded-xl px-4 py-3 border border-[#2a2d3d]">
                      {msg.isStreaming ? (
                        <span className="flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          正在检索相关表结构...
                        </span>
                      ) : (
                        msg.content
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-[#8892a4] flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      正在生成 SQL...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#2a2d3d] bg-[#0f1117] p-4">
        {messages.length > 0 && (
          <div className="flex justify-end mb-2 gap-3">
            {isLoading && (
              <button
                onClick={stopGeneration}
                className="flex items-center gap-1 text-xs text-[#8892a4] hover:text-amber-400 transition-colors"
              >
                <Square size={12} />
                停止生成
              </button>
            )}
            <button
              onClick={clearSession}
              className="flex items-center gap-1 text-xs text-[#8892a4] hover:text-red-400 transition-colors"
            >
              <Trash2 size={12} />
              清空对话
            </button>
          </div>
        )}
        <div className="flex gap-3 items-end bg-[#1a1d27] border border-[#2a2d3d] rounded-2xl px-4 py-3 focus-within:border-[#0ea5e9]/50 transition-colors">
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
                : "Oracle"
            } 模式)`}
            rows={1}
            className="flex-1 bg-transparent text-sm text-[#e2e8f0] placeholder-[#4a5568] resize-none outline-none max-h-40 overflow-y-auto"
            style={{ lineHeight: "1.6" }}
            disabled={isLoading}
          />
          <button
            onClick={() => send(input)}
            disabled={isLoading || !input.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#0ea5e9] hover:bg-[#0284c7] disabled:bg-[#2a2d3d] disabled:text-[#4a5568] text-white flex items-center justify-center transition-colors"
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
        <p className="text-xs text-[#4a5568] mt-2 text-center">
          Enter 发送 · Shift+Enter 换行 · 多轮对话支持追问
        </p>
      </div>
    </div>
  );
}
