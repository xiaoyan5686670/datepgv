"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchAuditLogins, fetchAuditQueries } from "@/lib/api";
import type {
  LoginAuditItem,
  LoginAuditListResponse,
  QueryAuditItem,
  QueryAuditListResponse,
} from "@/types";
import { cn } from "@/lib/utils";

const PAGE = 30;

type SubTab = "logins" | "queries";

export function AdminAuditPanel() {
  const [sub, setSub] = useState<SubTab>("logins");
  const [userIdStr, setUserIdStr] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [logins, setLogins] = useState<LoginAuditListResponse | null>(null);
  const [queries, setQueries] = useState<QueryAuditListResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const uid =
      userIdStr.trim() && /^\d+$/.test(userIdStr.trim())
        ? Number.parseInt(userIdStr.trim(), 10)
        : undefined;
    try {
      if (sub === "logins") {
        const res = await fetchAuditLogins({
          user_id: uid,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          skip,
          limit: PAGE,
        });
        setLogins(res);
      } else {
        const res = await fetchAuditQueries({
          user_id: uid,
          session_id: sessionId.trim() || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          skip,
          limit: PAGE,
        });
        setQueries(res);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      if (sub === "logins") setLogins(null);
      else setQueries(null);
    } finally {
      setLoading(false);
    }
  }, [sub, userIdStr, sessionId, dateFrom, dateTo, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSkip(0);
  }, [sub, userIdStr, sessionId, dateFrom, dateTo]);

  const total = sub === "logins" ? logins?.total ?? 0 : queries?.total ?? 0;
  const canPrev = skip > 0;
  const canNext = skip + PAGE < total;

  return (
    <div className="rounded-xl border border-app-border bg-app-surface p-4 space-y-4 text-sm text-app-text">
      <div className="flex flex-wrap gap-2 border-b border-app-border pb-3">
        <button
          type="button"
          onClick={() => setSub("logins")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
            sub === "logins"
              ? "border-app-accent/40 bg-app-accent/10 text-app-accent"
              : "border-app-border text-app-muted hover:text-app-text"
          )}
        >
          登录记录
        </button>
        <button
          type="button"
          onClick={() => setSub("queries")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
            sub === "queries"
              ? "border-app-accent/40 bg-app-accent/10 text-app-accent"
              : "border-app-border text-app-muted hover:text-app-text"
          )}
        >
          查询与 SQL
        </button>
      </div>

      <p className="text-[11px] text-app-muted leading-relaxed">
        仅管理员可见。提问原文与 SQL 可能含敏感信息，请妥善保管。登录记录为成功事件（密码 /可信 SSO）。
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-xs min-w-[90px]">
          <span className="text-app-muted">用户 ID</span>
          <input
            type="text"
            inputMode="numeric"
            className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs"
            placeholder="可选"
            value={userIdStr}
            onChange={(e) => setUserIdStr(e.target.value)}
          />
        </label>
        {sub === "queries" ? (
          <label className="flex flex-col gap-0.5 text-xs min-w-[120px]">
            <span className="text-app-muted">会话 ID</span>
            <input
              type="text"
              className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs"
              placeholder="可选"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-app-muted">开始日期</span>
          <input
            type="date"
            className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-app-muted">结束日期</span>
          <input
            type="date"
            className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border border-app-border text-app-muted hover:text-app-text disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          刷新
        </button>
      </div>

      {err ? (
        <div className="text-xs text-red-500 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>
      ) : null}

      <div className="flex items-center justify-between text-xs text-app-muted">
        <span>
          共 {total} 条
          {total > 0 ? ` · 第 ${skip + 1}–${Math.min(skip + PAGE, total)} 条` : null}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canPrev || loading}
            onClick={() => setSkip((s) => Math.max(0, s - PAGE))}
            className="px-2 py-1 rounded border border-app-border disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={!canNext || loading}
            onClick={() => setSkip((s) => s + PAGE)}
            className="px-2 py-1 rounded border border-app-border disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>

      {sub === "logins" && logins ? <LoginTable items={logins.items} /> : null}
      {sub === "queries" && queries ? <QueryTable items={queries.items} /> : null}
    </div>
  );
}

function LoginTable({ items }: { items: LoginAuditItem[] }) {
  if (!items.length) {
    return <p className="text-app-muted text-sm py-8 text-center">暂无数据</p>;
  }
  return (
    <div className="overflow-x-auto border border-app-border rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-app-input border-b border-app-border text-left text-app-muted">
            <th className="px-2 py-2 font-medium">时间</th>
            <th className="px-2 py-2 font-medium">用户</th>
            <th className="px-2 py-2 font-medium">方式</th>
            <th className="px-2 py-2 font-medium">IP</th>
            <th className="px-2 py-2 font-medium">UA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {items.map((r) => (
            <tr key={r.id} className="hover:bg-app-input/50">
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td className="px-2 py-2">
                {r.username}
                {r.full_name ? ` · ${r.full_name}` : ""}
                <span className="text-app-muted"> #{r.user_id}</span>
              </td>
              <td className="px-2 py-2">{r.login_method}</td>
              <td className="px-2 py-2 max-w-[120px] truncate" title={r.client_ip ?? ""}>
                {r.client_ip ?? "—"}
              </td>
              <td className="px-2 py-2 max-w-[200px] truncate" title={r.user_agent ?? ""}>
                {r.user_agent ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryTable({ items }: { items: QueryAuditItem[] }) {
  if (!items.length) {
    return <p className="text-app-muted text-sm py-8 text-center">暂无数据</p>;
  }
  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      {items.map((r, i) => (
        <div
          key={`${r.session_id}-${r.user_message_at}-${i}`}
          className="border border-app-border rounded-lg p-3 space-y-2 bg-app-input/30"
        >
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-app-muted">
            <span>
              提问{" "}
              <span className="text-app-text tabular-nums">
                {new Date(r.user_message_at).toLocaleString()}
              </span>
            </span>
            <span>
              完成{" "}
              <span className="text-app-text tabular-nums">
                {new Date(r.assistant_message_at).toLocaleString()}
              </span>
            </span>
            {r.elapsed_ms != null ? (
              <span>
                耗时 <span className="text-app-text">{r.elapsed_ms} ms</span>
              </span>
            ) : null}
            <span>
              {r.username}
              {r.full_name ? ` · ${r.full_name}` : ""} #{r.user_id}
            </span>
            <span className="font-mono truncate max-w-[200px]" title={r.session_id}>
              {r.session_id}
            </span>
            <span>{r.sql_type ?? "—"}</span>
            <span>{r.executed ? "已执行" : r.executed === false ? "未执行" : "—"}</span>
          </div>
          <p className="text-sm text-app-text whitespace-pre-wrap break-words">{r.user_query}</p>
          <pre className="text-[11px] bg-app-bg border border-app-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
            {r.generated_sql}
          </pre>
        </div>
      ))}
    </div>
  );
}
