"use client";

import { Check, Copy, ExternalLink, Table } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import type { SqlType } from "@/types";

interface SQLResultProps {
  sql: string;
  sqlType: SqlType;
  referencedTables?: string[];
  isStreaming?: boolean;
}

export const SQLResult = memo(function SQLResult({
  sql,
  sqlType,
  referencedTables,
  isStreaming,
}: SQLResultProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sql);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textarea = document.createElement("textarea");
        textarea.value = sql;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn("复制失败");
    }
  }, [sql]);

  const lang = "sql";
  const label =
    sqlType === "hive"
      ? "Hive SQL"
      : sqlType === "oracle"
      ? "Oracle SQL"
      : sqlType === "mysql"
      ? "MySQL"
      : "PostgreSQL";
  
  const labelStyles =
    sqlType === "hive"
      ? "bg-amber-500 text-white"
      : sqlType === "oracle"
      ? "bg-emerald-500 text-white"
      : sqlType === "mysql"
      ? "bg-orange-500 text-white"
      : "bg-blue-500 text-white";

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden bg-[#1e1e1e] group/sql">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#252526] border-b border-white/5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
              labelStyles
            )}
          >
            {label}
          </span>
          {referencedTables && referencedTables.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-medium">
              <Table size={12} className="text-gray-500" />
              <span className="max-w-[200px] truncate" title={referencedTables.join(", ")}>
                {referencedTables.join(", ")}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={handleCopy}
          disabled={isStreaming}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 hover:text-white transition-colors disabled:opacity-40 px-2 py-1 rounded-md hover:bg-white/5"
        >
          {copied ? (
            <>
              <Check size={12} className="text-green-400" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制代码</span>
            </>
          )}
        </button>
      </div>

      {/* Code block */}
      <div className={cn("relative", isStreaming && "typing-cursor")}>
        <SyntaxHighlighter
          language={lang}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: "1.25rem",
            background: "transparent",
            fontSize: "0.8rem",
            lineHeight: "1.7",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
          showLineNumbers
          lineNumberStyle={{ minWidth: "2.5em", paddingRight: "1em", color: "#5a5a5a", textAlign: "right" }}
          wrapLines
        >
          {sql || " "}
        </SyntaxHighlighter>
        
        {!isStreaming && (
          <div className="absolute bottom-3 right-3 opacity-0 group-hover/sql:opacity-100 transition-opacity">
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/40 backdrop-blur-sm border border-white/10 text-[10px] text-gray-400">
              <ExternalLink size={10} />
              <span>SQL Ready</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
