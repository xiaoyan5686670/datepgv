"use client";

import { LogOut, MapPin, Shield } from "lucide-react";
import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { uploadAvatar } from "@/lib/api";

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

/** 格式化显示组织与职级 */
function OrgBadges({ user, label, avatarClass }: { 
  user: { org_region?: string | null; province?: string | null };
  label: string;
  avatarClass: string;
}) {
  const region = user.org_region?.trim();
  const province = user.province?.trim();
  const location = [region, province].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 mt-0.5">
      {location && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 text-[10px] font-medium text-muted-foreground border border-border/40">
          <MapPin size={10} className="text-muted-foreground/70" />
          {location}
        </span>
      )}
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold shadow-sm ${avatarClass.replace(/bg-\w+-100|dark:bg-\w+-900\/40|w-9|h-9|rounded-full|flex|items-center|justify-center|font-bold|text-sm|select-none|shrink-0|border-2/g, '').trim()}`}>
        <Shield size={10} className="opacity-70" />
        {label}
      </span>
    </div>
  );
}

export function UserChip() {
  const { user, logout, refreshUser } = useAuth();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const level = user.employee_level ?? "staff";
  const label = LEVEL_LABEL[level] ?? level;
  const avatar = AVATAR_CLASS[level] ?? AVATAR_CLASS.staff;

  const displayName = user.full_name?.trim() || user.username;
  const avatarChar = displayName[0]?.toUpperCase() ?? "U";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadAvatar(file);
      await refreshUser();
    } catch {
      // silent — could add toast here
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end min-w-0">
        <span
          className="text-sm font-bold text-foreground leading-tight truncate max-w-[150px]"
          title={displayName}
        >
          {displayName}
        </span>
        <OrgBadges user={user} label={label} avatarClass={avatar} />
      </div>

      <button
        type="button"
        title="点击更换头像"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className={`relative w-9 h-9 rounded-xl border-2 flex items-center justify-center font-bold text-sm select-none shrink-0 shadow-sm transition-all hover:scale-105 hover:brightness-90 overflow-hidden ${user.avatar_data ? "border-border bg-white p-0" : avatar}`}
      >
        {uploading ? (
          <span className="text-[10px]">…</span>
        ) : user.avatar_data ? (
          <img src={user.avatar_data} alt="avatar" className="w-full h-full object-cover" />
        ) : (
          avatarChar
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="h-8 w-px bg-border mx-1 hidden sm:block" />

      <button
        onClick={() => logout()}
        className="p-2 rounded-xl border border-border bg-background hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all group"
        aria-label="退出登录"
        title="退出登录"
      >
        <LogOut size={15} className="group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}
