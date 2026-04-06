"use client";

import ForceGraph2D from "react-force-graph-2d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  linkMidpointCaption,
  relationTypeLabel,
  shortTableDisplayName,
  type SchemaGraphLink,
  type SchemaGraphNode,
} from "@/lib/schemaGraph";

const EDGE_LABEL_MIN_SCALE = 0.35;
const NODE_R = 6;

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

function getNodeXY(n: unknown): { x: number; y: number } | null {
  if (n && typeof n === "object" && "x" in n && "y" in n) {
    const x = (n as { x?: unknown }).x;
    const y = (n as { y?: unknown }).y;
    if (typeof x === "number" && typeof y === "number") return { x, y };
  }
  return null;
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let s = text;
  while (s.length > 0 && ctx.measureText(s + ell).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + ell;
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
  const textColor = readCssVar("--text", "#0f172a");
  const mutedColor = readCssVar("--muted", "#64748b");
  const surfaceColor = readCssVar("--surface", "#ffffff");

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
      linkMidpointCaption(l),
      l.note,
    ].filter(Boolean);
    return parts.join("\n");
  }, []);

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as SchemaGraphNode & { x?: number; y?: number };
      if (typeof n.x !== "number" || typeof n.y !== "number") return;

      const x = n.x;
      const y = n.y;
      const r = NODE_R / globalScale;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI, false);
      ctx.fillStyle = nodeColor(n);
      ctx.fill();

      const line1 = shortTableDisplayName(n.label);
      const fontMain = `${12 / globalScale}px system-ui, sans-serif`;
      const fontSub = `${10 / globalScale}px system-ui, sans-serif`;
      const lineHeight = 14 / globalScale;
      const gap = 4 / globalScale;
      let textY = y + r + gap;

      ctx.font = fontMain;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = textColor;
      const maxW = 140 / globalScale;
      ctx.fillText(truncateToWidth(ctx, line1, maxW), x, textY);
      textY += lineHeight;

      ctx.font = fontSub;
      ctx.fillStyle = mutedColor;
      ctx.fillText(truncateToWidth(ctx, n.db_type, maxW), x, textY);
    },
    [nodeColor, textColor, mutedColor]
  );

  const nodePointerAreaPaint = useCallback(
    (node: object, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as SchemaGraphNode & { x?: number; y?: number };
      if (typeof n.x !== "number" || typeof n.y !== "number") return;
      const pad = 48 / globalScale;
      const h = pad * 1.6;
      ctx.fillStyle = color;
      ctx.fillRect(n.x - pad, n.y - pad * 0.4, pad * 2, h);
    },
    []
  );

  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (globalScale < EDGE_LABEL_MIN_SCALE) return;

      const l = link as SchemaGraphLink & {
        source?: unknown;
        target?: unknown;
      };
      const p0 = getNodeXY(l.source);
      const p1 = getNodeXY(l.target);
      if (!p0 || !p1) return;

      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      const main = linkMidpointCaption(l);
      const sub = relationTypeLabel(l.relation_type);
      const showSub = main !== sub;

      const fsMain = 11 / globalScale;
      const fsSub = 9 / globalScale;
      ctx.font = `${fsMain}px system-ui, sans-serif`;
      const maxW = 160 / globalScale;
      const line1 = truncateToWidth(ctx, main, maxW);

      ctx.font = `${fsSub}px system-ui, sans-serif`;
      const line2 = showSub ? truncateToWidth(ctx, sub, maxW) : "";

      ctx.font = `${fsMain}px system-ui, sans-serif`;
      const w1 = ctx.measureText(line1).width;
      let w2 = 0;
      if (line2) {
        ctx.font = `${fsSub}px system-ui, sans-serif`;
        w2 = ctx.measureText(line2).width;
      }
      const boxW = Math.min(maxW + 8 / globalScale, Math.max(w1, w2) + 10 / globalScale);
      const boxH =
        (line2 ? fsMain + fsSub + 6 / globalScale : fsMain + 6 / globalScale) +
        4 / globalScale;
      const bx = midX - boxW / 2;
      const by = midY - boxH / 2;

      ctx.save();
      ctx.fillStyle =
        surfaceColor.length === 7
          ? `${surfaceColor}e6`
          : "rgba(255,255,255,0.9)";
      if (dark) {
        ctx.fillStyle = "rgba(15,17,23,0.88)";
      }
      const br = 4 / globalScale;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, br);
      ctx.fill();
      ctx.strokeStyle = linkColor(l);
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let ty = by + boxH / 2 - (line2 ? fsSub / 2 + 2 / globalScale : 0);
      ctx.font = `${fsMain}px system-ui, sans-serif`;
      ctx.fillStyle = textColor;
      ctx.fillText(line1, midX, ty);
      if (line2) {
        ty += fsMain - 2 / globalScale;
        ctx.font = `${fsSub}px system-ui, sans-serif`;
        ctx.fillStyle = mutedColor;
        ctx.fillText(line2, midX, ty);
      }
      ctx.restore();
    },
    [dark, linkColor, mutedColor, surfaceColor, textColor]
  );

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
        nodeLabel={(n) => (n as SchemaGraphNode).label}
        nodeRelSize={NODE_R}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        linkSource="source"
        linkTarget="target"
        linkColor={linkColor}
        linkLabel={linkLabel}
        linkWidth={1.5}
        linkDirectionalArrowLength={6}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(l) => linkColor(l as SchemaGraphLink)}
        linkCanvasObjectMode={() => "after"}
        linkCanvasObject={linkCanvasObject}
        d3VelocityDecay={0.35}
        cooldownTicks={160}
      />
    </div>
  );
}
