"use client";

import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileSpreadsheet,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Share2,
  Shield,
  Table,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";
import { AuthGuard } from "@/components/AuthGuard";
import { ChatQueryStatsPanel } from "@/components/ChatQueryStatsPanel";
import { DDLImportModal } from "@/components/DDLImportModal";
import { MetadataForm } from "@/components/MetadataForm";
import { AppTopNav } from "@/components/navigation/AppTopNav";
import { PageSectionTabs } from "@/components/navigation/PageSectionTabs";
import { TableRelationsPanel } from "@/components/TableRelationsPanel";
import { cn } from "@/lib/utils";
import {
  deleteMetadata,
  fetchAdminUserRagPermission,
  fetchMetadata,
  fetchUsers,
  importCSV,
  lookupAdminUserForRag,
  putAdminUserRagPermission,
  reembedAll,
} from "@/lib/api";
import type {
  AdminUserRagPermissionResponse,
  SqlType,
  TableMetadata,
  User,
} from "@/types";

function AdminPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tables, setTables] = useState<TableMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | SqlType>("all");
  const [section, setSection] = useState<
    "tables" | "relations" | "rag" | "usage" | "audit"
  >("tables");
  /** 来自 URL `?user_id=`，供「使用统计」单人深链预填 */
  const [statsDeepLinkUserId, setStatsDeepLinkUserId] = useState<string | null>(null);
  const [ragUsers, setRagUsers] = useState<User[]>([]);
  const [ragUserId, setRagUserId] = useState<string>("");
  const [ragDetail, setRagDetail] = useState<AdminUserRagPermissionResponse | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragErr, setRagErr] = useState<string | null>(null);
  const [ragUnrestricted, setRagUnrestricted] = useState(false);
  const [ragPrefixesJson, setRagPrefixesJson] = useState<string>("[]");
  const [ragUserFilter, setRagUserFilter] = useState("");
  const [ragLookupUsername, setRagLookupUsername] = useState("");
  const [ragLookupFullName, setRagLookupFullName] = useState("");
  const [ragResolvedDisplay, setRagResolvedDisplay] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showDDL, setShowDDL] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reembedding, setReembedding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMetadata(filter, 0, 200);
      setTables(data);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    const sec = sp.get("section");
    if (sec === "tables" || sec === "relations" || sec === "rag" || sec === "usage" || sec === "audit") {
      setSection(sec);
    } else {
      setSection("tables");
    }
    const uid = sp.get("user_id");
    if (uid && /^\d+$/.test(uid.trim())) setStatsDeepLinkUserId(uid.trim());
    else setStatsDeepLinkUserId(null);
  }, [searchParams]);

  const setSectionInUrl = useCallback(
    (next: "tables" | "relations" | "rag" | "usage" | "audit") => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", next);
      if (next !== "usage") params.delete("user_id");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (section !== "rag") return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchUsers(undefined, undefined, 0, 200);
        if (!cancelled) setRagUsers(list);
      } catch {
        if (!cancelled) setRagUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section]);

  const ragUsersFiltered = useMemo(() => {
    const q = ragUserFilter.trim().toLowerCase();
    if (!q) return ragUsers;
    return ragUsers.filter((u) => {
      const un = (u.username || "").toLowerCase();
      const fn = (u.full_name || "").toLowerCase();
      return un.includes(q) || fn.includes(q);
    });
  }, [ragUsers, ragUserFilter]);

  const handleLookupUserByName = async () => {
    setRagErr(null);
    const u = ragLookupUsername.trim();
    const f = ragLookupFullName.trim();
    if (!u && !f) {
      setRagErr("请至少填写工号（username）或姓名（full_name）之一");
      return;
    }
    setRagLoading(true);
    try {
      const hit = await lookupAdminUserForRag({
        username: u || undefined,
        full_name: f || undefined,
      });
      setRagUserId(String(hit.id));
      setRagResolvedDisplay(
        `${hit.username}${hit.full_name ? ` · ${hit.full_name}` : ""}`
      );
      setRagLookupUsername(hit.username);
      setRagLookupFullName(hit.full_name ?? "");
    } catch (e) {
      setRagErr(e instanceof Error ? e.message : "查找失败");
    } finally {
      setRagLoading(false);
    }
  };

  const handleLoadRagPermission = async () => {
    setRagErr(null);
    const id = Number(ragUserId);
    if (!Number.isFinite(id) || id < 1) {
      setRagErr("请选择有效用户");
      return;
    }
    setRagLoading(true);
    try {
      const d = await fetchAdminUserRagPermission(id);
      setRagDetail(d);
      const a = d.effective.attributes as Record<string, unknown>;
      const un = a?.username != null ? String(a.username) : "";
      const fn = a?.full_name != null ? String(a.full_name) : "";
      if (un) {
        setRagResolvedDisplay(`${un}${fn ? ` · ${fn}` : ""}`);
        setRagLookupUsername(un);
        setRagLookupFullName(fn);
      }
      setRagUnrestricted(d.stored_override?.unrestricted === true);
      if (Array.isArray(d.stored_override?.prefixes)) {
        setRagPrefixesJson(JSON.stringify(d.stored_override.prefixes, null, 2));
      } else {
        setRagPrefixesJson(JSON.stringify(d.org_baseline.allowed_prefixes, null, 2));
      }
    } catch (e) {
      setRagDetail(null);
      setRagErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setRagLoading(false);
    }
  };

  const handleSaveRagOverride = async () => {
    setRagErr(null);
    const id = Number(ragUserId);
    if (!Number.isFinite(id) || id < 1) {
      setRagErr("请选择有效用户");
      return;
    }
    let prefixes: string[][] = [];
    if (!ragUnrestricted) {
      try {
        const parsed = JSON.parse(ragPrefixesJson) as unknown;
        if (!Array.isArray(parsed)) throw new Error("prefixes 须为 JSON 数组");
        prefixes = parsed.map((row) => {
          if (!Array.isArray(row)) throw new Error("每条前缀须为字符串数组");
          return row.map((x) => String(x));
        });
      } catch (e) {
        setRagErr(e instanceof Error ? e.message : "JSON 解析失败");
        return;
      }
    }
    setRagLoading(true);
    try {
      const d = await putAdminUserRagPermission(id, {
        override: { unrestricted: ragUnrestricted, prefixes },
      });
      setRagDetail(d);
      setRagErr(null);
      alert("已保存 RAG 层级权限覆盖");
    } catch (e) {
      setRagErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRagLoading(false);
    }
  };

  const handleClearRagOverride = async () => {
    setRagErr(null);
    const id = Number(ragUserId);
    if (!Number.isFinite(id) || id < 1) {
      setRagErr("请选择有效用户");
      return;
    }
    if (!confirm("确定清除手动覆盖？将恢复为通讯录自动推导。")) return;
    setRagLoading(true);
    try {
      const d = await putAdminUserRagPermission(id, { override: null });
      setRagDetail(d);
      setRagUnrestricted(false);
      setRagPrefixesJson(JSON.stringify(d.org_baseline.allowed_prefixes, null, 2));
      alert("已恢复自动推导");
    } catch (e) {
      setRagErr(e instanceof Error ? e.message : "清除失败");
    } finally {
      setRagLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除该表元数据？")) return;
    await deleteMetadata(id);
    setTables((prev) => prev.filter((t) => t.id !== id));
  };

  const handleReembed = async () => {
    setReembedding(true);
    try {
      const { reembedded } = await reembedAll();
      alert(`已重新生成 ${reembedded} 条记录的向量`);
    } finally {
      setReembedding(false);
    }
  };

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const newTables = await importCSV(file, filter === "all" ? "hive" : filter, "");
      setTables((prev) => [...newTables, ...prev]);
      alert(`成功导入 ${newTables.length} 张表`);
    } catch (err) {
      alert(`导入失败: ${err instanceof Error ? err.message : err}`);
    }
    e.target.value = "";
  };

  const hiveCount = tables.filter((t) => t.db_type === "hive").length;
  const pgCount = tables.filter((t) => t.db_type === "postgresql").length;
  const mysqlCount = tables.filter((t) => t.db_type === "mysql").length;
  const oracleCount = tables.filter((t) => t.db_type === "oracle").length;
  const withEmbedding = tables.filter((t) => t.has_embedding).length;
  const sectionLabelMap: Record<typeof section, string> = {
    tables: "表目录",
    relations: "表关系",
    rag: "RAG权限",
    usage: "使用统计",
    audit: "审计",
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <AppTopNav
        activeKey="admin"
        title="管理控制台"
        breadcrumbs={[
          { label: "管理" },
          { label: sectionLabelMap[section] },
        ]}
        rightActions={
          <>
            {section === "tables" && (
            <button
              onClick={handleReembed}
              disabled={reembedding}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/40 transition-all disabled:opacity-40"
            >
              {reembedding ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              重新生成向量
            </button>
            )}
            {section === "tables" && (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/40 transition-all"
            >
              <FileSpreadsheet size={12} />
              CSV 导入
            </button>
            )}
            {section === "tables" && (
            <button
              onClick={() => setShowDDL(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/40 transition-all"
            >
              <Upload size={12} />
              DDL 导入
            </button>
            )}
            {section === "tables" && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-app-accent hover:bg-app-accent-hover text-white transition-colors"
            >
              <Plus size={12} />
              新增表
            </button>
            )}
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={handleCSVUpload}
      />
      <div className="mx-auto max-w-6xl px-6 py-3">
        <PageSectionTabs
          items={[
            { key: "tables", label: "表目录", icon: Table },
            { key: "relations", label: "表关系", icon: GitBranch },
            { key: "rag", label: "RAG权限", icon: Shield },
            { key: "usage", label: "使用统计", icon: BarChart3, shortLabel: "统计" },
            { key: "audit", label: "审计", icon: ClipboardList },
          ]}
          active={section}
          onChange={setSectionInUrl}
        />
      </div>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats */}
        {section === "tables" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[
            { label: "全部表", value: tables.length, color: "text-app-text" },
            { label: "Hive 表", value: hiveCount, color: "text-amber-300" },
            { label: "PostgreSQL 表", value: pgCount, color: "text-blue-300" },
            { label: "MySQL 表", value: mysqlCount, color: "text-orange-300" },
            { label: "Oracle 表", value: oracleCount, color: "text-emerald-300" },
            {
              label: "已生成向量",
              value: withEmbedding,
              color: "text-green-300",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-app-surface border border-app-border rounded-xl px-4 py-3"
            >
              <p className="text-xs text-app-muted mb-1">{stat.label}</p>
              <p className={cn("text-2xl font-semibold", stat.color)}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
        )}

        {/* Filter tabs */}
        {section !== "rag" && section !== "usage" && section !== "audit" && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["all", "hive", "postgresql", "mysql", "oracle"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                filter === f
                  ? "bg-app-accent/10 text-app-accent border-app-accent/30"
                  : "text-app-muted border-app-border hover:text-app-text"
              )}
            >
              {f === "all"
                ? "全部"
                : f === "hive"
                ? "Hive"
                : f === "postgresql"
                ? "PostgreSQL"
                : f === "mysql"
                ? "MySQL"
                : "Oracle"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {section === "relations" ? (
              <Link
                href="/schema-graph"
                className="flex items-center gap-1 text-xs text-app-muted hover:text-app-accent px-2 py-1 rounded-lg border border-app-border hover:border-app-accent/40 transition-all"
              >
                <Share2 size={13} />
                关系图
              </Link>
            ) : null}
            <button
              type="button"
              onClick={load}
              className="text-app-muted hover:text-app-text transition-colors p-1"
              title="刷新列表"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        )}

        {section === "usage" ? (
          <div className="max-w-4xl space-y-4">
            <h2 className="text-lg font-semibold text-app-text">用户提问统计</h2>
            <ChatQueryStatsPanel
              key={`stats-${statsDeepLinkUserId ?? "all"}`}
              variant="admin"
              theme="app"
              initialUserId={statsDeepLinkUserId}
            />
          </div>
        ) : section === "audit" ? (
          <div className="max-w-5xl space-y-4">
            <h2 className="text-lg font-semibold text-app-text">登录与查询审计</h2>
            <AdminAuditPanel />
          </div>
        ) : section === "rag" ? (
          <div className="space-y-6 max-w-4xl">
            <p className="text-sm text-app-muted leading-relaxed">
              此处配置仅影响{" "}
              <code className="text-xs bg-app-border px-1 py-0.5 rounded">POST /api/v1/rag/search</code>{" "}
              文档块的层级过滤（<code className="text-xs">hierarchy_path @&gt; 前缀</code>）。不影响聊天 NL→SQL 的数据范围；仅管理员可见本页。
            </p>
            {ragErr && (
              <div className="text-sm text-red-500 border border-red-500/30 rounded-lg px-3 py-2">
                {ragErr}
              </div>
            )}
            <div className="space-y-3">
              <p className="text-xs text-app-muted">
                下拉仅加载前 200 个用户；其他人请用「工号 / 姓名」在库中精确查找（与列表是否加载无关）。
              </p>
              <div className="flex flex-col gap-1 min-w-[min(100%,220px)]">
                <label className="text-xs text-app-muted">筛选下拉（工号、姓名片段）</label>
                <input
                  type="search"
                  className="rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm"
                  placeholder="输入关键字以缩小下列表…"
                  value={ragUserFilter}
                  onChange={(e) => setRagUserFilter(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface p-4 space-y-3">
                <p className="text-xs font-medium text-app-text">按工号 / 姓名查找（精确匹配）</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-app-muted">工号（username）</label>
                    <input
                      type="text"
                      className="rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm"
                      placeholder="登录工号"
                      value={ragLookupUsername}
                      onChange={(e) => setRagLookupUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleLookupUserByName();
                        }
                      }}
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-app-muted">姓名（full_name）</label>
                    <input
                      type="text"
                      className="rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm"
                      placeholder="与档案姓名完全一致"
                      value={ragLookupFullName}
                      onChange={(e) => setRagLookupFullName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleLookupUserByName();
                        }
                      }}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={ragLoading}
                  onClick={() => void handleLookupUserByName()}
                  className="text-sm px-4 py-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/40 disabled:opacity-50"
                >
                  查找用户
                </button>
                {ragResolvedDisplay && (
                  <p className="text-xs text-app-muted">
                    当前选中：<span className="text-app-text">{ragResolvedDisplay}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1 min-w-[min(100%,280px)] flex-1">
                  <label className="text-xs text-app-muted">从列表选择（可选）</label>
                  <select
                    className="rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm"
                    value={ragUserId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRagUserId(v);
                      if (!v) {
                        setRagResolvedDisplay(null);
                        return;
                      }
                      const hit = ragUsers.find((x) => String(x.id) === v);
                      if (hit) {
                        setRagResolvedDisplay(
                          `${hit.username}${hit.full_name ? ` · ${hit.full_name}` : ""}`
                        );
                        setRagLookupUsername(hit.username);
                        setRagLookupFullName(hit.full_name ?? "");
                      }
                    }}
                  >
                    <option value="">请选择</option>
                    {ragUserId &&
                      !ragUsers.some((u) => String(u.id) === ragUserId) &&
                      ragResolvedDisplay && (
                        <option value={ragUserId}>
                          {ragResolvedDisplay}（未在下列表中）
                        </option>
                      )}
                    {ragUsersFiltered.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                        {u.full_name ? ` · ${u.full_name}` : ""}
                      </option>
                    ))}
                  </select>
                  {ragUserFilter && ragUsersFiltered.length === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      无匹配项，请改关键字或使用上方工号/姓名查找。
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={ragLoading}
                  onClick={handleLoadRagPermission}
                  className="text-sm px-4 py-2 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover disabled:opacity-50"
                >
                  {ragLoading ? "加载中…" : "加载权限"}
                </button>
              </div>
            </div>

            {ragDetail && (
              <div className="grid gap-4 md:grid-cols-1">
                <div className="rounded-xl border border-app-border bg-app-surface p-4">
                  <h3 className="text-xs font-semibold text-app-muted uppercase tracking-wide mb-2">
                    当前生效（含手动覆盖）
                  </h3>
                  <pre className="text-xs text-app-text overflow-x-auto whitespace-pre-wrap font-mono bg-app-input/50 rounded-lg p-3">
                    {JSON.stringify(ragDetail.effective, null, 2)}
                  </pre>
                </div>
                <div className="rounded-xl border border-app-border bg-app-surface p-4">
                  <h3 className="text-xs font-semibold text-app-muted uppercase tracking-wide mb-2">
                    通讯录自动推导（无覆盖时与生效一致）
                  </h3>
                  <pre className="text-xs text-app-text overflow-x-auto whitespace-pre-wrap font-mono bg-app-input/50 rounded-lg p-3">
                    {JSON.stringify(ragDetail.org_baseline, null, 2)}
                  </pre>
                </div>
                <div className="rounded-xl border border-app-border bg-app-surface p-4">
                  <h3 className="text-xs font-semibold text-app-muted uppercase tracking-wide mb-2">
                    库中已存覆盖 JSON
                  </h3>
                  <pre className="text-xs text-app-text overflow-x-auto whitespace-pre-wrap font-mono bg-app-input/50 rounded-lg p-3">
                    {ragDetail.stored_override
                      ? JSON.stringify(ragDetail.stored_override, null, 2)
                      : "null（未设置，走自动推导）"}
                  </pre>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-app-border bg-app-surface p-4 space-y-4">
              <h3 className="text-sm font-medium text-app-text">调整手动覆盖</h3>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={ragUnrestricted}
                  onChange={(e) => setRagUnrestricted(e.target.checked)}
                  className="rounded border-app-border"
                />
                <span>
                  对该用户 RAG 不做层级限制（等同全库可见，非 JWT 管理员）
                </span>
              </label>
              <div className={cn("space-y-1", ragUnrestricted && "opacity-40 pointer-events-none")}>
                <label className="text-xs text-app-muted">
                  前缀列表 JSON（字符串数组的数组），例如{" "}
                  <code className="text-[11px]">{`[["北部大区","广西"]]`}</code>
                </label>
                <textarea
                  className="w-full min-h-[160px] rounded-lg border border-app-border bg-app-input p-3 text-xs font-mono"
                  value={ragPrefixesJson}
                  onChange={(e) => setRagPrefixesJson(e.target.value)}
                  disabled={ragUnrestricted}
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ragLoading}
                  onClick={handleSaveRagOverride}
                  className="text-sm px-4 py-2 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover disabled:opacity-50"
                >
                  保存覆盖
                </button>
                <button
                  type="button"
                  disabled={ragLoading}
                  onClick={handleClearRagOverride}
                  className="text-sm px-4 py-2 rounded-lg border border-app-border text-app-muted hover:text-app-text disabled:opacity-50"
                >
                  清除覆盖（恢复自动）
                </button>
              </div>
            </div>
          </div>
        ) : section === "relations" ? (
          loading ? (
            <div className="flex justify-center py-20">
              <Loader2 size={24} className="animate-spin text-app-accent" />
            </div>
          ) : (
            <TableRelationsPanel tables={tables} filterDb={filter} />
          )
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-app-accent" />
          </div>
        ) : tables.length === 0 ? (
          <div className="text-center py-20 text-app-subtle">
            <Database size={40} className="mx-auto mb-3 opacity-40" />
            <p>暂无表元数据，请先导入</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tables.map((table) => (
              <div
                key={table.id}
                className="bg-app-surface border border-app-border rounded-xl overflow-hidden"
              >
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expandedId === table.id ? null : table.id)
                    }
                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 hover:bg-app-input transition-colors text-left"
                  >
                    {expandedId === table.id ? (
                      <ChevronDown size={14} className="text-app-muted flex-shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-app-muted flex-shrink-0" />
                    )}

                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded border flex-shrink-0",
                        table.db_type === "hive"
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          : table.db_type === "postgresql"
                          ? "bg-blue-500/10 text-blue-300 border-blue-500/20"
                          : table.db_type === "mysql"
                          ? "bg-orange-500/10 text-orange-300 border-orange-500/20"
                          : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                      )}
                    >
                      {table.db_type}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-app-text truncate">
                          {[table.database_name, table.schema_name, table.table_name]
                            .filter(Boolean)
                            .join(".")}
                        </span>
                        {table.has_embedding && (
                          <span className="text-xs text-green-400 flex-shrink-0">
                            ✓ 已向量化
                          </span>
                        )}
                      </div>
                      {table.table_comment && (
                        <p className="text-xs text-app-muted truncate">
                          {table.table_comment}
                        </p>
                      )}
                    </div>

                    <span className="text-xs text-app-subtle flex-shrink-0">
                      {table.columns?.length ?? 0} 字段
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(table.id)}
                    className="flex-shrink-0 px-4 text-app-subtle hover:text-red-400 hover:bg-app-input transition-colors border-l border-app-border"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Expanded columns */}
                {expandedId === table.id && (
                  <div className="border-t border-app-border px-4 pb-4 pt-3">
                    {table.tags && table.tags.length > 0 && (
                      <div className="flex gap-1 mb-3">
                        {table.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded bg-app-border text-app-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-app-subtle">
                            <th className="text-left py-1 pr-4">字段名</th>
                            <th className="text-left py-1 pr-4">类型</th>
                            <th className="text-left py-1 pr-4">注释</th>
                            <th className="text-left py-1 pr-4">可空</th>
                            <th className="text-left py-1">分区键</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(table.columns ?? []).map((col, idx) => (
                            <tr
                              key={idx}
                              className="border-t border-app-border/50"
                            >
                              <td className="py-1.5 pr-4 font-mono text-app-text">
                                {col.name}
                              </td>
                              <td className="py-1.5 pr-4 text-app-accent">
                                {col.type}
                              </td>
                              <td className="py-1.5 pr-4 text-app-muted">
                                {col.comment || "—"}
                              </td>
                              <td className="py-1.5 pr-4 text-center">
                                {col.nullable ? "✓" : "✗"}
                              </td>
                              <td className="py-1.5">
                                {col.is_partition_key ? (
                                  <span className="text-amber-400">分区</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <MetadataForm
          onSuccess={(table) => {
            setTables((prev) => [table, ...prev]);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}

      {showDDL && (
        <DDLImportModal
          onSuccess={(newTables) => {
            setTables((prev) => [...newTables, ...prev]);
            setShowDDL(false);
          }}
          onClose={() => setShowDDL(false)}
        />
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGuard requireAdmin>
      <Suspense fallback={<div className="p-8 text-sm text-app-muted">加载中…</div>}>
        <AdminPageInner />
      </Suspense>
    </AuthGuard>
  );
}
