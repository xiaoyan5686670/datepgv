"use client";

import { AlertCircle, CheckCircle2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultPreview, SqlType } from "@/types";

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface QueryResultPreviewProps {
  sqlType: SqlType;
  executed?: boolean;
  execError?: string | null;
  resultPreview?: ResultPreview | null;
}

export function QueryResultPreview({
  sqlType,
  executed,
  execError,
  resultPreview,
}: QueryResultPreviewProps) {
  const noServerExec = sqlType === "hive" || sqlType === "oracle";

  if (noServerExec && !executed) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90 flex gap-2 items-start">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
        <span>
          当前为 {sqlType.toUpperCase()} 模式：服务端不执行 SQL，请在目标环境自行运行上方
          SQL。
        </span>
      </div>
    );
  }

  if (execError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300 flex gap-2 items-start">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium text-red-200 mb-1">执行失败</div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-red-300/90">
            {execError}
          </pre>
        </div>
      </div>
    );
  }

  if (executed) {
    if (!resultPreview) {
      return (
        <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3 text-xs text-green-300 flex gap-2 items-center">
          <CheckCircle2 size={14} className="flex-shrink-0" />
          已执行查询（无返回行详情）
        </div>
      );
    }
    const { columns, rows, truncated } = resultPreview;
    return (
      <div className="rounded-xl border border-[#2a2d3d] overflow-hidden bg-[#12151f]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1d27] border-b border-[#2a2d3d]">
          <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
          <span className="text-xs font-medium text-green-400/90">已执行查询</span>
          {truncated ? (
            <span className="text-[10px] text-amber-400/90 border border-amber-500/30 rounded px-1.5 py-0.5">
              结果已截断
            </span>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-[#8892a4] px-4 py-6 text-center">查询返回 0 行</p>
        ) : (
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-[#2a2d3d] bg-[#0f1117]">
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 font-semibold text-[#8892a4] whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2d3d]/60">
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "hover:bg-[#1a1d27]/80",
                      i % 2 === 0 ? "bg-transparent" : "bg-[#0f1117]/50"
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="px-3 py-1.5 text-[#e2e8f0] font-mono max-w-[240px] truncate"
                        title={formatCell(row[c])}
                      >
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (executed === false && !noServerExec) {
    return (
      <div className="rounded-xl border border-[#2a2d3d] bg-[#1a1d27] px-4 py-3 text-xs text-[#8892a4] flex gap-2 items-center">
        <Table2 size={14} />
        本次未执行查询（例如已关闭「执行查询」或未配置分析库连接）。
      </div>
    );
  }

  return null;
}
