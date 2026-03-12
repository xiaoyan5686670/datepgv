"use client";

import {
  ArrowLeft,
  CheckCircle,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LLMConfigModal } from "@/components/LLMConfigModal";
import { cn } from "@/lib/utils";
import {
  activateConfig,
  deleteConfig,
  fetchConfigs,
  getEmbeddingDim,
  setEmbeddingDim,
  testConfig,
} from "@/lib/api";
import type { LLMConfig, LLMConfigTestResult } from "@/types";

type TabType = "llm" | "embedding";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("llm");
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<LLMConfig | undefined>();
  const [testResults, setTestResults] = useState<
    Record<number, { result: LLMConfigTestResult; loading: boolean }>
  >({});
  const [activating, setActivating] = useState<number | null>(null);
  const [embeddingDim, setEmbeddingDimState] = useState<number>(1536);
  const [embeddingDimSaving, setEmbeddingDimSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, dimRes] = await Promise.all([
        fetchConfigs("all"),
        getEmbeddingDim().catch(() => ({ embedding_dim: 1536 })),
      ]);
      setConfigs(data);
      setEmbeddingDimState(dimRes.embedding_dim);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const displayed = configs.filter((c) => c.config_type === activeTab);
  const activeConfig = displayed.find((c) => c.is_active);

  const handleActivate = async (id: number) => {
    setActivating(id);
    try {
      const updated = await activateConfig(id);
      setConfigs((prev) =>
        prev.map((c) =>
          c.config_type === updated.config_type
            ? { ...c, is_active: c.id === id }
            : c
        )
      );
    } catch (err) {
      alert(`激活失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此配置？")) return;
    try {
      await deleteConfig(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleTest = async (id: number) => {
    setTestResults((prev) => ({
      ...prev,
      [id]: { result: prev[id]?.result ?? ({ success: false, message: "" } as LLMConfigTestResult), loading: true },
    }));
    const result = await testConfig(id);
    setTestResults((prev) => ({ ...prev, [id]: { result, loading: false } }));
  };

  const handleModalSuccess = (cfg: LLMConfig) => {
    setConfigs((prev) => {
      const idx = prev.findIndex((c) => c.id === cfg.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = cfg;
        return next;
      }
      return [cfg, ...prev];
    });
    setShowModal(false);
    setEditTarget(undefined);
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      {/* Header */}
      <header className="border-b border-[#2a2d3d] bg-[#12151f] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <Settings size={18} className="text-[#0ea5e9]" />
            <span className="font-semibold">模型配置</span>
          </div>
          <button
            onClick={() => {
              setEditTarget(undefined);
              setShowModal(true);
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#0ea5e9] hover:bg-[#0284c7] text-white transition-colors"
          >
            <Plus size={12} />
            新增配置
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Explanation banner */}
        <div className="mb-6 bg-[#0ea5e9]/5 border border-[#0ea5e9]/20 rounded-xl px-5 py-4 text-sm text-[#8892a4]">
          在这里管理所有 LLM 和 Embedding 模型配置。
          <span className="text-[#e2e8f0]">将任意配置设为"活跃"</span>
          后，整个系统立即切换到该模型，无需重启服务。
          支持 OpenAI、Gemini、DeepSeek、Anthropic 等所有 LiteLLM 兼容的 Provider。
        </div>

        {/* Embedding 向量维度 */}
        <div className="mb-6 bg-[#1a1d27] border border-[#2a2d3d] rounded-xl px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-[#e2e8f0]">Embedding 向量维度</span>
            <select
              value={embeddingDim}
              onChange={async (e) => {
                const next = Number(e.target.value);
                setEmbeddingDimState(next);
                setEmbeddingDimSaving(true);
                try {
                  await setEmbeddingDim(next);
                  alert(
                    "已保存并完成数据库迁移。请重启后端服务使新维度生效，然后在「元数据管理」页执行「全部重新向量化」。"
                  );
                } catch (err) {
                  alert(`保存失败: ${err instanceof Error ? err.message : err}`);
                  load();
                } finally {
                  setEmbeddingDimSaving(false);
                }
              }}
              disabled={embeddingDimSaving}
              className="bg-[#0f1117] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] focus:border-[#0ea5e9]/50 focus:outline-none disabled:opacity-50"
            >
              <option value={768}>768（如 Gemini text-embedding-004）</option>
              <option value={1536}>1536（如 OpenAI text-embedding-3-small）</option>
              <option value={3072}>3072（如 OpenAI text-embedding-3-large）</option>
            </select>
            {embeddingDimSaving && (
              <Loader2 size={14} className="animate-spin text-[#0ea5e9]" />
            )}
          </div>
          <p className="text-xs text-[#4a5568] mt-2">
            须与当前激活的 Embedding 模型输出维度一致；修改后需重启后端并在元数据管理页执行「全部重新向量化」。
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#1a1d27] border border-[#2a2d3d] rounded-xl p-1 w-fit">
          {(["llm", "embedding"] as TabType[]).map((tab) => {
            const active = configs.find(
              (c) => c.config_type === tab && c.is_active
            );
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                  activeTab === tab
                    ? "bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/30"
                    : "text-[#8892a4] hover:text-[#e2e8f0]"
                )}
              >
                {tab === "llm" ? "LLM 模型" : "Embedding 模型"}
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
          <button
            onClick={load}
            className="ml-2 px-2 text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Active config callout */}
        {activeConfig && (
          <div className="mb-4 flex items-center gap-3 bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3">
            <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
            <span className="text-sm text-[#e2e8f0]">
              当前活跃：
              <span className="font-semibold ml-1">{activeConfig.name}</span>
              <span className="text-[#8892a4] ml-2 font-mono text-xs">
                {activeConfig.model}
              </span>
            </span>
          </div>
        )}

        {!activeConfig && !loading && (
          <div className="mb-4 flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
            <XCircle size={16} className="text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300">
              尚未设置活跃的{activeTab === "llm" ? " LLM " : " Embedding "}
              配置，系统无法正常工作。请激活一个配置，或新增后激活。
            </span>
          </div>
        )}

        {/* Config cards */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#0ea5e9]" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 text-[#4a5568]">
            <Settings size={40} className="mx-auto mb-3 opacity-40" />
            <p>暂无配置，点击右上角"新增配置"</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((cfg) => {
              const testState = testResults[cfg.id];
              return (
                <div
                  key={cfg.id}
                  className={cn(
                    "bg-[#1a1d27] border rounded-xl overflow-hidden transition-all",
                    cfg.is_active
                      ? "border-green-500/30 shadow-[0_0_0_1px_rgba(74,222,128,0.1)]"
                      : "border-[#2a2d3d]"
                  )}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    {/* Active indicator */}
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        cfg.is_active ? "bg-green-400" : "bg-[#2a2d3d]"
                      )}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[#e2e8f0]">
                          {cfg.name}
                        </span>
                        {cfg.is_active && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                            活跃
                          </span>
                        )}
                        {cfg.api_key_set ? (
                          <span className="text-xs text-green-400/70">
                            ✓ API Key 已设置
                          </span>
                        ) : (
                          <span className="text-xs text-amber-400/70">
                            ⚠ 未设置 API Key
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-[#0ea5e9]/80 mt-0.5">
                        {cfg.model}
                      </p>
                      {cfg.api_base && (
                        <p className="text-xs text-[#4a5568] mt-0.5">
                          Base: {cfg.api_base}
                        </p>
                      )}
                      {Object.keys(cfg.extra_params).length > 0 && (
                        <p className="text-xs text-[#4a5568] mt-0.5">
                          {Object.entries(cfg.extra_params)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>

                    {/* Test result badge */}
                    {testState && !testState.loading && (
                      <div
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 flex-shrink-0",
                          testState.result.success
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}
                      >
                        {testState.result.success ? (
                          <>
                            <CheckCircle size={11} />
                            {testState.result.latency_ms}ms
                          </>
                        ) : (
                          <>
                            <XCircle size={11} />
                            失败
                          </>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Test */}
                      <button
                        onClick={() => handleTest(cfg.id)}
                        disabled={testState?.loading}
                        title="测试连接"
                        className="p-2 rounded-lg text-[#8892a4] hover:text-[#0ea5e9] hover:bg-[#0ea5e9]/10 transition-all disabled:opacity-40"
                      >
                        {testState?.loading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Wifi size={14} />
                        )}
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => {
                          setEditTarget(cfg);
                          setShowModal(true);
                        }}
                        title="编辑"
                        className="p-2 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d3d] transition-all"
                      >
                        <Edit2 size={14} />
                      </button>

                      {/* Activate */}
                      {!cfg.is_active && (
                        <button
                          onClick={() => handleActivate(cfg.id)}
                          disabled={activating === cfg.id}
                          title="设为活跃"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/20 hover:bg-[#0ea5e9]/20 transition-all disabled:opacity-40"
                        >
                          {activating === cfg.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Zap size={11} />
                          )}
                          激活
                        </button>
                      )}

                      {/* Delete */}
                      {!cfg.is_active && (
                        <button
                          onClick={() => handleDelete(cfg.id)}
                          title="删除"
                          className="p-2 rounded-lg text-[#4a5568] hover:text-red-400 hover:bg-red-400/10 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Test error detail */}
                  {testState && !testState.loading && !testState.result.success && (
                    <div className="border-t border-[#2a2d3d] px-5 py-2.5 bg-red-500/5">
                      <p className="text-xs text-red-400 font-mono break-all">
                        {testState.result.message}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* LiteLLM model string reference */}
        <details className="mt-8 bg-[#1a1d27] border border-[#2a2d3d] rounded-xl overflow-hidden">
          <summary className="px-5 py-3 text-sm text-[#8892a4] cursor-pointer hover:text-[#e2e8f0] select-none">
            常用 LiteLLM Model String 参考
          </summary>
          <div className="px-5 pb-5 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#4a5568]">
                  <th className="text-left py-1 pr-4">Provider</th>
                  <th className="text-left py-1 pr-4">Model String</th>
                  <th className="text-left py-1">API Key 环境变量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2d3d]/50">
                {[
                  ["OpenAI", "openai/gpt-4o", "OPENAI_API_KEY"],
                  ["Gemini", "gemini/gemini-2.0-flash", "GEMINI_API_KEY"],
                  ["DeepSeek", "deepseek/deepseek-coder", "DEEPSEEK_API_KEY"],
                  ["Anthropic", "anthropic/claude-3-5-sonnet-20241022", "ANTHROPIC_API_KEY"],
                  ["Azure OpenAI", "azure/gpt-4o", "AZURE_API_KEY"],
                  ["Cohere", "cohere/command-r-plus", "COHERE_API_KEY"],
                ].map(([provider, model, key]) => (
                  <tr key={model}>
                    <td className="py-2 pr-4 text-[#8892a4]">{provider}</td>
                    <td className="py-2 pr-4 font-mono text-[#0ea5e9]">{model}</td>
                    <td className="py-2 text-[#4a5568]">{key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-[#4a5568] mt-3">
              完整列表参考：
              <a
                href="https://docs.litellm.ai/docs/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0ea5e9] hover:underline ml-1"
              >
                LiteLLM Providers Documentation
              </a>
            </p>
          </div>
        </details>
      </main>

      {showModal && (
        <LLMConfigModal
          configType={activeTab}
          existing={editTarget}
          onSuccess={handleModalSuccess}
          onClose={() => {
            setShowModal(false);
            setEditTarget(undefined);
          }}
        />
      )}
    </div>
  );
}
