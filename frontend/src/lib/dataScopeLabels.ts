import type { DataScopePolicy } from "@/types";

export const DIMENSION_LABELS: Record<
  DataScopePolicy["dimension"],
  { short: string; description: string }
> = {
  province: { short: "省份", description: "按省/直辖市等地理范围限制 SQL 可见数据" },
  employee: { short: "员工", description: "按员工维度（如工号、标识）限制" },
  region: { short: "区域", description: "按业务区域划分" },
  district: { short: "片区", description: "按片区划分" },
};

export const SUBJECT_TYPE_LABELS: Record<
  DataScopePolicy["subject_type"],
  { short: string; optionLabel: string }
> = {
  user: { short: "用户", optionLabel: "User（兼容）" },
  user_id: { short: "用户 ID", optionLabel: "用户 ID（数字 id 或工号）" },
  role: { short: "角色", optionLabel: "角色" },
  level: { short: "职级", optionLabel: "职级" },
  user_name: { short: "登录名", optionLabel: "登录名" },
};

export const MERGE_MODE_LABELS: Record<
  DataScopePolicy["merge_mode"],
  { short: string; detail: string }
> = {
  union: {
    short: "取并集",
    detail: "与前面已匹配策略的结果合并（去重相加）",
  },
  replace: {
    short: "替换",
    detail: "命中本策略时，用本策略结果覆盖该维度上此前的合并结果",
  },
};

/** 列表格内展示用：取前若干项，其余用 +N */
export function summarizeValuesList(values: string[], maxItems = 2): {
  display: string;
  full: string;
} {
  if (!values.length) return { display: "—", full: "" };
  const head = values.slice(0, maxItems);
  const extra = values.length - maxItems;
  const display =
    extra > 0 ? `${head.join("、")} +${extra}` : head.join("、");
  return { display, full: values.join("，") };
}

/** 列表/卡片顶部一行中文摘要 */
export function formatPolicySummary(p: DataScopePolicy): string {
  const sub = SUBJECT_TYPE_LABELS[p.subject_type]?.short ?? p.subject_type;
  const dim = DIMENSION_LABELS[p.dimension]?.short ?? p.dimension;
  const merge = MERGE_MODE_LABELS[p.merge_mode]?.short ?? p.merge_mode;
  return `${sub} · ${p.subject_key}｜维度：${dim}｜合并：${merge}`;
}
