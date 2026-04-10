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

const BADGE_CLASS: Record<string, string> = {
  admin:              "bg-red-50     dark:bg-red-900/30     text-red-600    dark:text-red-400    ring-red-200/60    dark:ring-red-700/40",
  region_executive:   "bg-violet-50  dark:bg-violet-900/30  text-violet-600 dark:text-violet-400 ring-violet-200/60 dark:ring-violet-700/40",
  province_executive: "bg-indigo-50  dark:bg-indigo-900/30  text-indigo-600 dark:text-indigo-400 ring-indigo-200/60 dark:ring-indigo-700/40",
  province_manager:   "bg-blue-50    dark:bg-blue-900/30    text-blue-600   dark:text-blue-400   ring-blue-200/60   dark:ring-blue-700/40",
  area_executive:     "bg-sky-50     dark:bg-sky-900/30     text-sky-600    dark:text-sky-400    ring-sky-200/60    dark:ring-sky-700/40",
  area_manager:       "bg-teal-50    dark:bg-teal-900/30    text-teal-600   dark:text-teal-400   ring-teal-200/60   dark:ring-teal-700/40",
  staff:              "bg-gray-50    dark:bg-gray-800/60    text-gray-500   dark:text-gray-400   ring-gray-200/60   dark:ring-gray-600/40",
};

export function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const level  = user.employee_level ?? "staff";
  const label  = LEVEL_LABEL[level] ?? level;
  const avatar = AVATAR_CLASS[level] ?? AVATAR_CLASS.staff;
  const badge  = BADGE_CLASS[level]  ?? BADGE_CLASS.staff;

  // 显示名：优先 full_name，退回 username
  const displayName = user.full_name?.trim() || user.username;
  // avatar 首字：中文取第一字，英文取首字母大写
  const avatarChar  = displayName[0] ?? "U";

  return (
    <div className="flex items-center gap-2.5">
      {/* 桌面端：姓名 + 职位 */}
      <div className="hidden sm:flex flex-col items-end gap-0.5">
        <span
          className="text-sm font-semibold leading-tight max-w-[120px] truncate"
          title={displayName}
        >
          {displayName}
        </span>
        <span
          className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 leading-none ${badge}`}
        >
          {label}
        </span>
      </div>

      {/* 头像 */}
      <div
        className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-sm select-none shrink-0 ${avatar}`}
        title={`${displayName}（${label}）`}
      >
        {avatarChar}
      </div>

      {/* 退出按钮——桌面端悬浮显示，移动端常显 */}
      <button
        onClick={() => logout()}
        className="p-2 rounded-lg border bg-background hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
        aria-label="退出登录"
        title="退出登录"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
