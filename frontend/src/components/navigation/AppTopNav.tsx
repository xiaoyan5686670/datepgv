"use client";

import { Database, Settings, Table, Users } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserChip } from "@/components/UserChip";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type NavKey = "home" | "users" | "admin" | "settings";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

const NAV_ITEMS: Array<{ key: NavKey; href: string; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "home", href: "/", label: "首页", icon: Database },
  { key: "users", href: "/users", label: "用户", icon: Users },
  { key: "admin", href: "/admin", label: "管理", icon: Table },
  { key: "settings", href: "/settings", label: "设置", icon: Settings },
];

interface AppTopNavProps {
  activeKey: NavKey;
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  rightActions?: React.ReactNode;
}

export function AppTopNav({ activeKey, title, subtitle, breadcrumbs, rightActions }: AppTopNavProps) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("admin") ?? false;
  const visibleItems = NAV_ITEMS.filter((item) => item.key === "home" || item.key === "users" || isAdmin);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight">{title}</h1>
              {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
            </div>
            {breadcrumbs && breadcrumbs.length > 0 ? (
              <nav className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {breadcrumbs.map((item, idx) => (
                  <span key={`${item.label}-${idx}`} className="flex items-center gap-1">
                    {idx > 0 ? <span>/</span> : null}
                    {item.href ? (
                      <Link href={item.href} className="hover:text-foreground transition-colors">
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-foreground">{item.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {rightActions}
            <div className="h-6 w-px bg-border/60 mx-1 hidden sm:block" />
            <ThemeToggle className="p-2 rounded-xl border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-all shadow-sm" />
            <UserChip />
          </div>
        </div>

        <nav className="mt-3 hidden sm:flex items-center gap-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-all",
                  activeKey === item.key
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-accent"
                )}
              >
                <Icon size={13} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
