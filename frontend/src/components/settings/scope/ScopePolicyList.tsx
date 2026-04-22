"use client";

import { ChevronDown, ChevronRight, Edit2, Loader2, Plus, Search, Shield, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  DIMENSION_LABELS,
  MERGE_MODE_LABELS,
  SUBJECT_TYPE_LABELS,
  summarizeValuesList,
} from "@/lib/dataScopeLabels";
import { cn } from "@/lib/utils";
import type { DataScopeTabState } from "@/hooks/useDataScopeTab";
import type { DataScopePolicy } from "@/types";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

export function ScopePolicyList({ tab }: { tab: DataScopeTabState }) {
  const {
    scopeLoading,
    scopeQuery,
    setScopeQuery,
    scopeDimensionFilter,
    setScopeDimensionFilter,
    scopeSubjectFilter,
    setScopeSubjectFilter,
    scopeEnabledFilter,
    setScopeEnabledFilter,
    filteredSortedScopePolicies,
    selectedPolicyIds,
    setSelectedPolicyIds,
    allFilteredSelected,
    toggleSelectFiltered,
    applyBulkEnabled,
    scopeBulkLoading,
    openNewPolicy,
    openEditPolicy,
    deletePolicy,
  } = tab;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setPage(1);
  }, [scopeQuery, scopeDimensionFilter, scopeSubjectFilter, scopeEnabledFilter]);

  const total = filteredSortedScopePolicies.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSortedScopePolicies.slice(start, start + pageSize);
  }, [filteredSortedScopePolicies, page, pageSize]);

  const pageFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageTo = Math.min(page * pageSize, total);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dimClass = (d: DataScopePolicy["dimension"]) =>
    d === "province"
      ? "text-sky-600 dark:text-sky-400"
      : d === "employee"
        ? "text-emerald-600 dark:text-emerald-400"
        : d === "region"
          ? "text-indigo-600 dark:text-indigo-400"
          : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-app-border bg-app-surface p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 group">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-subtle group-focus-within:text-app-accent"
            />
            <input
              value={scopeQuery}
              onChange={(e) => setScopeQuery(e.target.value)}
              placeholder="搜索主体、备注、允许或拒绝…"
              className="w-full rounded-lg border border-app-border bg-app-input py-2 pl-8 pr-3 text-xs text-app-text placeholder:text-app-subtle focus:border-app-accent/50 focus:outline-none focus:ring-1 focus:ring-app-accent/30"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs text-app-text focus:border-app-accent/50 focus:outline-none max-w-[120px]"
              value={scopeDimensionFilter}
              onChange={(e) =>
                setScopeDimensionFilter(e.target.value as "all" | DataScopePolicy["dimension"])
              }
            >
              <option value="all">全部维度</option>
              {(Object.keys(DIMENSION_LABELS) as DataScopePolicy["dimension"][]).map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABELS[d].short}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs text-app-text focus:border-app-accent/50 focus:outline-none max-w-[130px]"
              value={scopeSubjectFilter}
              onChange={(e) =>
                setScopeSubjectFilter(e.target.value as "all" | DataScopePolicy["subject_type"])
              }
            >
              <option value="all">全部主体</option>
              {(Object.keys(SUBJECT_TYPE_LABELS) as DataScopePolicy["subject_type"][]).map((s) => (
                <option key={s} value={s}>
                  {SUBJECT_TYPE_LABELS[s].short}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-app-border bg-app-input px-2 py-1.5 text-xs text-app-text focus:border-app-accent/50 focus:outline-none"
              value={scopeEnabledFilter}
              onChange={(e) =>
                setScopeEnabledFilter(e.target.value as "all" | "enabled" | "disabled")
              }
            >
              <option value="all">全部状态</option>
              <option value="enabled">仅启用</option>
              <option value="disabled">仅停用</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-app-border/70 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openNewPolicy}
              className="inline-flex items-center gap-1 rounded-lg bg-app-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-app-accent-hover"
            >
              <Plus size={13} />
              新增策略
            </button>
            <button
              type="button"
              onClick={toggleSelectFiltered}
              className="rounded-lg border border-app-border px-2.5 py-1.5 text-xs text-app-muted hover:bg-app-input hover:text-app-text"
            >
              {allFilteredSelected ? "取消全选（筛选项）" : "全选筛选项"}
            </button>
            <button
              type="button"
              disabled={!selectedPolicyIds.length || scopeBulkLoading}
              onClick={() => applyBulkEnabled(true)}
              className="rounded-lg border border-green-500/35 px-2.5 py-1.5 text-xs text-green-600 hover:bg-green-500/10 disabled:opacity-40 dark:text-green-400"
            >
              批量启用{selectedPolicyIds.length ? ` (${selectedPolicyIds.length})` : ""}
            </button>
            <button
              type="button"
              disabled={!selectedPolicyIds.length || scopeBulkLoading}
              onClick={() => applyBulkEnabled(false)}
              className="rounded-lg border border-red-500/35 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
            >
              批量停用{selectedPolicyIds.length ? ` (${selectedPolicyIds.length})` : ""}
            </button>
          </div>
          <p className="text-[11px] text-app-subtle">
            共 {total} 条 · 勾选适用于批量操作（「全选筛选项」含所有匹配行，可跨页）
          </p>
        </div>
      </div>

      {scopeLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-app-accent" />
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-app-border py-16 text-app-subtle">
          <Shield size={28} className="mb-2 opacity-30" />
          <p className="text-sm">未找到匹配的策略</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-app-border bg-app-input/40 text-[11px] uppercase tracking-wide text-app-subtle">
                  <th className="w-10 px-2 py-2.5">
                    <span className="sr-only">选择</span>
                  </th>
                  <th className="w-8 px-0 py-2.5" />
                  <th className="px-2 py-2.5 font-medium">优先级</th>
                  <th className="px-2 py-2.5 font-medium">主体</th>
                  <th className="px-2 py-2.5 font-medium">维度</th>
                  <th className="px-2 py-2.5 font-medium">合并</th>
                  <th className="px-2 py-2.5 font-medium">状态</th>
                  <th className="min-w-[140px] px-2 py-2.5 font-medium">允许 / 拒绝</th>
                  <th className="w-24 px-2 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const selected = selectedPolicyIds.includes(p.id);
                  const expanded = expandedIds.has(p.id);
                  const allowS = summarizeValuesList(p.allowed_values, 2);
                  const denyS = summarizeValuesList(p.deny_values, 2);
                  const cellTitle = [
                    p.allowed_values.length ? `允许：${allowS.full}` : "",
                    p.deny_values.length ? `拒绝：${denyS.full}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n");

                  return (
                    <Fragment key={p.id}>
                      <tr
                        className={cn(
                          "border-b border-app-border/80 transition-colors",
                          p.enabled ? "hover:bg-app-input/25" : "opacity-70 hover:bg-app-input/15"
                        )}
                      >
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) =>
                              setSelectedPolicyIds((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, p.id])]
                                  : prev.filter((id) => id !== p.id)
                              )
                            }
                            className="rounded border-app-border text-app-accent"
                          />
                        </td>
                        <td className="px-0 py-2 align-middle">
                          <button
                            type="button"
                            onClick={() => toggleExpand(p.id)}
                            className="p-1 text-app-muted hover:text-app-text"
                            title={expanded ? "收起详情" : "展开详情"}
                          >
                            {expanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </button>
                        </td>
                        <td className="px-2 py-2 font-mono text-app-text tabular-nums">
                          {p.priority}
                        </td>
                        <td className="max-w-[200px] px-2 py-2">
                          <div className="truncate font-medium text-app-text" title={p.subject_key}>
                            <span className="text-app-subtle">
                              {SUBJECT_TYPE_LABELS[p.subject_type]?.short ?? p.subject_type} ·{" "}
                            </span>
                            {p.subject_key}
                          </div>
                        </td>
                        <td className={cn("px-2 py-2 font-medium", dimClass(p.dimension))}>
                          {DIMENSION_LABELS[p.dimension]?.short ?? p.dimension}
                        </td>
                        <td className="px-2 py-2 text-app-muted">
                          {MERGE_MODE_LABELS[p.merge_mode]?.short ?? p.merge_mode}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                              p.enabled
                                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                                : "bg-app-border/60 text-app-subtle"
                            )}
                          >
                            {p.enabled ? "启用" : "停用"}
                          </span>
                        </td>
                        <td
                          className="max-w-[220px] px-2 py-2 align-top text-[11px] leading-snug text-app-muted"
                          title={cellTitle || undefined}
                        >
                          <div className="line-clamp-2">
                            <span className="text-green-700/90 dark:text-green-400/90">允</span>{" "}
                            {allowS.display}
                            <span className="mx-1 text-app-border">|</span>
                            <span className="text-red-700/90 dark:text-red-400/90">拒</span>{" "}
                            {denyS.display}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right align-middle">
                          <button
                            type="button"
                            onClick={() => openEditPolicy(p)}
                            className="mr-1 inline-flex rounded p-1.5 text-app-muted hover:bg-app-input hover:text-app-accent"
                            title="编辑"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePolicy(p.id)}
                            className="inline-flex rounded p-1.5 text-app-muted hover:bg-red-500/10 hover:text-red-500"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-app-input/20">
                          <td colSpan={9} className="px-4 py-3 text-[11px] text-app-muted">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <span className="font-medium text-app-text">允许</span>
                                <p className="mt-1 break-words text-app-text">
                                  {p.allowed_values.length ? p.allowed_values.join("，") : "—"}
                                </p>
                              </div>
                              <div>
                                <span className="font-medium text-app-text">拒绝</span>
                                <p className="mt-1 break-words text-app-text">
                                  {p.deny_values.length ? p.deny_values.join("，") : "—"}
                                </p>
                              </div>
                              {p.note ? (
                                <div className="sm:col-span-2">
                                  <span className="font-medium text-app-text">备注</span>
                                  <p className="mt-1 text-app-text">{p.note}</p>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-stretch justify-between gap-3 border-t border-app-border/60 pt-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2 text-xs text-app-subtle">
              <span>
                第 {pageFrom}–{pageTo} 条，共 {total} 条
              </span>
              <label className="inline-flex items-center gap-1.5">
                <span>每页</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded border border-app-border bg-app-input px-2 py-1 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-app-input"
              >
                上一页
              </button>
              <span className="text-xs text-app-muted">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-app-input"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
