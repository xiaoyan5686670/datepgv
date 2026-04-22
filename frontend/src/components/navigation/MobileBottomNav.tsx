"use client";

import type { LucideIcon } from "lucide-react";
import { Database, Settings, Table, Users } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type NavKey = "home" | "users" | "admin" | "settings";

const NAV_ITEMS: Array<{ key: NavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: "home", href: "/", label: "首页", icon: Database },
  { key: "users", href: "/users", label: "用户", icon: Users },
  { key: "admin", href: "/admin", label: "管理", icon: Table },
  { key: "settings", href: "/settings", label: "设置", icon: Settings },
];

export function MobileBottomNav({ activeKey }: { activeKey: NavKey }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;
  const visibleItems = NAV_ITEMS.filter((item) => item.key === "home" || item.key === "users" || isAdmin);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                activeKey === item.key ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
