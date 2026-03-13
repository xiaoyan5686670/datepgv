"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
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

export function SQLResult({
  sql,
  sqlType,
  referencedTables,
  isStreaming,
}: SQLResultProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sql]);

  const lang = "sql";
  const label =
    sqlType === "hive"
      ? "Hive SQL"
      : sqlType === "oracle"
      ? "Oracle SQL"
      : "PostgreSQL";
  const labelColor =
    sqlType === "hive"
      ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
      : sqlType === "oracle"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : "bg-blue-500/20 text-blue-300 border-blue-500/30";

  return (
    <div className="rounded-xl border border-[#2a2d3d] overflow-hidden bg-[#1a1d27]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#12151f] border-b border-[#2a2d3d]">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded border",
              labelColor
            )}
          >
            {label}
          </span>
          {referencedTables && referencedTables.length > 0 && (
            <span className="text-xs text-[#8892a4]">
              引用: {referencedTables.join(", ")}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          disabled={isStreaming}
          className="flex items-center gap-1 text-xs text-[#8892a4] hover:text-[#e2e8f0] transition-colors disabled:opacity-40"
        >
          {copied ? (
            <>
              <Check size={13} />
              已复制
            </>
          ) : (
            <>
              <Copy size={13} />
              复制
            </>
          )}
        </button>
      </div>

      {/* Code block */}
      <div className={cn(isStreaming && "typing-cursor")}>
        <SyntaxHighlighter
          language={lang}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "0.85rem",
            lineHeight: "1.6",
          }}
          showLineNumbers
          wrapLines
        >
          {sql || " "}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
