"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAdminChatQueryTopCsv,
  fetchAdminChatQueryStats,
  fetchMyChatQueryStats,
} from "@/lib/api";
import type { ChatQueryStatsResponse } from "@/types";
import { cn } from "@/lib/utils";

type Variant = "me" | "admin";

function parseAdminInitialUserId(v: string | null | undefined): string {
  if (v == null) return "";
  const t = String(v).trim();
  return /^\d+$/.test(t) ? t : "";
}

interface ChatQueryStatsPanelProps {
  variant: Variant;
  /** app-* theme (admin) vs default (home sidebar) */
  theme?: "default" | "app";
  /** 从用户管理页跳转时预填用户 ID（仅 admin 统计） */
  initialUserId?: string | null;
}

export function ChatQueryStatsPanel({
  variant,
  theme = "default",
  initialUserId = null,
}: ChatQueryStatsPanelProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [trendDays, setTrendDays] = useState(30);
  const [topN, setTopN] = useState(20);
  const [userIdStr, setUserIdStr] = useState(() =>
    variant === "admin" ? parseAdminInitialUserId(initialUserId) : ""
  );
  const [data, setData] = useState<ChatQueryStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const paramsRef = useRef({
    dateFrom,
    dateTo,
    trendDays,
    topN,
    userIdStr,
  });
  paramsRef.current = { dateFrom, dateTo, trendDays, topN, userIdStr };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const p = paramsRef.current;
    try {
      const uid =
        variant === "admin" && p.userIdStr.trim()
          ? Number.parseInt(p.userIdStr.trim(), 10)
          : undefined;
      if (variant === "admin" && p.userIdStr.trim() && Number.isNaN(uid)) {
        throw new Error("用户 ID 须为数字");
      }
      const res =
        variant === "me"
          ? await fetchMyChatQueryStats({
              date_from: p.dateFrom || undefined,
              date_to: p.dateTo || undefined,
              trend_days: p.trendDays,
              top_n: p.topN,
            })
          : await fetchAdminChatQueryStats({
              user_id: uid,
              date_from: p.dateFrom || undefined,
              date_to: p.dateTo || undefined,
              trend_days: p.trendDays,
              top_n: p.topN,
            });
      setData(res);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [variant]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxTrend = useMemo(() => {
    if (!data?.daily_trend.length) return 1;
    return Math.max(...data.daily_trend.map((d) => d.count), 1);
  }, [data]);

  const isApp = theme === "app";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-4 text-sm",
        isApp
          ? "border-app-border bg-app-surface text-app-text"
          : "border-border bg-card text-foreground"
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        {variant === "admin" && (
          <label className="flex flex-col gap-0.5 text-xs min-w-[100px]">
            <span className={isApp ? "text-app-muted" : "text-muted-foreground"}>
              用户 ID
            </span>
            <input
              type="text"
              inputMode="numeric"
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs",
                isApp ? "border-app-border bg-app-input" : "border-border bg-background"
              )}
              placeholder="可选，全站留空"
              value={userIdStr}
              onChange={(e) => setUserIdStr(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-0.5 text-xs">
          <span className={isApp ? "text-app-muted" : "text-muted-foreground"}>
            开始日期
          </span>
          <input
            type="date"
            className={cn(
              "rounded-lg border px-2 py-1.5 text-xs",
              isApp ? "border-app-border bg-app-input" : "border-border bg-background"
            )}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className={isApp ? "text-app-muted" : "text-muted-foreground"}>
            结束日期
          </span>
          <input
            type="date"
            className={cn(
              "rounded-lg border px-2 py-1.5 text-xs",
              isApp ? "border-app-border bg-app-input" : "border-border bg-background"
            )}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className={isApp ? "text-app-muted" : "text-muted-foreground"}>
            趋势天数
          </span>
          <input
            type="number"
            min={1}
            max={366}
            className={cn(
              "w-20 rounded-lg border px-2 py-1.5 text-xs",
              isApp ? "border-app-border bg-app-input" : "border-border bg-background"
            )}
            value={trendDays}
            onChange={(e) => setTrendDays(Number(e.target.value) || 30)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className={isApp ? "text-app-muted" : "text-muted-foreground"}>
            Top N
          </span>
          <input
            type="number"
            min={1}
            max={100}
            className={cn(
              "w-20 rounded-lg border px-2 py-1.5 text-xs",
              isApp ? "border-app-border bg-app-input" : "border-border bg-background"
            )}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value) || 20)}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border",
            isApp
              ? "border-app-border text-app-muted hover:text-app-text disabled:opacity-50"
              : "border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          )}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          查询
        </button>
        {variant === "admin" && (
          <button
            type="button"
            onClick={() =>
              void downloadAdminChatQueryTopCsv({
                user_id:
                  userIdStr.trim() && !Number.isNaN(Number.parseInt(userIdStr.trim(), 10))
                    ? Number.parseInt(userIdStr.trim(), 10)
                    : undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                top_n: 200,
              }).catch((e) => alert(String(e)))
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border",
              isApp
                ? "border-app-border text-app-muted hover:text-app-text"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Download size={14} />
            导出 Top CSV
          </button>
        )}
      </div>

      {variant === "me" && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          高频问法按「空白折叠 + 小写」归一统计；示例为同组内最早一条原文截断。不含语义聚类（见文档二期）。
        </p>
      )}
      {variant === "admin" && (
        <p className="text-[11px] text-app-muted leading-relaxed">
          管理员可见全站或指定用户；导出为高频归一键 CSV。提问内容可能含敏感信息，请妥善保管。
        </p>
      )}

      {err && (
        <div className="text-xs text-destructive border border-destructive/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: "提问次数", v: data.summary.total_questions },
              { k: "活跃天数", v: data.summary.active_days },
              { k: "会话数", v: data.summary.distinct_sessions },
              {
                k: "最近提问",
                v: data.summary.last_question_at
                  ? new Date(data.summary.last_question_at).toLocaleString()
                  : "—",
              },
            ].map((x) => (
              <div
                key={x.k}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  isApp ? "border-app-border bg-app-input" : "border-border bg-muted/30"
                )}
              >
                <div
                  className={cn(
                    "text-[10px] uppercase tracking-wide",
                    isApp ? "text-app-muted" : "text-muted-foreground"
                  )}
                >
                  {x.k}
                </div>
                <div className="text-lg font-semibold mt-0.5">{x.v}</div>
              </div>
            ))}
          </div>

          <div>
            <div
              className={cn(
                "text-xs font-medium mb-2",
                isApp ? "text-app-muted" : "text-muted-foreground"
              )}
            >
              最近趋势（条数）
            </div>
            <div className="flex items-end gap-0.5 h-24 overflow-x-auto pb-1">
              {data.daily_trend.map((d) => (
                <div
                  key={d.date}
                  className="flex flex-col items-center gap-1 min-w-[10px]"
                  title={`${d.date}: ${d.count}`}
                >
                  <div
                    className={cn(
                      "w-full min-h-[2px] rounded-t",
                      isApp ? "bg-app-accent/80" : "bg-primary/80"
                    )}
                    style={{
                      height: `${Math.max(4, (d.count / maxTrend) * 100)}%`,
                    }}
                  />
                  <span
                    className={cn(
                      "text-[8px] rotate-[-45deg] origin-top-left whitespace-nowrap",
                      isApp ? "text-app-subtle" : "text-muted-foreground"
                    )}
                  >
                    {d.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div
              className={cn(
                "text-xs font-medium mb-2",
                isApp ? "text-app-muted" : "text-muted-foreground"
              )}
            >
              高频问法（归一键）
            </div>
            <div className="overflow-x-auto rounded-lg border border-border max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead
                  className={cn(
                    "sticky top-0",
                    isApp ? "bg-app-input" : "bg-muted/50"
                  )}
                >
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">次数</th>
                    <th className="text-left p-2">归一键</th>
                    <th className="text-left p-2">示例</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_queries.map((row, i) => (
                    <tr
                      key={`${row.normalized_key}-${i}`}
                      className={cn(
                        "border-t",
                        isApp ? "border-app-border" : "border-border"
                      )}
                    >
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      <td className="p-2 font-medium">{row.count}</td>
                      <td className="p-2 font-mono break-all max-w-[200px]">
                        {row.normalized_key}
                      </td>
                      <td className="p-2 break-words max-w-[280px]">
                        {row.example_snippet}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
