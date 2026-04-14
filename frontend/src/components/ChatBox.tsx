"use client";

import { Database, Loader2, Send, Sparkles, Square, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  fetchMyChatQueryStats,
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

/** 未登录 / 无个人高频时的默认话术：多组口语化问法，弱化「查询」「统计」等刻板动词 */
const DEFAULT_WELCOME_GROUPS = [
  {
    id: "people_performance",
    items: [
      "我们上个月哪个销售的业绩最好？",
      "这个季度谁完成的订单量最多？",
      "上周回款金额最高的是哪位同事？",
      "今年新客户里，哪几个销售跟进的成交最多？",
    ],
  },
  {
    id: "compare_structure",
    items: [
      "华东和华南哪边回款更高？",
      "各产品线里哪一条贡献的收入最大？",
      "不同订单状态下，哪一种占比最高？",
      "一线城市和二三线城市，哪边客单价更高？",
    ],
  },
  {
    id: "trend_anomaly",
    items: [
      "最近两周里，哪一天销量掉得最厉害？",
      "上个月新客和老客，谁花得更多？",
      "过去 30 天每天的订单量走势大概怎样？",
      "哪个城市的 GMV 在最近一个月涨得最快？",
    ],
  },
] as const;

const WELCOME_GROUP_STORAGE_KEY = "datepgv_welcome_group";

function pickWelcomeGroupIndex(userId: number | undefined): number {
  const n = DEFAULT_WELCOME_GROUPS.length;
  if (n === 0) return 0;
  if (userId != null && Number.isFinite(userId)) {
    let h = 0;
    for (const ch of String(Math.trunc(userId))) {
      h = (h * 31 + ch.charCodeAt(0)) | 0;
    }
    return ((h % n) + n) % n;
  }
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(WELCOME_GROUP_STORAGE_KEY);
    if (raw != null) {
      const v = Number.parseInt(raw, 10);
      if (!Number.isNaN(v)) return ((v % n) + n) % n;
    }
    const v = Math.floor(Math.random() * n);
    window.sessionStorage.setItem(WELCOME_GROUP_STORAGE_KEY, String(v));
    return v;
  } catch {
    return 0;
  }
}

export type WelcomeShortcutItem = {
  /** 实际发送给后端的完整问句 */
  query: string;
  /** 卡片展示（可与 query 相同） */
  label: string;
  /** 个人高频时的出现次数 */
  count?: number;
};

function buildDefaultWelcome(groupIndex: number): WelcomeShortcutItem[] {
  const n = DEFAULT_WELCOME_GROUPS.length;
  const idx = ((groupIndex % n) + n) % n;
  return DEFAULT_WELCOME_GROUPS[idx].items.map((q) => ({ query: q, label: q }));
}

/** 与「重新生成」按钮、handleRetryLast 使用同一套规则，避免仅依赖 exec_error 漏掉 executed=false 等路径 */
function assistantMessageIsRetryable(msg: ChatMessage): boolean {
  if (msg.role !== "assistant" || msg.isStreaming) return false;
  if (msg.isError) return true;
  if (msg.exec_error != null && String(msg.exec_error).trim() !== "") return true;
  const st = msg.sql_type;
  if (st === "hive" || st === "oracle") return false;
  if (
    typeof msg.content === "string" &&
    msg.content.includes("已按设置跳过数据库执行")
  ) {
    return false;
  }
  if (
    msg.executed === false &&
    typeof msg.sql === "string" &&
    msg.sql.trim() !== ""
  ) {
    return true;
  }
  return false;
}

