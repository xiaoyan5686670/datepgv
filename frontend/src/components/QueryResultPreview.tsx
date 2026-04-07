"use client";

import { AlertCircle, CheckCircle2, Info, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultPreview, SqlType } from "@/types";

function formatCell(v: unknown): string {
  if (v == null) return "NULL";
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
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-xs text-amber-800 dark:text-amber-200 flex gap-3 items-start shadow-sm">
        <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle size={14} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-1">
          <p className="font-bold uppercase tracking-tight text-[10px] text-amber-600 dark:text-amber-400">Notice</p>
          <p className="leading-relaxed opacity-90">
            当前为 <span className="font-bold">{sqlType.toUpperCase()}</span> 模式：服务端暂不支持自动执行，请手动运行生成的 SQL。
          </p>
        </div>
      </div>
    );
  }

  if (execError) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-xs text-destructive flex gap-3 items-start shadow-sm">
        <div className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle size={14} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-bold uppercase tracking-tight text-[10px]">Execution Failed</p>
          <div className="bg-destructive/10 rounded-lg p-3 border border-destructive/10">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed opacity-90">
              {execError}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  if (executed) {
    if (!resultPreview) {
      return (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-xs text-primary flex gap-3 items-center shadow-sm">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={14} />
          </div>
          <span className="font-medium">已成功执行查询（无返回数据）</span>
        </div>
      );
    }
    const { columns, rows, truncated } = resultPreview;
    return (
      <div className="rounded-2xl border shadow-sm overflow-hidden bg-card transition-all duration-300 hover:shadow-md">
        <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 size={12} className="text-green-600 dark:text-green-400" />
            </div>
            <span className="text-xs font-bold uppercase tracking-tight text-muted-foreground">Query Result</span>
            <span className="text-[10px] font-medium text-muted-foreground/60 ml-2">
              {rows.length} {truncated ? "of many " : ""}rows returned
            </span>
          </div>
          {truncated && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              <Info size={10} />
              Truncated
            </div>
          )}
        </div>
        
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Table2 size={24} className="opacity-20" />
            <p className="text-xs font-medium italic">Empty result set</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/20">
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="hover:bg-muted/30 transition-colors duration-150"
                  >
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="px-4 py-2 text-[11px] font-mono text-foreground/80 max-w-[300px] truncate"
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
        
        <div className="px-5 py-2 bg-muted/10 border-t flex justify-end">
          <p className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-widest">
            Data Preview Mode
          </p>
        </div>
      </div>
    );
  }

  if (executed === false && !noServerExec) {
    return (
      <div className="rounded-2xl border border-dashed border-muted-foreground/20 px-5 py-4 text-xs text-muted-foreground flex gap-3 items-center italic">
        <Table2 size={14} className="opacity-50" />
        <span>本次未执行查询（已关闭执行选项或未配置连接）。</span>
      </div>
    );
  }

  return null;
}
