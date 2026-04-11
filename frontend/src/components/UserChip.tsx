"use client";

import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const LEVEL_LABEL: Record<string, string> = {
  admin:              "管理员",
  region_executive:   "大区总",
  province_executive: "省总",
  province_manager:   "省区经理",
  area_executive:     "区域总",
  area_manager:       "区域经理",
  staff:              "业务经理",
};

// avatar 背景 + 文字色（按职级）
const AVATAR_CLASS: Record<string, string> = {
  admin:              "bg-red-100     dark:bg-red-900/40     text-red-700    dark:text-red-300    border-red-200    dark:border-red-700/50",
  region_executive:   "bg-violet-100  dark:bg-violet-900/40  text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700/50",
  province_executive: "bg-indigo-100  dark:bg-indigo-900/40  text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/50",
  province_manager:   "bg-blue-100    dark:bg-blue-900/40    text-blue-700   dark:text-blue-300   border-blue-200   dark:border-blue-700/50",
  area_executive:     "bg-sky-100     dark:bg-sky-900/40     text-sky-700    dark:text-sky-300    border-sky-200    dark:border-sky-700/50",
  area_manager:       "bg-teal-100    dark:bg-teal-900/40    text-teal-700   dark:text-teal-300   border-teal-200   dark:border-teal-700/50",
  staff:              "bg-gray-100    dark:bg-gray-800       text-gray-600   dark:text-gray-300   border-gray-200   dark:border-gray-600/50",
};

function trimOrDash(value: string | null | undefined): string {
  const t = typeof value === "string" ? value.trim() : "";
  return t || "—";
}

/** 大区，省，职位（纯文案，不含市/区县） */
function buildOrgMetaLine(user: {
  org_region?: string | null;
  province?: string | null;
}, roleLabel: string): string {
  return `${trimOrDash(user.org_region)}，${trimOrDash(user.province)}，${roleLabel}`;
}

export function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const level = user.employee_level ?? "staff";
  const label = LEVEL_LABEL[level] ?? level;
  const avatar = AVATAR_CLASS[level] ?? AVATAR_CLASS.staff;

  const displayName = user.full_name?.trim() || user.username;
  const avatarChar = displayName[0] ?? "U";
  const metaLine = buildOrgMetaLine(user, label);
  const chipTitle = `${displayName} · ${metaLine}`;

  return (
    <div className="flex items-center gap-2 sm:gap-2.5" title={chipTitle}>
      <div className="flex flex-col items-end gap-0.5 sm:gap-1 min-w-0 max-w-[calc(100vw-11rem)] sm:max-w-[min(240px,32vw)]">
        <span
          className="text-xs sm:text-sm font-semibold text-app-text leading-tight truncate max-w-full text-right"
          title={displayName}
        >
          {displayName}
        </span>
        <span
          className="inline-block max-w-full min-w-0 rounded-full border border-app-border bg-app-surface/90 px-2.5 py-1 sm:px-3 sm:py-1 text-[10px] sm:text-xs text-app-text-secondary leading-snug text-right tracking-wide whitespace-nowrap truncate shadow-sm"
          title={metaLine}
        >
          {metaLine}
        </span>
      </div>

      <div
        className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-sm select-none shrink-0 ${avatar}`}
        title={chipTitle}
      >
        {avatarChar}
      </div>

      <button
        onClick={() => logout()}
        className="p-2 rounded-lg border border-app-border bg-app-surface/80 hover:bg-red-500/10 text-app-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
        aria-label="退出登录"
        title="退出登录"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