function assistantShouldShowRetryButton(
  msg: ChatMessage,
  idx: number,
  messages: ChatMessage[],
): boolean {
  if (msg.role !== "assistant") return false;
  const aiIdxs = messages
    .map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const lastAi = aiIdxs[aiIdxs.length - 1];
  if (lastAi === undefined || idx !== lastAi) return false;
  return assistantMessageIsRetryable(msg);
}

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
  onRetry: (assistantMsgId: string) => void;
  welcomeShortcuts: WelcomeShortcutItem[];
  welcomeShortcutsLoading: boolean;
  welcomeFromPersonal: boolean;
  /** 默认话术模式下展示「换一组」 */
  welcomeShowShuffle: boolean;
  onShuffleWelcomeGroup?: () => void;
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
  onRetry,
  welcomeShortcuts,
  welcomeShortcutsLoading,
  welcomeFromPersonal,
  welcomeShowShuffle,
  onShuffleWelcomeGroup,
}: MessageListProps) {
  return (
    <>
      {messages.length === 0 && !loadingHistory && (
        <div className="flex flex-col items-center justify-center h-full gap-8 text-center max-w-2xl mx-auto px-2">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shadow-inner border border-primary/20 animate-in zoom-in duration-500">
            <Database size={40} className="text-primary" />
          </div>
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              你好，我是 DATEPGV
            </h2>
            <p className="text-muted-foreground text-base leading-relaxed">
              我可以帮你将自然语言转化为精准的 SQL 语句。
              <br />
              {isAdmin 
                ? "在 PostgreSQL / MySQL 模式下，我还可以执行查询并为你总结数据洞察。"
                : "你可以直接向我提问业务数据，我会快速为你计算并生成图表分析。"}
            </p>
          </div>
          <div className="w-full space-y-3 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground/90">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="text-amber-500 shrink-0" size={18} />
                <span>
                  {welcomeFromPersonal
                    ? "根据你的提问习惯 · 常用分析"
                    : "你可以这样问 · 口语示例"}
                </span>
              </span>
              {welcomeShowShuffle && onShuffleWelcomeGroup ? (
                <button
                  type="button"
                  onClick={onShuffleWelcomeGroup}
                  className="text-xs font-medium text-primary/90 hover:text-primary underline-offset-2 hover:underline"
                >
                  换一组
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground text-center max-w-md mx-auto leading-relaxed">
              {welcomeFromPersonal
                ? "点击下方卡片将直接发起一次新分析（与手动输入后发送相同）。"
                : "不必写「查询」「统计」——像和同事说话一样问数据即可；积累对话后将自动换成你的常用问法。"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {welcomeShortcutsLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[5.5rem] rounded-2xl border border-border/60 bg-muted/20 animate-pulse"
                    />
                  ))
                : welcomeShortcuts.map((item, idx) => (
                    <button
                      key={`${item.query}-${idx}`}
                      type="button"
                      onClick={() => send(item.query)}
                      title={item.query}
                      className="group relative text-left rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/20 px-5 py-4 shadow-sm hover:shadow-lg hover:border-primary/35 hover:-translate-y-0.5 transition-all duration-300"
                    >
                      {item.count != null && item.count > 1 ? (
                        <span className="absolute top-3 right-3 text-[10px] font-semibold tabular-nums px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15">
                          ×{item.count}
                        </span>
                      ) : null}
                      <span className="block text-sm text-foreground/90 group-hover:text-foreground leading-snug line-clamp-3 pr-10">
                        {item.label}
                      </span>
                      <span className="mt-3 block text-[10px] font-medium text-muted-foreground/80 group-hover:text-primary/80">
                        点击直接分析 →
                      </span>
                    </button>
                  ))}
            </div>
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
          key={`${msg.id}-${idx}-${msg.role}`}
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
                    <div className="w-full space-y-4">
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
                    </div>
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
                {assistantShouldShowRetryButton(msg, idx, messages) ? (
                  <div className="mt-2 flex items-center justify-start">
                    <button
                      type="button"
                      onClick={() => onRetry(msg.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-white px-3 py-1.5 rounded-full border border-destructive/30 hover:bg-destructive hover:border-destructive transition-all shadow-sm"
                    >
                      <span>🔄 重新生成</span>
                    </button>
                  </div>
                ) : null}
                {msg.role === "assistant" && msg.elapsed_ms && !msg.isError && !msg.exec_error ? (
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
  const inFlightRef = useRef(false);
  const requestStartedAtRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 当 session 因 403 重试而被替换时，跳过一次历史重载（消息已在 UI 中）
  const skipNextHistoryLoadRef = useRef(false);

  const [defaultGroupIdx, setDefaultGroupIdx] = useState(0);
  const defaultGroupIdxRef = useRef(defaultGroupIdx);
  defaultGroupIdxRef.current = defaultGroupIdx;

  /** 首帧用第 0 组，避免 SSR 与客户端 sessionStorage 不一致；useLayoutEffect 再对齐真实分组 */
  const [welcomeShortcuts, setWelcomeShortcuts] = useState<WelcomeShortcutItem[]>(() =>
    buildDefaultWelcome(0)
  );
  const [welcomeShortcutsLoading, setWelcomeShortcutsLoading] = useState(!!user?.id);
  const [welcomeFromPersonal, setWelcomeFromPersonal] = useState(false);

  useLayoutEffect(() => {
    setDefaultGroupIdx(pickWelcomeGroupIndex(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (welcomeFromPersonal) return;
    setWelcomeShortcuts(buildDefaultWelcome(defaultGroupIdx));
  }, [defaultGroupIdx, welcomeFromPersonal]);

  const bumpWelcomeGroup = useCallback(() => {
    setDefaultGroupIdx((i) => {
      const n = DEFAULT_WELCOME_GROUPS.length;
      const next = (i + 1) % n;
      if (user?.id == null && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(WELCOME_GROUP_STORAGE_KEY, String(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setWelcomeFromPersonal(false);
      setWelcomeShortcutsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setWelcomeShortcutsLoading(true);
      try {
        const stats = await fetchMyChatQueryStats({ top_n: 6, trend_days: 90 });
        if (cancelled) return;
        const tops = stats.top_queries ?? [];
        if (tops.length === 0) {
          setWelcomeFromPersonal(false);
          setWelcomeShortcuts(buildDefaultWelcome(defaultGroupIdxRef.current));
        } else {
          setWelcomeFromPersonal(true);
          setWelcomeShortcuts(
            tops.map((t) => {
              const full =
                (t.example_query && t.example_query.trim()) ||
                (t.example_snippet && t.example_snippet.replace(/…$/u, "").trim()) ||
                t.normalized_key;
              const label =
                (t.example_snippet && t.example_snippet.trim()) ||
                full;
              return {
                query: full,
                label,
                count: t.count,
              };
            })
          );
        }
      } catch {
        if (!cancelled) {
          setWelcomeFromPersonal(false);
          setWelcomeShortcuts(buildDefaultWelcome(defaultGroupIdxRef.current));
        }
      } finally {
        if (!cancelled) setWelcomeShortcutsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
            onSessionChange?.(uuidv4());
          } else {
            // Already handled 404 in api.ts, other errors clear messages
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
      if (!query.trim() || isLoading || inFlightRef.current) return;
      inFlightRef.current = true;
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
                prev.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  const mergedSql =
                    (doneEvt.sql && String(doneEvt.sql).trim()) ||
                    (doneEvt.effective_sql && String(doneEvt.effective_sql).trim()) ||
                    (m.sql && String(m.sql).trim()) ||
                    "";
                  return {
                    ...m,
                    sql: mergedSql,
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
                  };
                })
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
                        isError: true,
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
                    isError: true,
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
        inFlightRef.current = false;
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

  const handleRetryLast = useCallback((assistantMsgId: string) => {
    if (isLoading) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantMsgId);
      const aiIdxs = prev
        .map((m, i) => (m.role === "assistant" ? i : -1))
        .filter((i) => i >= 0);
      const lastAi = aiIdxs[aiIdxs.length - 1];
      if (
        idx > 0 &&
        idx === lastAi &&
        prev[idx].role === "assistant" &&
        assistantMessageIsRetryable(prev[idx]) &&
        prev[idx - 1].role === "user"
      ) {
        const retryQuery = prev[idx - 1].content;
        const newMessages = prev.slice(0, idx - 1);
        // Delay slightly to let message list collapse before new stream starts.
        setTimeout(() => send(retryQuery), 10);
        return newMessages;
      }
      return prev;
    });
  }, [isLoading, send]);


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
          onRetry={handleRetryLast}
          welcomeShortcuts={welcomeShortcuts}
          welcomeShortcutsLoading={welcomeShortcutsLoading}
          welcomeFromPersonal={welcomeFromPersonal}
          welcomeShowShuffle={!welcomeFromPersonal && !welcomeShortcutsLoading}
          onShuffleWelcomeGroup={bumpWelcomeGroup}
        />

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-background/80 backdrop-blur-md p-3 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
              {isAdmin && (
                <>
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
                </>
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
              placeholder={isAdmin ? `输入你的数据查询需求... (${
                sqlType === "hive"
                  ? "Hive"
                  : sqlType === "postgresql"
                  ? "PostgreSQL"
                  : sqlType === "mysql"
                  ? "MySQL"
                  : "Oracle"
              } 模式)` : "输入您关心的业务指标或数据分析意图..."}
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
