"use client";

import { Database, Settings, Table } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChatBox } from "@/components/ChatBox";
import { cn } from "@/lib/utils";
import type { SqlType } from "@/types";

export default function HomePage() {
  const [sqlType, setSqlType] = useState<SqlType>("hive");

  return (
    <div className="flex flex-col h-screen bg-[#0f1117]">
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2d3d] bg-[#12151f]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center">
            <Database size={16} className="text-[#0ea5e9]" />
          </div>
          <span className="font-semibold text-[#e2e8f0]">NL-to-SQL</span>
          <span className="text-xs text-[#4a5568] hidden sm:block">
            自然语言转 SQL 生成系统
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* SQL type toggle */}
          <div className="flex items-center bg-[#1a1d27] border border-[#2a2d3d] rounded-lg p-0.5">
            <button
              onClick={() => setSqlType("hive")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "hive"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              Hive
            </button>
            <button
              onClick={() => setSqlType("postgresql")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "postgresql"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              PostgreSQL
            </button>
            <button
              onClick={() => setSqlType("oracle")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                sqlType === "oracle"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-[#8892a4] hover:text-[#e2e8f0]"
              )}
            >
              Oracle
            </button>
          </div>

          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
          >
            <Table size={13} />
            元数据管理
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs text-[#8892a4] hover:text-[#e2e8f0] px-3 py-1.5 rounded-lg border border-[#2a2d3d] hover:border-[#0ea5e9]/50 transition-all"
          >
            <Settings size={13} />
            模型配置
          </Link>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-hidden">
        <ChatBox sqlType={sqlType} />
      </main>
    </div>
  );
}
