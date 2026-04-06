"use client";

import ForceGraph2D from "react-force-graph-2d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  relationTypeLabel,
  type SchemaGraphLink,
  type SchemaGraphNode,
} from "@/lib/schemaGraph";

function useHtmlClassFlag(className: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.documentElement.classList.contains(className));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, [className]);
  return on;
}

function nodeColorByDb(db: string, dark: boolean): string {
  if (db === "hive") return dark ? "#fbbf24" : "#b45309";
  if (db === "postgresql") return dark ? "#60a5fa" : "#1d4ed8";
  if (db === "mysql") return dark ? "#fb923c" : "#c2410c";
  if (db === "oracle") return dark ? "#34d399" : "#047857";
  return dark ? "#94a3b8" : "#64748b";
}

function linkColorByRelation(
  t: SchemaGraphLink["relation_type"],
  accentRgb: string,
  dark: boolean
): string {
  if (t === "foreign_key") return `rgb(${accentRgb.replace(/ /g, ",")})`;
  if (t === "logical") return dark ? "#fbbf24" : "#ca8a04";
  return dark ? "#c4b5fd" : "#6d28d9";
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export interface SchemaGraphForceProps {
  nodes: SchemaGraphNode[];
  links: SchemaGraphLink[];
}

export default function SchemaGraphForce({ nodes, links }: SchemaGraphForceProps) {
  const dark = useHtmlClassFlag("dark");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 560 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(320, el.clientWidth);
      const h = Math.max(280, el.clientHeight);
      setDims({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    }),
    [nodes, links]
  );

  const bg = readCssVar("--bg", "#f1f5f9");
  const accentRgb = readCssVar("--accent-rgb", "2 132 199");

  const nodeColor = useCallback(
    (n: SchemaGraphNode) => nodeColorByDb(n.db_type, dark),
    [dark]
  );

  const linkColor = useCallback(
    (l: SchemaGraphLink) =>
      linkColorByRelation(l.relation_type, accentRgb, dark),
    [accentRgb, dark]
  );

  const linkLabel = useCallback((l: SchemaGraphLink) => {
    const parts = [
      relationTypeLabel(l.relation_type),
      l.from_column && l.to_column ? `${l.from_column} → ${l.to_column}` : null,
      l.note,
    ].filter(Boolean);
    return parts.join("\n");
  }, []);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      ref={wrapRef}
      className="w-full min-h-[min(70vh,560px)] h-[70vh] rounded-xl border border-app-border overflow-hidden bg-app-bg"
    >
      <ForceGraph2D
        width={dims.w}
        height={dims.h}
        backgroundColor={bg}
        graphData={graphData}
        nodeId="id"
        nodeLabel="label"
        nodeColor={nodeColor}
        nodeRelSize={5}
        linkSource="source"
        linkTarget="target"
        linkColor={linkColor}
        linkLabel={linkLabel}
        linkWidth={1.5}
        linkDirectionalArrowLength={6}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(l) => linkColor(l as SchemaGraphLink)}
        cooldownTicks={120}
      />
    </div>
  );
}
