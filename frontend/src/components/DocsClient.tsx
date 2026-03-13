"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, FileText, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownViewer } from "@/components/MarkdownViewer";

type TabKey = "install" | "guide";

interface DocsClientProps {
  installSource: string;
  guideSource: string;
}

export function DocsClient({ installSource, guideSource }: DocsClientProps) {
  const [tab, setTab] = useState<TabKey>("install");

  const currentSource = tab === "install" ? installSource : guideSource;

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2d3d] bg-[#12151f]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center">
            <Database size={16} className="text-[#0ea5e9]" />
          </div>
          <span className="font-semibold text-[#e2e8f0]">NL-to-SQL 文档中心</span>
          <span className="text-xs text-[#4a5568] hidden sm:block">
            安装与使用说明
          </span>
        </div>
        <Link
          href="/"
          className="text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
        >
          返回首页
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6 flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <div className="bg-[#111827] border border-[#2a2d3d] rounded-2xl p-3 space-y-1">
            <button
              onClick={() => setTab("install")}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs transition-colors",
                tab === "install"
                  ? "bg-[#1a1d27] text-[#e2e8f0] border border-[#0ea5e9]/40"
                  : "text-[#a0aec0] hover:bg-[#0f172a] border border-transparent"
              )}
            >
              <FileText size={14} className="text-[#0ea5e9]" />
              安装指南
            </button>
            <button
              onClick={() => setTab("guide")}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs transition-colors",
                tab === "guide"
                  ? "bg-[#1a1d27] text-[#e2e8f0] border border-[#0ea5e9]/40"
                  : "text-[#a0aec0] hover:bg-[#0f172a] border border-transparent"
              )}
            >
              <Info size={14} className="text-[#38bdf8]" />
              使用指南
            </button>
          </div>
          <p className="mt-3 text-[11px] text-[#4a5568] leading-relaxed">
            本页面直接渲染仓库中的
            <span className="text-[#cbd5f5]"> docs/INSTALL.md </span>
            和
            <span className="text-[#cbd5f5]"> docs/USER_GUIDE.md </span>
            ，保持与代码库文档内容一致。
          </p>
        </aside>

        {/* Content */}
        <section className="flex-1">
          <div className="bg-[#111827] border border-[#2a2d3d] rounded-2xl p-5 md:p-6 h-full max-h-[calc(100vh-7rem)] overflow-y-auto">
            <MarkdownViewer source={currentSource} />
          </div>
        </section>
      </main>
    </div>
  );
}

