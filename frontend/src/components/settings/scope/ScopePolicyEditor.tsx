"use client";

import { Loader2, Save, Shield, XCircle } from "lucide-react";
import {
  DIMENSION_LABELS,
  MERGE_MODE_LABELS,
  SUBJECT_TYPE_LABELS,
} from "@/lib/dataScopeLabels";
import { cn } from "@/lib/utils";
import type { DataScopeTabState } from "@/hooks/useDataScopeTab";
import type { DataScopePolicy } from "@/types";

type EditorVariant = "card" | "modal";

export function ScopePolicyEditor({
  tab,
  variant = "card",
}: {
  tab: DataScopeTabState;
  variant?: EditorVariant;
}) {
  const { editingPolicyId, scopeForm, setScopeForm, scopeSaving, savePolicy, closeEditor } =
    tab;
  const title = editingPolicyId ? "编辑数据范围策略" : "新增数据范围策略";
  return (
    <div
      className={cn(
        "relative space-y-5",
        variant === "modal"
          ? "p-5 pb-6"
          : "overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 shadow-md"
      )}
    >
      <div className="sticky top-0 z-[1] -mx-5 -mt-5 mb-0 flex items-center justify-between gap-2 border-b border-app-border bg-app-surface px-5 py-3 text-sm font-semibold text-app-text">
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 rounded-lg bg-emerald-500/10 p-1.5 text-emerald-500">
            <Shield size={16} />
          </div>
          <span id="scope-policy-editor-title" className="truncate">
            {title}
          </span>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-app-subtle transition-colors hover:bg-app-input hover:text-app-text"
          onClick={closeEditor}
        >
          <XCircle size={18} />
        </button>
      </div>

      <section className="space-y-3 pt-1">
        <h4 className="text-xs font-semibold text-app-text">1. 谁适用这条策略</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">主体类型</label>
            <select
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none"
              value={scopeForm.subject_type}
              onChange={(e) =>
                setScopeForm((s) => ({
                  ...s,
                  subject_type: e.target.value as DataScopePolicy["subject_type"],
                }))
              }
            >
              {(Object.keys(SUBJECT_TYPE_LABELS) as DataScopePolicy["subject_type"][]).map(
                (k) => (
                  <option key={k} value={k}>
                    {SUBJECT_TYPE_LABELS[k].optionLabel}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">主体标识</label>
            <input
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs font-mono focus:border-app-accent/50 focus:outline-none"
              placeholder="如职级编码、角色名、用户 id 或工号"
              value={scopeForm.subject_key}
              onChange={(e) => setScopeForm((s) => ({ ...s, subject_key: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-app-text">2. 限制哪个维度</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">数据维度</label>
            <select
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs focus:border-app-accent/50 focus:outline-none"
              value={scopeForm.dimension}
              onChange={(e) =>
                setScopeForm((s) => ({
                  ...s,
                  dimension: e.target.value as DataScopePolicy["dimension"],
                }))
              }
            >
              {(Object.keys(DIMENSION_LABELS) as DataScopePolicy["dimension"][]).map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABELS[d].short} — {DIMENSION_LABELS[d].description}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">合并方式</label>
            <select
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs focus:border-app-accent/50 focus:outline-none"
              value={scopeForm.merge_mode}
              onChange={(e) =>
                setScopeForm((s) => ({
                  ...s,
                  merge_mode: e.target.value as DataScopePolicy["merge_mode"],
                }))
              }
            >
              {(Object.keys(MERGE_MODE_LABELS) as DataScopePolicy["merge_mode"][]).map((m) => (
                <option key={m} value={m}>
                  {MERGE_MODE_LABELS[m].short} — {MERGE_MODE_LABELS[m].detail}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-app-text">3. 允许与拒绝的值</h4>
        <p className="text-[11px] text-app-muted">多个值用英文逗号分隔，例如：广西,广东</p>
        <div className="space-y-1.5">
          <label className="text-xs text-green-600 dark:text-green-400 ml-0.5">允许（白名单）</label>
          <input
            className="w-full rounded-xl bg-green-500/5 border border-green-500/20 px-3 py-2.5 text-xs focus:border-green-500/50 focus:ring-2 focus:ring-green-500/20 focus:outline-none"
            placeholder="例如：广东, 广西"
            value={scopeForm.allowed_values}
            onChange={(e) => setScopeForm((s) => ({ ...s, allowed_values: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-red-500 ml-0.5">拒绝（黑名单）</label>
          <input
            className="w-full rounded-xl bg-red-500/5 border border-red-500/20 px-3 py-2.5 text-xs focus:border-red-500/50 focus:outline-none"
            placeholder="例如：北京"
            value={scopeForm.deny_values}
            onChange={(e) => setScopeForm((s) => ({ ...s, deny_values: e.target.value }))}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-app-text">4. 优先级与备注</h4>
        <p className="text-[11px] text-app-muted">
          数字越小越先参与合并；同维度多条策略按优先级顺序依次应用。
        </p>
        <div className="grid grid-cols-[88px_1fr] gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">优先级</label>
            <input
              type="number"
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs text-center font-mono focus:border-app-accent/50 focus:outline-none"
              value={scopeForm.priority}
              onChange={(e) =>
                setScopeForm((s) => ({ ...s, priority: Number(e.target.value || 0) }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-app-muted ml-0.5">备注</label>
            <input
              className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs focus:border-app-accent/50 focus:outline-none"
              placeholder="可选，便于同事理解"
              value={scopeForm.note}
              onChange={(e) => setScopeForm((s) => ({ ...s, note: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between pt-4 mt-2 border-t border-app-border flex-wrap gap-3">
        <label className="flex items-center gap-3 cursor-pointer group">
          <div
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors duration-300",
              scopeForm.enabled ? "bg-green-500" : "bg-app-border"
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform duration-300 shadow",
                scopeForm.enabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </div>
          <input
            type="checkbox"
            className="hidden"
            checked={scopeForm.enabled}
            onChange={(e) => setScopeForm((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span
            className={cn(
              "text-xs font-semibold",
              scopeForm.enabled ? "text-app-text" : "text-app-muted group-hover:text-app-text"
            )}
          >
            {scopeForm.enabled ? "策略已启用" : "策略已停用"}
          </span>
        </label>
        <button
          type="button"
          onClick={() => void savePolicy()}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-app-accent hover:bg-app-accent-hover text-white text-xs font-semibold disabled:opacity-50"
          disabled={scopeSaving}
        >
          {scopeSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {editingPolicyId ? "保存修改" : "保存新建"}
        </button>
      </div>
    </div>
  );
}
