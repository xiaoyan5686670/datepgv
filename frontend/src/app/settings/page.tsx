"use client";

import {
  ArrowLeft,
  CheckCircle,
  Database,
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
  fetchAnalyticsDbSettings,
  fetchConfigs,
  testAnalyticsDbConnection,
  testConfig,
  updateAnalyticsDbSettings,
} from "@/lib/api";
import type {
  AnalyticsDbSettings,
  AnalyticsDbSettingsWrite,
  LLMConfig,
  LLMConfigTestResult,
} from "@/types";

type TabType = "llm" | "embedding" | "analytics";

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

  const [analytics, setAnalytics] = useState<AnalyticsDbSettings | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [pgInput, setPgInput] = useState("");
  const [mysqlInput, setMysqlInput] = useState("");
  const [analyticsSaving, setAnalyticsSaving] = useState(false);
  const [pgTest, setPgTest] = useState<{
    loading: boolean;
    result?: LLMConfigTestResult;
  }>({ loading: false });
  const [mysqlTest, setMysqlTest] = useState<{
    loading: boolean;
    result?: LLMConfigTestResult;
  }>({ loading: false });

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const d = await fetchAnalyticsDbSettings();
      setAnalytics(d);
      setPgInput("");
      setMysqlInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "加载数据连接失败");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConfigs("all");
      setConfigs(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeTab === "analytics") {
      loadAnalytics();
    }
  }, [activeTab, loadAnalytics]);

  const displayed =
    activeTab === "analytics"
      ? []
      : configs.filter((c) => c.config_type === activeTab);
  const activeConfig =
    activeTab === "analytics"
      ? undefined
      : displayed.find((c) => c.is_active);

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

  const saveAnalyticsConnections = async () => {
    if (!pgInput.trim() && !mysqlInput.trim()) {
      alert(
        "请输入要保存的连接 URL，或使用「清除」移除页面配置以改回环境变量。"
      );
      return;
    }
    setAnalyticsSaving(true);
    try {
      const payload: AnalyticsDbSettingsWrite = {};
      if (pgInput.trim()) payload.postgres_url = pgInput.trim();
      if (mysqlInput.trim()) payload.mysql_url = mysqlInput.trim();
      const d = await updateAnalyticsDbSettings(payload);
      setAnalytics(d);
      setPgInput("");
      setMysqlInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setAnalyticsSaving(false);
    }
  };

  const clearAnalyticsPg = async () => {
    if (!confirm("清除 PostgreSQL 页面配置，执行连接将回落到环境变量？")) return;
    try {
      const d = await updateAnalyticsDbSettings({ clear_postgres: true });
      setAnalytics(d);
    } catch (err) {
      alert(err instanceof Error ? err.message : "清除失败");
    }
  };

  const clearAnalyticsMysql = async () => {
    if (!confirm("清除 MySQL 页面配置，执行连接将回落到环境变量？")) return;
    try {
      const d = await updateAnalyticsDbSettings({ clear_mysql: true });
      setAnalytics(d);
    } catch (err) {
      alert(err instanceof Error ? err.message : "清除失败");
    }
  };

  const runPgTest = async () => {
    setPgTest((s) => ({ ...s, loading: true }));
    try {
      const result = await testAnalyticsDbConnection(
        "postgresql",
        pgInput.trim() || null
      );
      setPgTest({ loading: false, result });
    } catch (err) {
      setPgTest({
        loading: false,
        result: {
          success: false,
          message: err instanceof Error ? err.message : "测试失败",
        },
      });
    }
  };

  const runMysqlTest = async () => {
    setMysqlTest((s) => ({ ...s, loading: true }));
    try {
      const result = await testAnalyticsDbConnection(
        "mysql",
        mysqlInput.trim() || null
      );
      setMysqlTest({ loading: false, result });
    } catch (err) {
      setMysqlTest({
        loading: false,
        result: {
          success: false,
          message: err instanceof Error ? err.message : "测试失败",
        },
      });
    }
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
            <span className="font-semibold">
              {activeTab === "analytics" ? "数据连接" : "模型配置"}
            </span>
          </div>
          {activeTab !== "analytics" && (
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
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Explanation banner */}
        {activeTab === "analytics" ? (
          <div className="mb-6 bg-[#0ea5e9]/5 border border-[#0ea5e9]/20 rounded-xl px-5 py-4 text-sm text-[#8892a4]">
            配置「自然语言生成 SQL」在服务器上<strong className="text-[#e2e8f0]">
              实际执行
            </strong>
            所用的数据库（与存元数据/向量的 PostgreSQL 应用库不同）。MySQL
            目标库在此填写
            <span className="text-[#e2e8f0]"> mysql://…或 mariadb://…</span>
            ；未填写时使用环境变量{" "}
            <code className="text-[#0ea5e9]">ANALYTICS_MYSQL_URL</code> /
            <code className="text-[#0ea5e9]">ANALYTICS_POSTGRES_URL</code>。
          </div>
        ) : (
          <div className="mb-6 bg-[#0ea5e9]/5 border border-[#0ea5e9]/20 rounded-xl px-5 py-4 text-sm text-[#8892a4]">
            在这里管理所有 LLM 和 Embedding 模型配置。
            <span className="text-[#e2e8f0]">将任意配置设为"活跃"</span>
            后，整个系统立即切换到该模型，无需重启服务。
            支持 OpenAI、Gemini、DeepSeek、Anthropic、Ollama
            等所有 LiteLLM 兼容的 Provider。
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#1a1d27] border border-[#2a2d3d] rounded-xl p-1 w-fit flex-wrap">
          {(["llm", "embedding", "analytics"] as TabType[]).map((tab) => {
            const active =
              tab !== "analytics" &&
              configs.find((c) => c.config_type === tab && c.is_active);
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
                {tab === "llm"
                  ? "LLM 模型"
                  : tab === "embedding"
                    ? "Embedding 模型"
                    : "数据连接"}
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
          <button
            onClick={() => (activeTab === "analytics" ? loadAnalytics() : load())}
            className="ml-2 px-2 text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
            title="刷新"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Active config callout */}
        {activeTab !== "analytics" && activeConfig && (
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

        {activeTab !== "analytics" && !activeConfig && !loading && (
          <div className="mb-4 flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
            <XCircle size={16} className="text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300">
              尚未设置活跃的{activeTab === "llm" ? " LLM " : " Embedding "}
              配置，系统无法正常工作。请激活一个配置，或新增后激活。
            </span>
          </div>
        )}

        {/* Analytics execute DB */}
        {activeTab === "analytics" && (
          <div className="space-y-6 mb-8">
            {analyticsLoading || !analytics ? (
              <div className="flex justify-center py-16">
                <Loader2 size={24} className="animate-spin text-[#0ea5e9]" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3 text-xs",
                      analytics.mysql_effective_configured
                        ? "border-green-500/30 bg-green-500/5 text-green-400/90"
                        : "border-amber-500/30 bg-amber-500/5 text-amber-200"
                    )}
                  >
                    MySQL 执行：{" "}
                    {analytics.mysql_effective_configured
                      ? "已可连接"
                      : "未配置（需页面或环境变量）"}
                  </div>
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3 text-xs",
                      analytics.postgres_effective_configured
                        ? "border-green-500/30 bg-green-500/5 text-green-400/90"
                        : "border-[#2a2d3d] bg-[#1a1d27] text-[#8892a4]"
                    )}
                  >
                    PostgreSQL 执行：{" "}
                    {analytics.postgres_effective_configured
                      ? "已可连接"
                      : "未配置"}
                  </div>
                </div>

                <div className="bg-[#1a1d27] border border-[#2a2d3d] rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm text-[#e2e8f0]">
                    <Database size={16} className="text-[#0ea5e9]" />
                    MySQL（分析库）
                  </div>
                  {analytics.mysql_stored && analytics.mysql_url_masked && (
                    <p className="text-xs font-mono text-[#8892a4] break-all">
                      已保存：{analytics.mysql_url_masked}
                    </p>
                  )}
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={mysqlInput}
                    onChange={(e) => setMysqlInput(e.target.value)}
                    placeholder="mysql://user:password@host:3306/dbname"
                    className="w-full rounded-lg bg-[#12151f] border border-[#2a2d3d] px-3 py-2 text-sm font-mono text-[#e2e8f0] placeholder:text-[#4a5568] focus:border-[#0ea5e9]/50 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runMysqlTest}
                      disabled={mysqlTest.loading}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/30 hover:bg-[#0ea5e9]/20 disabled:opacity-40"
                    >
                      {mysqlTest.loading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wifi size={12} />
                      )}
                      测试连接
                    </button>
                    <button
                      type="button"
                      onClick={clearAnalyticsMysql}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2d3d] text-[#8892a4] hover:text-[#e2e8f0] hover:border-[#4a5568]"
                    >
                      清除页面配置
                    </button>
                  </div>
                  {mysqlTest.result && (
                    <p
                      className={cn(
                        "text-xs font-mono",
                        mysqlTest.result.success
                          ? "text-green-400"
                          : "text-red-400"
                      )}
                    >
                      {mysqlTest.result.success
                        ? `成功 · ${mysqlTest.result.latency_ms ?? "?"}ms`
                        : mysqlTest.result.message}
                    </p>
                  )}
                </div>

                <div className="bg-[#1a1d27] border border-[#2a2d3d] rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm text-[#e2e8f0]">
                    <Database size={16} className="text-[#0ea5e9]" />
                    PostgreSQL（可选，执行方言为 PG 时）
                  </div>
                  {analytics.postgres_stored && analytics.postgres_url_masked && (
                    <p className="text-xs font-mono text-[#8892a4] break-all">
                      已保存：{analytics.postgres_url_masked}
                    </p>
                  )}
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={pgInput}
                    onChange={(e) => setPgInput(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/dbname"
                    className="w-full rounded-lg bg-[#12151f] border border-[#2a2d3d] px-3 py-2 text-sm font-mono text-[#e2e8f0] placeholder:text-[#4a5568] focus:border-[#0ea5e9]/50 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runPgTest}
                      disabled={pgTest.loading}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/30 hover:bg-[#0ea5e9]/20 disabled:opacity-40"
                    >
                      {pgTest.loading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wifi size={12} />
                      )}
                      测试连接
                    </button>
                    <button
                      type="button"
                      onClick={clearAnalyticsPg}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2d3d] text-[#8892a4] hover:text-[#e2e8f0] hover:border-[#4a5568]"
                    >
                      清除页面配置
                    </button>
                  </div>
                  {pgTest.result && (
                    <p
                      className={cn(
                        "text-xs font-mono",
                        pgTest.result.success
                          ? "text-green-400"
                          : "text-red-400"
                      )}
                    >
                      {pgTest.result.success
                        ? `成功 · ${pgTest.result.latency_ms ?? "?"}ms`
                        : pgTest.result.message}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={saveAnalyticsConnections}
                  disabled={analyticsSaving}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-sm font-medium px-5 py-2.5 disabled:opacity-50"
                >
                  {analyticsSaving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : null}
                  保存连接
                </button>
              </>
            )}
          </div>
        )}

        {/* Config cards */}
        {activeTab !== "analytics" &&
          (loading ? (
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
        )
        )}

        {/* LiteLLM model string reference */}
        {activeTab !== "analytics" && (
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
                  [
                    "Ollama Chat（推荐）",
                    "ollama_chat/llama3.2",
                    "API Base，例 http://127.0.0.1:11434",
                  ],
                  [
                    "Ollama 嵌入",
                    "ollama/nomic-embed-text",
                    "API Base；维度须与 PG vector(N) 一致",
                  ],
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
              Ollama 说明：
              <a
                href="https://docs.litellm.ai/docs/providers/ollama"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0ea5e9] hover:underline ml-1"
              >
                LiteLLM — Ollama
              </a>
              ；完整 Provider 列表：
              <a
                href="https://docs.litellm.ai/docs/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0ea5e9] hover:underline ml-1"
              >
                LiteLLM Providers
              </a>
            </p>
          </div>
        </details>
        )}
      </main>

      {showModal && (activeTab === "llm" || activeTab === "embedding") && (
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
