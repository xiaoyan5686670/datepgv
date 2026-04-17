"use client";

import { ChevronDown, Database, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { SqlType } from "@/types";

const DB_OPTIONS: Array<{ key: SqlType; label: string; color: string }> = [
  { key: "hive", label: "Hive", color: "bg-amber-500" },
  { key: "postgresql", label: "PostgreSQL", color: "bg-blue-500" },
  { key: "mysql", label: "MySQL", color: "bg-orange-500" },
  { key: "oracle", label: "Oracle", color: "bg-emerald-500" },
];

interface DatabaseSwitcherProps {
  value: SqlType;
  onChange: (value: SqlType) => void;
  className?: string;
}

export function DatabaseSwitcher({ value, onChange, className }: DatabaseSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const active = DB_OPTIONS.find((opt) => opt.key === value) || DB_OPTIONS[2];

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border shadow-sm",
          "bg-background hover:bg-accent text-muted-foreground hover:text-foreground",
          open && "ring-2 ring-primary/20 border-primary/40"
        )}
      >
        <div className={cn("w-2 h-2 rounded-full", active.color)} />
        <Database size={13} className="shrink-0 text-muted-foreground/70" />
        <span className="truncate max-w-[80px] sm:max-w-[120px]">{active.label}</span>
        <ChevronDown size={12} className={cn("transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border bg-popover shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-3 py-2 border-b bg-muted/30">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">选择目标库</span>
          </div>
          <div className="p-1">
            {DB_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs transition-all",
                  value === opt.key 
                    ? "bg-primary/10 text-primary font-bold" 
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 shadow-sm", opt.color)} />
                <span className="flex-1 text-left">{opt.label}</span>
                {value === opt.key && <Check size={13} className="text-primary animate-in zoom-in duration-200" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
