"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownViewerProps {
  source: string;
  className?: string;
}

export function MarkdownViewer({ source, className }: MarkdownViewerProps) {
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none prose-pre:bg-[#020617] prose-pre:border prose-pre:border-[#1f2937] prose-code:text-[#e5e7eb] prose-code:bg-[#020617] prose-code:px-1 prose-code:py-0.5 prose-code:rounded-md prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:text-sm prose-li:text-sm",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}

