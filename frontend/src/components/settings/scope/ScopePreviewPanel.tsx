"use client";

import { ChevronDown, Users } from "lucide-react";
import { useState } from "react";
import type { DataScopeTabState } from "@/hooks/useDataScopeTab";

export function ScopePreviewPanel({ tab }: { tab: DataScopeTabState }) {
  const {
    scopePreviewLoading,
    scopePreview,
    scopePreviewErr,
    runScopePreview,
    ragUsers,
    ragUserId,
    setRagUserId,
    ragUserFilter,
    setRagUserFilter,
    ragUsersFiltered,
    ragLookupUsername,
    setRagLookupUsername,
    ragLookupFullName,
    setRagLookupFullName,
    ragResolvedDisplay,
    setRagResolvedDisplay,
    ragLookupLoading,
    handleLookupUserByName,
  } = tab;

  const [techOpen, setTechOpen] = useState(false);

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-app-surface to-app-surface/40 border border-app-border/80 backdrop-blur-xl rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-app-text">
        <div className="p-1.5 rounded-lg bg-app-accent/10 text-app-accent">
          <Users size={16} />
        </div>
        按用户预览数据范围
      </div>
      <p className="text-xs text-app-muted leading-relaxed">
        选择或查找用户后点击「预览」，查看 NL→SQL 解析时合并后的省份 / 员工 / 区域 / 片区取值（与{" "}
        <span className="text-app-text">RAG 文档权限</span> 无关）。
      </p>

      {scopePreviewErr && (
        <div className="text-sm text-red-500 border border-red-500/30 rounded-lg px-3 py-2">{scopePreviewErr}</div>
      )}

      <div className="space-y-3">
        <p className="text-xs text-app-muted">下拉最多加载 200 个用户；其他人请用工号/姓名精确查找。</p>
        <div className="flex flex-col gap-1 min-w-0">
          <label className="text-xs text-app-muted">筛选列表（工号、姓名片段）</label>
          <input
            type="search"
            className="rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm"
            placeholder="输入关键字缩小列表…"
            value={ragUserFilter}
            onChange={(e) => setRagUserFilter(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="rounded-xl border border-app-border bg-app-surface/50 p-4 space-y-3">
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
            disabled={ragLookupLoading}
            onClick={() => void handleLookupUserByName()}
            className="text-sm px-4 py-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/40 disabled:opacity-50"
          >
            {ragLookupLoading ? "查找中…" : "查找用户"}
          </button>
          {ragResolvedDisplay && (
            <p className="text-xs text-app-muted">
              当前选中：<span className="text-app-text">{ragResolvedDisplay}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[min(100%,280px)] flex-1">
            <label className="text-xs text-app-muted">从列表选择</label>
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
                  <option value={ragUserId}>{ragResolvedDisplay}（未在下列表中）</option>
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
            disabled={scopePreviewLoading}
            onClick={() => void runScopePreview()}
            className="text-sm px-4 py-2 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover disabled:opacity-50"
          >
            {scopePreviewLoading ? "预览中…" : "预览数据范围"}
          </button>
        </div>
      </div>

      {scopePreview && (
        <div className="relative z-10 space-y-3 text-sm">
          {scopePreview.unrestricted ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm font-medium">
                该用户为「不限数据范围」（unrestricted），NL→SQL 不按策略表限制维度取值。
              </div>
              <p className="text-xs text-app-muted">
                用户：{scopePreview.username} · ID {scopePreview.user_id}
              </p>
            </div>
          ) : null}

          {!scopePreview.unrestricted && (
            <div className="p-4 rounded-xl bg-app-input/50 border border-app-border/60 space-y-3 text-[11px] leading-relaxed">
              <div className="flex justify-between items-center border-b border-app-border/40 pb-2">
                <span className="text-app-text font-semibold text-sm">{scopePreview.username}</span>
                <span className="text-app-subtle bg-app-border/50 px-2 py-0.5 rounded-md font-mono">
                  ID: {scopePreview.user_id}
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-2 text-app-muted items-start">
                <span className="text-app-subtle text-[10px] uppercase pt-0.5">省份</span>
                <div className="flex flex-wrap gap-1">
                  {scopePreview.province_values.map((v, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text"
                    >
                      {v}
                    </span>
                  ))}
                  {scopePreview.province_values.length === 0 && (
                    <span className="text-app-subtle/70">无</span>
                  )}
                </div>
                <span className="text-app-subtle text-[10px] uppercase pt-0.5">员工</span>
                <div className="flex flex-wrap gap-1">
                  {scopePreview.employee_values.map((v, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text"
                    >
                      {v}
                    </span>
                  ))}
                  {scopePreview.employee_values.length === 0 && (
                    <span className="text-app-subtle/70">无</span>
                  )}
                </div>
                <span className="text-app-subtle text-[10px] uppercase pt-0.5">区域</span>
                <div className="flex flex-wrap gap-1">
                  {scopePreview.region_values.map((v, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text"
                    >
                      {v}
                    </span>
                  ))}
                  {scopePreview.region_values.length === 0 && (
                    <span className="text-app-subtle/70">无</span>
                  )}
                </div>
                <span className="text-app-subtle text-[10px] uppercase pt-0.5">片区</span>
                <div className="flex flex-wrap gap-1">
                  {scopePreview.district_values.map((v, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text"
                    >
                      {v}
                    </span>
                  ))}
                  {scopePreview.district_values.length === 0 && (
                    <span className="text-app-subtle/70">无</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setTechOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text"
          >
            <ChevronDown
              size={14}
              className={techOpen ? "rotate-180 transition-transform" : "transition-transform"}
            />
            技术细节（来源与策略 ID）
          </button>
          {techOpen && (
            <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-[11px] font-mono text-app-muted p-3 rounded-lg bg-app-input/40 border border-app-border/60">
              <span className="text-app-subtle">source</span>
              <span className="text-app-accent">{scopePreview.source}</span>
              <span className="text-app-subtle">policy_ids</span>
              <span>[{scopePreview.policy_ids.join(", ")}]</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
