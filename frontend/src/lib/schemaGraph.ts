import type { SqlType, TableMetadataEdge } from "@/types";

export type GraphDbFilter = "all" | SqlType;

export interface SchemaGraphNode {
  id: number;
  label: string;
  db_type: string;
}

export interface SchemaGraphLink {
  id: number;
  source: number;
  target: number;
  relation_type: TableMetadataEdge["relation_type"];
  from_column: string | null;
  to_column: string | null;
  note: string | null;
}

export function relationTypeLabel(t: TableMetadataEdge["relation_type"]): string {
  switch (t) {
    case "foreign_key":
      return "按字段关联";
    case "logical":
      return "业务相关";
    case "coquery":
      return "经常一起查";
    default:
      return t;
  }
}

/** 节点展示用短名：取 qualified 名最后一段（表名） */
export function shortTableDisplayName(fullLabel: string): string {
  const t = fullLabel.trim();
  if (!t) return "?";
  const parts = t.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? t;
}

/** 边中点常驻文案：有列则「from → to」，否则关系类型 */
export function linkMidpointCaption(link: SchemaGraphLink): string {
  const fc = link.from_column?.trim() || "";
  const tc = link.to_column?.trim() || "";
  if (fc && tc) return `${fc} → ${tc}`;
  if (fc || tc) return [fc || "?", tc || "?"].join(" → ");
  return relationTypeLabel(link.relation_type);
}

export function filterEdgesByDb(
  edges: TableMetadataEdge[],
  filter: GraphDbFilter
): TableMetadataEdge[] {
  if (filter === "all") return edges;
  return edges.filter(
    (e) => e.from_db_type === filter && e.to_db_type === filter
  );
}

export function edgesToGraphData(edges: TableMetadataEdge[]): {
  nodes: SchemaGraphNode[];
  links: SchemaGraphLink[];
} {
  const nodeMap = new Map<number, { label: string; db_type: string }>();
  for (const e of edges) {
    if (!nodeMap.has(e.from_metadata_id)) {
      nodeMap.set(e.from_metadata_id, {
        label: e.from_label,
        db_type: e.from_db_type,
      });
    }
    if (!nodeMap.has(e.to_metadata_id)) {
      nodeMap.set(e.to_metadata_id, {
        label: e.to_label,
        db_type: e.to_db_type,
      });
    }
  }
  const nodes: SchemaGraphNode[] = Array.from(nodeMap.entries()).map(
    ([id, v]) => ({
      id,
      label: v.label,
      db_type: v.db_type,
    })
  );
  const links: SchemaGraphLink[] = edges.map((e) => ({
    id: e.id,
    source: e.from_metadata_id,
    target: e.to_metadata_id,
    relation_type: e.relation_type,
    from_column: e.from_column,
    to_column: e.to_column,
    note: e.note,
  }));
  return { nodes, links };
}
