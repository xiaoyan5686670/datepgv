"use client";

import { Check, ChevronDown, Cpu, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  activateLLMModel,
  fetchLLMModels,
  type LLMModelOption,
} from "@/lib/api";

export function ModelSwitcher() {
  const [models, setModels] = useState<LLMModelOption[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setModels(await fetchLLMModels());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const active = models.find((m) => m.is_active);

  const handleSwitch = async (id: number) => {
    if (switching) return;
    setSwitching(id);
    try {
      await activateLLMModel(id);
      setModels((prev) =>
        prev.map((m) => ({ ...m, is_active: m.id === id }))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "切换失败");
    } finally {
      setSwitching(null);
      setOpen(false);
    }
  };

  if (models.length === 0) return null;

  const displayName = active
    ? active.name
    : "未配置模型";

  const displayModel = active?.model ?? "";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border shadow-sm",
          "bg-background hover:bg-accent text-muted-foreground hover:text-foreground",
          open && "ring-2 ring-primary/20 border-primary/40"
        )}
      >
        <Cpu size={13} className="text-primary shrink-0" />
        <span className="max-w-[120px] truncate">{displayName}</span>
        <ChevronDown
          size={12}
          className={cn(
            "transition-transform duration-200 shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border bg-popover shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2.5 border-b">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              LLM 模型
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={!!switching}
                onClick={() => {
                  if (!m.is_active) handleSwitch(m.id);
                  else setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  m.is_active
                    ? "bg-primary/5"
                    : "hover:bg-accent/60",
                  switching === m.id && "opacity-60"
                )}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold border",
                    m.is_active
                      ? "bg-primary text-primary-foreground border-primary/30"
                      : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {switching === m.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : m.is_active ? (
                    <Check size={13} />
                  ) : (
                    <Cpu size={13} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-sm font-medium truncate",
                    m.is_active ? "text-primary" : "text-foreground"
                  )}>
                    {m.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {m.model}
                  </div>
                </div>
                {m.is_active && (
                  <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                    当前
                  </span>
                )}
              </button>
            ))}
          </div>
          {active && displayModel && (
            <div className="px-4 py-2 border-t">
              <div className="text-[10px] text-muted-foreground truncate">
                当前模型: <span className="font-mono">{displayModel}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
