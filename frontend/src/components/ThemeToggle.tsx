"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "datepgv_theme";

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(true);

  useLayoutEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    applyDark(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      suppressHydrationWarning
      title={dark ? "切换为浅色" : "切换为深色"}
      aria-label={dark ? "切换为浅色" : "切换为深色"}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
