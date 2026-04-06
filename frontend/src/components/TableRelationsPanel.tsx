"use client";

import {
  ArrowRight,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createTableEdge, deleteTableEdge, fetchTableEdges } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SqlType, TableMetadata, TableMetadataEdge, TableRelationType } from "@/types";

const RELATION_OPTIONS: { value: TableRelationType; label: string; hint: string }[] = [
  {
    value: "foreign_key",
    label: "按字段关联（像外键）",
    hint: "两张表通过某个字段对上号，例如订单里的 user_id 对应用户表",
  },
  {
    value: "logical",
    label: "业务上相关",
    hint: "没有直接字段也能说明它们同属一个业务主题",
  },
  {
    value: "coquery",
    label: "经常一起查",
    hint: "实际分析时常常同时用到，让系统在问一句话时自动带上另一张表",
  },
];

function dbBadgeClass(db: string) {
  if (db === "hive") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (db === "postgresql") return "bg-blue-500/10 text-blue-300 border-blue-500/20";
  if (db === "mysql") return "bg-orange-500/10 text-orange-300 border-orange-500/20";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
}

function relationLabel(t: TableRelationType) {
  return RELATION_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

interface TableRelationsPanelProps {
  tables: TableMetadata[];
  filterDb: "all" | SqlType;
}

export function TableRelationsPanel({ tables, filterDb }: TableRelationsPanelProps) {
  const [edges, setEdges] = useState<TableMetadataEdge[]>([]);
  const [loadingEdges, setLoadingEdges] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [relationType, setRelationType] = useState<TableRelationType>("foreign_key");
  const [fromCol, setFromCol] = useState("");
  const [toCol, setToCol] = useState("");
  const [note, setNote] = useState("");

  const pickList = useMemo(() => {
    if (filterDb === "all") return tables;
    return tables.filter((t) => t.db_type === filterDb);
  }, [tables, filterDb]);

  const loadEdges = useCallback(async () => {
    setLoadingEdges(true);
    try {
      const data = await fetchTableEdges();
      setEdges(data);
    } catch {
      setEdges([]);
    } finally {
      setLoadingEdges(false);
    }
  }, []);

  useEffect(() => {
    loadEdges();
  }, [loadEdges]);

  const handleAdd = async () => {
    const a = Number(fromId);
    const b = Number(toId);
    if (!a || !b || a === b) {
      alert("请选两张不同的表：左边一张、右边一张。");
      return;
    }
    setSaving(true);
    try {
      await createTableEdge({
        from_metadata_id: a,
        to_metadata_id: b,
        relation_type: relationType,
        from_column: fromCol.trim() || null,
        to_column: toCol.trim() || null,
        note: note.trim() || null,
      });
      setFromCol("");
      setToCol("");
      setNote("");
      await loadEdges();
      alert("已保存。之后用自然语言问问题时，系统会尽量把有关联的表一起交给 AI。");
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这条表关系？")) return;
    try {
      await deleteTableEdge(id);
      setEdges((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const selectedHint = RELATION_OPTIONS.find((o) => o.value === relationType)?.hint;

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="rounded-xl border border-app-border bg-app-surface p-4 flex gap-3">
        <Info size={20} className="text-app-accent flex-shrink-0 mt-0.5" />
        <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
          <p>
            <strong className="text-app-text">这一步在做什么？</strong>
            用鼠标把「相关的两张表」连起来。这样您只用平常说话问问题，后台也会自动把关联表一并提供给
            AI，减少漏表、写不出 JOIN 的情况。
          </p>
          <p className="text-app-muted text-xs">
            不需要懂 SQL。若保存时提示数据库未就绪，把下面文件名发给技术人员执行一次即可：
            <code className="mx-1 rounded bg-app-input px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
              init-db/02-table_metadata_edges.sql
            </code>
          </p>
        </div>
      </div>

      {pickList.length < 2 ? (
        <div className="text-center py-16 text-app-muted border border-dashed border-app-border rounded-xl">
          <GitBranch size={36} className="mx-auto mb-3 opacity-40" />
          <p>这里至少要登记两张表，才能连线。</p>
          <p className="text-sm mt-2">请切换到「表目录」，先导入或新增表元数据。</p>
        </div>
      ) : (
        <>
          {/* 添加表单 — 图形化：左表 → 右表 */}
          <div className="rounded-xl border border-app-border bg-app-surface p-5 space-y-4">
            <h3 className="text-sm font-medium text-app-text flex items-center gap-2">
              <GitBranch size={16} className="text-app-accent" />
              新建一条关系
            </h3>

            <div className="flex flex-col lg:flex-row lg:items-stretch gap-4">
              <div className="flex-1 space-y-2">
                <label className="text-xs text-app-muted">第一张表（例如：订单表）</label>
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2.5"
                >
                  <option value="">请选择…</option>
                  {pickList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.table_name}（{t.db_type}）·{" "}
                      {[t.database_name, t.schema_name].filter(Boolean).join(".") ||
                        "无库名"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-center lg:pt-6">
                <div className="flex items-center gap-2 text-app-accent">
                  <div className="hidden lg:block h-px w-8 bg-app-border" />
                  <ArrowRight size={22} className="flex-shrink-0" />
                  <div className="hidden lg:block h-px w-8 bg-app-border" />
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-xs text-app-muted">第二张表（例如：用户表）</label>
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2.5"
                >
                  <option value="">请选择…</option>
                  {pickList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.table_name}（{t.db_type}）·{" "}
                      {[t.database_name, t.schema_name].filter(Boolean).join(".") ||
                        "无库名"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-app-muted">关系类型（选最贴近的一种即可）</label>
              <select
                value={relationType}
                onChange={(e) => setRelationType(e.target.value as TableRelationType)}
                className="w-full max-w-xl rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2.5"
              >
                {RELATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {selectedHint && (
                <p className="text-xs text-app-muted leading-relaxed">{selectedHint}</p>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-app-muted">
                  第一张表里的字段名（选填）
                </label>
                <input
                  value={fromCol}
                  onChange={(e) => setFromCol(e.target.value)}
                  placeholder="例如 user_id"
                  className="w-full rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2 placeholder:text-app-subtle"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-app-muted">
                  第二张表里的字段名（选填）
                </label>
                <input
                  value={toCol}
                  onChange={(e) => setToCol(e.target.value)}
                  placeholder="例如 user_id"
                  className="w-full rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2 placeholder:text-app-subtle"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-app-muted">给同事看的说明（选填）</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：下单用户与维度用户通过 user_id 对应"
                className="w-full rounded-lg border border-app-border bg-app-input text-app-text text-sm px-3 py-2 placeholder:text-app-subtle"
              />
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !fromId || !toId}
              className="px-4 py-2.5 rounded-lg bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium transition-colors"
            >
              {saving ? "保存中…" : "保存这条关系"}
            </button>
          </div>

          {/* 已有关系 — 卡片式「小图」 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-app-text">已保存的关系</h3>
              <button
                type="button"
                onClick={loadEdges}
                className="text-app-muted hover:text-app-text p-1"
                title="刷新"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {loadingEdges ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-app-accent" size={22} />
              </div>
            ) : edges.length === 0 ? (
              <p className="text-sm text-app-muted py-8 text-center border border-dashed border-app-border rounded-xl">
                还没有任何连线。在上方选两张表并保存即可。
              </p>
            ) : (
              <ul className="space-y-3">
                {edges.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl border border-app-border bg-app-surface p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 min-w-0">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span
                          className={cn(
                            "text-[10px] uppercase px-2 py-0.5 rounded border flex-shrink-0",
                            dbBadgeClass(e.from_db_type)
                          )}
                        >
                          {e.from_db_type}
                        </span>
                        <span className="font-mono text-sm text-app-text truncate">
                          {e.from_label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-app-muted flex-shrink-0 px-2">
                        <div className="hidden sm:block h-px w-6 bg-app-border" />
                        <span className="text-xs whitespace-nowrap text-app-accent">
                          {relationLabel(e.relation_type)}
                        </span>
                        <ArrowRight size={16} className="text-app-subtle" />
                        <div className="hidden sm:block h-px w-6 bg-app-border" />
                      </div>

                      <div className="flex items-start gap-2 min-w-0 flex-1 sm:justify-end">
                        <span
                          className={cn(
                            "text-[10px] uppercase px-2 py-0.5 rounded border flex-shrink-0",
                            dbBadgeClass(e.to_db_type)
                          )}
                        >
                          {e.to_db_type}
                        </span>
                        <span className="font-mono text-sm text-app-text truncate text-right sm:text-left">
                          {e.to_label}
                        </span>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 border-app-border pt-3 sm:pt-0 sm:pl-2">
                      <div className="text-xs text-app-muted text-left sm:text-right max-w-[200px]">
                        {(e.from_column || e.to_column) && (
                          <p>
                            字段：{e.from_column ?? "？"} → {e.to_column ?? "？"}
                          </p>
                        )}
                        {e.note && <p className="mt-1">{e.note}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(e.id)}
                        className="text-app-muted hover:text-red-400 p-2 rounded-lg hover:bg-app-input"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
