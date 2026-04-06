"use client";

import dynamic from "next/dynamic";
import type { SchemaGraphForceProps } from "./SchemaGraphForce";

const SchemaGraphForce = dynamic(
  () => import("./SchemaGraphForce"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full min-h-[min(70vh,560px)] h-[70vh] rounded-xl border border-app-border bg-app-surface flex items-center justify-center text-app-muted text-sm">
        加载关系图中…
      </div>
    ),
  }
);

export function SchemaGraphView(props: SchemaGraphForceProps) {
  if (props.nodes.length === 0) return null;
  return <SchemaGraphForce {...props} />;
}
