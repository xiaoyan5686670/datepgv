"use client";

import { ChevronDown, Database, Edit2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataScopeTabState } from "@/hooks/useDataScopeTab";

export function ProvinceAliasSection({ tab }: { tab: DataScopeTabState }) {
  const {
    provinceAliases,
    provinceAliasLoading,
    provinceAliasSaving,
    editingProvinceAliasId,
    setEditingProvinceAliasId,
    provinceAliasForm,
    setProvinceAliasForm,
    submitProvinceAlias,
    removeProvinceAlias,
    resetProvinceAliasEditor,
    aliasesExpanded,
    setAliasesExpanded,
  } = tab;

  return (
    <div className="relative overflow-hidden bg-app-surface border border-app-border rounded-2xl shadow-sm">
      <button
        type="button"
        onClick={() => setAliasesExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 p-5 text-left text-sm font-semibold text-app-text hover:bg-app-input/30 transition-colors rounded-2xl"
      >
        <span className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-500">
            <Database size={16} />
          </span>
          高级：省份别名
        </span>
        <ChevronDown
          size={18}
          className={cn("text-app-muted transition-transform", aliasesExpanded && "rotate-180")}
        />
      </button>
      {aliasesExpanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-app-border/60 pt-4">
          <p className="text-xs text-app-muted leading-relaxed">
            将用户输入或档案中的别名映射到策略里使用的标准省名（例如「广西壮族自治区」→「广西」）。
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => resetProvinceAliasEditor()}
              className="px-2 py-1 text-[10px] rounded-md border border-app-border text-app-subtle hover:text-app-text"
            >
              清空表单
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              value={provinceAliasForm.canonical_name}
              onChange={(e) =>
                setProvinceAliasForm((s) => ({ ...s, canonical_name: e.target.value }))
              }
              placeholder="标准名，如 广西"
              className="rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs"
            />
            <input
              value={provinceAliasForm.alias}
              onChange={(e) => setProvinceAliasForm((s) => ({ ...s, alias: e.target.value }))}
              placeholder="别名，如 广西壮族自治区"
              className="rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs"
            />
            <input
              type="number"
              value={provinceAliasForm.priority}
              onChange={(e) =>
                setProvinceAliasForm((s) => ({
                  ...s,
                  priority: Number(e.target.value || 100),
                }))
              }
              className="rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs"
              placeholder="优先级"
            />
            <label className="flex items-center gap-2 text-xs text-app-muted px-2">
              <input
                type="checkbox"
                checked={provinceAliasForm.enabled}
                onChange={(e) =>
                  setProvinceAliasForm((s) => ({ ...s, enabled: e.target.checked }))
                }
                className="rounded border-app-border"
              />
              启用
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitProvinceAlias()}
              disabled={provinceAliasSaving}
              className="px-4 py-2 rounded-xl bg-app-accent hover:bg-app-accent-hover text-white text-xs font-medium disabled:opacity-50"
            >
              {provinceAliasSaving ? "保存中…" : editingProvinceAliasId ? "更新别名" : "新增别名"}
            </button>
            {editingProvinceAliasId ? (
              <button
                type="button"
                onClick={() => resetProvinceAliasEditor()}
                className="px-3 py-2 rounded-xl border border-app-border text-xs"
              >
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-2 border border-app-border/60 rounded-xl p-2 bg-app-input/20">
            {provinceAliasLoading ? (
              <div className="py-6 text-center text-xs text-app-subtle">加载中…</div>
            ) : provinceAliases.length === 0 ? (
              <div className="py-6 text-center text-xs text-app-subtle">暂无省份别名</div>
            ) : (
              provinceAliases.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-app-border px-2 py-1.5 bg-app-surface/70"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-app-text font-medium truncate">
                      {a.alias} → {a.canonical_name}
                    </div>
                    <div className="text-[10px] text-app-subtle">
                      #{a.id} · 优先级 {a.priority} · {a.enabled ? "启用" : "停用"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="p-1.5 rounded-md hover:bg-app-input"
                      onClick={() => {
                        setEditingProvinceAliasId(a.id);
                        setProvinceAliasForm({
                          canonical_name: a.canonical_name,
                          alias: a.alias,
                          priority: a.priority,
                          enabled: a.enabled,
                        });
                      }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md hover:bg-red-500/10 text-app-subtle hover:text-red-500"
                      onClick={() => void removeProvinceAlias(a.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
