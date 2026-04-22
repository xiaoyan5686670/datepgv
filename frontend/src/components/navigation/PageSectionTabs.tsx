"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type TabItem<T extends string> = {
  key: T;
  label: string;
  shortLabel?: string;
  icon?: LucideIcon;
};

interface PageSectionTabsProps<T extends string> {
  items: Array<TabItem<T>>;
  active: T;
  onChange: (value: T) => void;
}

export function PageSectionTabs<T extends string>({ items, active, onChange }: PageSectionTabsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
              active === item.key
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon ? <Icon size={12} /> : null}
            <span className="hidden sm:inline">{item.label}</span>
            <span className="sm:hidden">{item.shortLabel ?? item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
