"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Share2,
  Table,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { DDLImportModal } from "@/components/DDLImportModal";
import { MetadataForm } from "@/components/MetadataForm";
import { TableRelationsPanel } from "@/components/TableRelationsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
  deleteMetadata,
  fetchMetadata,
  importCSV,
  reembedAll,
} from "@/lib/api";
import type { SqlType, TableMetadata } from "@/types";

function AdminPageInner() {
  const [tables, setTables] = useState<TableMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | SqlType>("all");
  const [section, setSection] = useState<"tables" | "relations">("tables");
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

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      {/* Header */}
      <header className="border-b border-app-border bg-app-input px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-app-muted hover:text-app-text transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <Table size={18} className="text-app-accent" />
              <span className="font-semibold">元数据管理</span>
            </div>
            <div className="hidden sm:flex items-center rounded-lg border border-app-border p-0.5 bg-app-input">
              <button
                type="button"
                onClick={() => setSection("tables")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all",
                  section === "tables"
                    ? "bg-app-accent/15 text-app-accent"
                    : "text-app-muted hover:text-app-text"
                )}
              >
                <Table size={12} />
                表目录
              </button>
              <button
                type="button"
                onClick={() => setSection("relations")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all",
                  section === "relations"
                    ? "bg-app-accent/15 text-app-accent"
                    : "text-app-muted hover:text-app-text"
                )}
              >
                <GitBranch size={12} />
                表关系
              </button>
            </div>
            <Link
              href="/users"
              className="flex items-center gap-1.5 text-xs text-app-muted hover:text-app-text px-2.5 py-1 rounded-lg border border-app-border hover:border-app-accent/50 transition-all"
            >
              <Users size={12} />
              用户管理
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-1.5 text-xs text-app-muted hover:text-app-text px-2.5 py-1 rounded-lg border border-app-border hover:border-app-accent/50 transition-all"
            >
              <Settings size={12} />
              模型配置
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle className="p-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/50 transition-all" />
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
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleCSVUpload}
            />

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
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Mobile section tabs */}
        <div className="sm:hidden flex rounded-lg border border-app-border p-0.5 bg-app-input mb-4">
          <button
            type="button"
            onClick={() => setSection("tables")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium",
              section === "tables"
                ? "bg-app-accent/15 text-app-accent"
                : "text-app-muted"
            )}
          >
            <Table size={12} />
            表目录
          </button>
          <button
            type="button"
            onClick={() => setSection("relations")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium",
              section === "relations"
                ? "bg-app-accent/15 text-app-accent"
                : "text-app-muted"
            )}
          >
            <GitBranch size={12} />
            表关系
          </button>
        </div>

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

        {section === "relations" ? (
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
                <button
                  onClick={() =>
                    setExpandedId(expandedId === table.id ? null : table.id)
                  }
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-app-input transition-colors text-left"
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

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(table.id);
                    }}
                    className="flex-shrink-0 text-app-subtle hover:text-red-400 transition-colors ml-2"
                  >
                    <Trash2 size={14} />
                  </button>
                </button>

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
      <AdminPageInner />
    </AuthGuard>
  );
}
