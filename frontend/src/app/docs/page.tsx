"use client";

import Link from "next/link";
import { useState } from "react";
import { Database, FileText, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type TabKey = "install" | "guide";

const INSTALL_CONTENT = `
### 安装指南

本项目支持 **Docker 一键启动** 和 **本地开发模式**：

- 推荐使用 Docker：\\\`docker compose up -d\\\` 后即可访问前端 <http://localhost:3000>。
- 如需本地开发，请先启动 PostgreSQL，再分别启动 backend/frontend。

详细内容请参考仓库中的 \\\`docs/INSTALL.md\\\`。
`;

const GUIDE_CONTENT = `
### 使用指南

典型使用流程：

1. 在“模型配置”页面配置 LLM 与 Embedding。
2. 在“元数据管理”页面导入业务表结构：
   - 手动录入
   - DDL 文本 / 文件导入
   - CSV/Excel 批量导入
3. 返回首页，选择 SQL 类型（Hive / PostgreSQL / Oracle），用自然语言描述需求。
4. 在左侧会话列表管理历史对话。

详细图文说明请参考仓库中的 \\\`docs/USER_GUIDE.md\\\`。
`;

export default function DocsPage() {
  const [tab, setTab] = useState<TabKey>("install");

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
            更详细、完整的文档可直接在仓库的
            <span className="text-[#cbd5f5]"> docs/INSTALL.md </span>
            和
            <span className="text-[#cbd5f5]"> docs/USER_GUIDE.md </span>
            中查看。
          </p>
        </aside>

        {/* Content */}
        <section className="flex-1">
          <div className="bg-[#111827] border border-[#2a2d3d] rounded-2xl p-5 md:p-6 space-y-4">
            {tab === "install" ? (
              <>
                <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">
                  安装指南（概览）
                </h2>
                <p className="text-sm text-[#8892a4]">
                  下面是安装流程的概览步骤，适合快速上手。需要完整说明时，请查看仓库中的
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-[#1f2937] text-[11px]">
                    docs/INSTALL.md
                  </code>
                  。
                </p>
                <pre className="mt-3 text-xs whitespace-pre-wrap text-[#cbd5f5] bg-[#060713] rounded-xl border border-[#2a2d3d] px-4 py-3">
                  {INSTALL_CONTENT}
                </pre>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">
                  使用指南（概览）
                </h2>
                <p className="text-sm text-[#8892a4]">
                  下面是典型使用流程的概览步骤。更详细的图文示例请参考
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-[#1f2937] text-[11px]">
                    docs/USER_GUIDE.md
                  </code>
                  。
                </p>
                <pre className="mt-3 text-xs whitespace-pre-wrap text-[#cbd5f5] bg-[#060713] rounded-xl border border-[#2a2d3d] px-4 py-3">
                  {GUIDE_CONTENT}
                </pre>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

