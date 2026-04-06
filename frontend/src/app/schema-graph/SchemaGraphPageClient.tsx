"use client";

import { ArrowLeft, Database, Loader2, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SchemaGraphView } from "@/components/schema-graph/SchemaGraphView";
import { ThemeToggle } from "@/components/ThemeToggle";
import { fetchTableEdges } from "@/lib/api";
import {
  edgesToGraphData,
  filterEdgesByDb,
  type GraphDbFilter,
} from "@/lib/schemaGraph";
import { cn } from "@/lib/utils";
import type { TableMetadataEdge } from "@/types";

const DB_FILTERS: { value: GraphDbFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "hive", label: "Hive" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "oracle", label: "Oracle" },
];

export function SchemaGraphPageClient() {
  const [edges, setEdges] = useState<TableMetadataEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDb, setFilterDb] = useState<GraphDbFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTableEdges();
      setEdges(data);
    } catch (e) {
      setEdges([]);
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => filterEdgesByDb(edges, filterDb),
    [edges, filterDb]
  );

  const { nodes, links } = useMemo(
    () => edgesToGraphData(filtered),
    [filtered]
  );

  const emptyAll = edges.length === 0 && !loading && !error;
  const emptyFilter =
    edges.length > 0 && filtered.length === 0 && !loading && !error;

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-app-border bg-app-input shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin"
            className="text-app-muted hover:text-app-text transition-colors shrink-0"
            title="返回元数据管理"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="w-8 h-8 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center shrink-0">
            <Share2 size={16} className="text-app-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm sm:text-base truncate">
              表关系图
            </h1>
            <p className="text-[11px] text-app-subtle hidden sm:block">
              拖拽画布平移，滚轮缩放；悬停节点或边查看详情
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="p-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/50 transition-all" />
          <Link
            href="/"
            className="text-xs text-app-muted hover:text-app-text px-3 py-1.5 rounded-lg border border-app-border hover:border-app-accent/50 transition-all"
          >
            首页
          </Link>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-3 border-b border-app-border bg-app-bg shrink-0">
        <p className="text-xs text-app-muted mb-2">仅显示两端库类型均符合的边</p>
        <div className="flex flex-wrap gap-1">
          {DB_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterDb(value)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                filterDb === value
                  ? "bg-app-accent/15 text-app-accent border border-app-accent/30"
                  : "text-app-muted hover:text-app-text border border-transparent"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 px-4 sm:px-6 py-4 flex flex-col min-h-0">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-app-accent" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-app-border bg-app-surface px-5 py-8 text-center text-sm text-app-muted">
            {error}
            <button
              type="button"
              onClick={() => load()}
              className="block mx-auto mt-4 text-xs text-app-accent hover:underline"
            >
              重试
            </button>
          </div>
        ) : emptyAll ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-app-subtle text-sm">
            <Database size={40} className="mb-3 opacity-40" />
            <p>暂无表关系数据</p>
            <p className="text-xs mt-2 text-app-muted max-w-md text-center">
              请在「元数据管理 → 表关系」中添加表之间的关联，保存后即可在此查看拓扑图。
            </p>
            <Link
              href="/admin"
              className="mt-4 text-xs text-app-accent hover:underline"
            >
              去配置表关系
            </Link>
          </div>
        ) : emptyFilter ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-app-subtle text-sm">
            <p>当前筛选下没有边</p>
            <p className="text-xs mt-2 text-app-muted">
              可切换为「全部」或换其他库类型
            </p>
          </div>
        ) : (
          <SchemaGraphView nodes={nodes} links={links} />
        )}

        {!loading && !error && links.length > 0 ? (
          <p className="text-[11px] text-app-subtle mt-3 text-center shrink-0">
            图例：节点旁为短表名与库类型；边上为关联字段或关系说明；缩放过小时边标签自动隐藏，可放大查看。箭头为「从表 → 到表」。
          </p>
        ) : null}
      </main>
    </div>
  );
}
