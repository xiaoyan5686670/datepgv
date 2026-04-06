"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, FileText, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { ThemeToggle } from "@/components/ThemeToggle";

type TabKey = "install" | "guide";

interface DocsClientProps {
  installSource: string;
  guideSource: string;
}

export function DocsClient({ installSource, guideSource }: DocsClientProps) {
  const [tab, setTab] = useState<TabKey>("install");

  const currentSource = tab === "install" ? installSource : guideSource;

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <header className="flex items-center justify-between px-6 py-3 border-b border-app-border bg-app-input">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center">
            <Database size={16} className="text-app-accent" />
          </div>
          <span className="font-semibold text-app-text">NL-to-SQL 文档中心</span>
          <span className="text-xs text-app-subtle hidden sm:block">
            安装与使用说明
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="p-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/50 transition-all" />
          <Link
            href="/"
            className="text-xs text-app-muted hover:text-app-text px-3 py-1.5 rounded-lg border border-app-border hover:border-app-accent/50 transition-all"
          >
            返回首页
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6 flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <div className="bg-app-surface-hover border border-app-border rounded-2xl p-3 space-y-1">
            <button
              onClick={() => setTab("install")}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs transition-colors",
                tab === "install"
                  ? "bg-app-surface text-app-text border border-app-accent/40"
                  : "text-app-text-secondary hover:bg-app-surface-hover border border-transparent"
              )}
            >
              <FileText size={14} className="text-app-accent" />
              安装指南
            </button>
            <button
              onClick={() => setTab("guide")}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs transition-colors",
                tab === "guide"
                  ? "bg-app-surface text-app-text border border-app-accent/40"
                  : "text-app-text-secondary hover:bg-app-surface-hover border border-transparent"
              )}
            >
              <Info size={14} className="text-sky-600 dark:text-sky-400" />
              使用指南
            </button>
          </div>
          <p className="mt-3 text-[11px] text-app-subtle leading-relaxed">
            本页面直接渲染仓库中的
            <span className="text-indigo-700 dark:text-indigo-200">
              {" "}
              docs/INSTALL.md{" "}
            </span>
            和
            <span className="text-indigo-700 dark:text-indigo-200">
              {" "}
              docs/USER_GUIDE.md{" "}
            </span>
            ，保持与代码库文档内容一致。
          </p>
        </aside>

        {/* Content */}
        <section className="flex-1">
          <div className="bg-app-surface-hover border border-app-border rounded-2xl p-5 md:p-6 h-full max-h-[calc(100vh-7rem)] overflow-y-auto">
            <MarkdownViewer source={currentSource} />
          </div>
        </section>
      </main>
    </div>
  );
}

