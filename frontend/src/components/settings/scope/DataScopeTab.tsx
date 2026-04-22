"use client";

import Link from "next/link";
import { useDataScopeTab } from "@/hooks/useDataScopeTab";
import { ProvinceAliasSection } from "@/components/settings/scope/ProvinceAliasSection";
import { ScopePolicyEditor } from "@/components/settings/scope/ScopePolicyEditor";
import { ScopePolicyList } from "@/components/settings/scope/ScopePolicyList";
import { ScopePreviewPanel } from "@/components/settings/scope/ScopePreviewPanel";

type Props = {
  refreshTick?: number;
};

export function DataScopeTab({ refreshTick = 0 }: Props) {
  const tab = useDataScopeTab({ refreshTick });

  return (
    <>
      <div className="mb-5 rounded-xl border border-app-border bg-app-surface/80 px-4 py-3 text-sm text-app-muted">
        <p className="leading-relaxed">
          <strong className="text-app-text">NL→SQL 数据范围策略</strong>
          （唯一事实源）。与{" "}
          <Link href="/admin?section=rag" className="text-app-accent hover:underline">
            RAG 文档权限
          </Link>{" "}
          无关。
        </p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-app-text/90 hover:text-app-text">
            生效规则与填写说明
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4 leading-relaxed">
            <li>按「主体类型 + 主体标识」匹配；</li>
            <li>同维度按优先级从小到大依次应用；</li>
            <li>合并「取并集」则与前面合并，「替换」则覆盖该维度已有结果。</li>
          </ol>
          <p className="mt-2 pl-1 text-app-subtle">
            多个值用<strong>英文逗号</strong>分隔。省份可与下方「高级：省份别名」统一写法。
          </p>
        </details>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px] mb-8">
        <ScopePolicyList tab={tab} />
        <div className="space-y-5 lg:sticky lg:top-6 self-start max-h-[calc(100vh-2rem)] mb-safe overflow-y-auto pr-1">
          <ScopePreviewPanel tab={tab} />
          <ProvinceAliasSection tab={tab} />
          {tab.showScopeEditor && <ScopePolicyEditor tab={tab} />}
        </div>
      </div>
    </>
  );
}
