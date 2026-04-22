"use client";

import {
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { LLMConfigModal } from "@/components/LLMConfigModal";
import { DataScopeTab } from "@/components/settings/scope/DataScopeTab";
import { AppTopNav } from "@/components/navigation/AppTopNav";
import { PageSectionTabs } from "@/components/navigation/PageSectionTabs";
import { cn } from "@/lib/utils";
import {
  activateConfig,
  deleteConfig,
  createAnalyticsConnection,
  deleteAnalyticsConnection,
  fetchAnalyticsConnections,
  fetchConfigs,
  testAnalyticsConnection,
  testConfig,
  updateAnalyticsConnection,
} from "@/lib/api";
import type { AnalyticsDbConnection, LLMConfig, LLMConfigTestResult } from "@/types";

type TabType = "llm" | "embedding" | "analytics" | "scope";

function SettingsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("llm");
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<LLMConfig | undefined>();
  const [testResults, setTestResults] = useState<
    Record<number, { result: LLMConfigTestResult; loading: boolean }>
  >({});
  const [activating, setActivating] = useState<number | null>(null);

  const [connections, setConnections] = useState<AnalyticsDbConnection[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formEngine, setFormEngine] = useState<"mysql" | "postgresql">("mysql");
  const [formUrl, setFormUrl] = useState("");
  const [formDefault, setFormDefault] = useState(false);
  const [analyticsSaving, setAnalyticsSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | "form" | null>(null);
  const [scopeRefreshTick, setScopeRefreshTick] = useState(0);
  const resetConnectionForm = useCallback(() => {
    setEditingId(null);
    setFormName("");
    setFormEngine("mysql");
    setFormUrl("");
    setFormDefault(false);
  }, []);

  const loadConnections = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      setConnections(await fetchAnalyticsConnections());
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "加载配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "llm" || tab === "embedding" || tab === "analytics" || tab === "scope") {
      setActiveTab(tab);
      return;
    }
    setActiveTab("llm");
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === "analytics") {
      loadConnections();
    }
  }, [activeTab, loadConnections]);

  const displayed =
    activeTab === "analytics"
      ? []
      : configs.filter((c) => c.config_type === activeTab);
  const activeConfig =
    activeTab === "analytics"
      ? undefined
      : displayed.find((c) => c.is_active);
  const isModelTab = activeTab === "llm" || activeTab === "embedding";

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
    try {
      const result = await testConfig(id);
      setTestResults((prev) => ({ ...prev, [id]: { result, loading: false } }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          result: {
            success: false,
            message: err instanceof Error ? err.message : "测试失败",
          },
          loading: false,
        },
      }));
    }
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

  const submitConnectionForm = async () => {
    if (!formName.trim()) {
      alert("请填写连接名称");
      return;
    }
    if (editingId === null && !formUrl.trim()) {
      alert("请填写连接 URL");
      return;
    }
    setAnalyticsSaving(true);
    try {
      if (editingId !== null) {
        const payload: { name: string; url?: string; is_default: boolean } = {
          name: formName.trim(),
          is_default: formDefault,
        };
        if (formUrl.trim()) payload.url = formUrl.trim();
        await updateAnalyticsConnection(editingId, payload);
      } else {
        await createAnalyticsConnection({
          name: formName.trim(),
          engine: formEngine,
          url: formUrl.trim(),
          is_default: formDefault,
        });
      }
      resetConnectionForm();
      await loadConnections();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setAnalyticsSaving(false);
    }
  };

  const deleteConnection = async (id: number) => {
    if (!confirm("确定删除此连接？")) return;
    try {
      await deleteAnalyticsConnection(id);
      if (editingId === id) resetConnectionForm();
      await loadConnections();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const setConnectionDefault = async (id: number) => {
    try {
      await updateAnalyticsConnection(id, { is_default: true });
      await loadConnections();
    } catch (err) {
      alert(err instanceof Error ? err.message : "设置失败");
    }
  };

  const runTestStored = async (c: AnalyticsDbConnection) => {
    setTestingId(c.id);
    try {
      const r = await testAnalyticsConnection({
        engine: c.engine,
        connection_id: c.id,
      });
      if (r.success) alert(`连接成功 · ${r.latency_ms ?? "?"}ms`);
      else alert(r.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTestingId(null);
    }
  };

  const runTestForm = async () => {
    if (!formUrl.trim()) {
      alert("请输入 URL 再测试");
      return;
    }
    setTestingId("form");
    try {
      const r = await testAnalyticsConnection({
        engine: formEngine,
        url: formUrl.trim(),
      });
      if (r.success) alert(`连接成功 · ${r.latency_ms ?? "?"}ms`);
      else alert(r.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTestingId(null);
    }
  };

  const startEditConnection = (c: AnalyticsDbConnection) => {
    setEditingId(c.id);
    setFormName(c.name);
    setFormEngine(c.engine);
    setFormUrl("");
    setFormDefault(c.is_default);
  };

  const setTabInUrl = useCallback(
    (tab: TabType) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <AppTopNav
        activeKey="settings"
        title="配置中心"
        breadcrumbs={[
          { label: "设置" },
          {
            label: activeTab === "analytics" ? "数据连接" : activeTab === "scope" ? "数据权限策略" : "模型配置",
          },
        ]}
        rightActions={
          <>
            {activeTab !== "analytics" && activeTab !== "scope" && (
              <button
                onClick={() => {
                  setEditTarget(undefined);
                  setShowModal(true);
                }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-app-accent hover:bg-app-accent-hover text-white transition-colors"
              >
                <Plus size={12} />
                新增配置
              </button>
            )}
          </>
        }
      />

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Explanation banner */}
        {activeTab === "analytics" ? (
          <div className="mb-6 bg-app-accent/5 border border-app-accent/20 rounded-xl px-5 py-4 text-sm text-app-muted">
            配置「自然语言生成 SQL」在服务器上<strong className="text-app-text">
              实际执行
            </strong>
            所用的数据库（与存元数据/向量的 PostgreSQL 应用库不同）。可添加多条
            MySQL / PostgreSQL 连接；可选「默认」优先用于执行。未指定默认时，使用同引擎下最早创建的一条，再回落环境变量{" "}
            <code className="text-app-accent">ANALYTICS_MYSQL_URL</code> /
            <code className="text-app-accent">ANALYTICS_POSTGRES_URL</code>。
          </div>
        ) : activeTab === "scope" ? null : (
          <div className="mb-6 bg-app-accent/5 border border-app-accent/20 rounded-xl px-5 py-4 text-sm text-app-muted">
            在这里管理所有 LLM 和 Embedding 模型配置。
            <span className="text-app-text">将任意配置设为“活跃”</span>
            后，整个系统立即切换到该模型，无需重启服务。
            支持 OpenAI、Gemini、DeepSeek、Anthropic、Ollama
            等所有 LiteLLM 兼容的 Provider。
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <PageSectionTabs
            items={[
              { key: "llm", label: "LLM模型" },
              { key: "embedding", label: "Embedding模型", shortLabel: "Embedding" },
              { key: "analytics", label: "数据连接" },
              { key: "scope", label: "权限策略" },
            ]}
            active={activeTab}
            onChange={setTabInUrl}
          />
          <button
            onClick={() => {
              if (activeTab === "analytics") loadConnections();
              else if (activeTab === "scope") setScopeRefreshTick((t) => t + 1);
              else load();
            }}
            className="ml-2 px-2 text-app-muted hover:text-app-text transition-colors"
            title="刷新"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Active config callout */}
        {isModelTab && activeConfig && (
          <div className="mb-4 flex items-center gap-3 bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3">
            <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
            <span className="text-sm text-app-text">
              当前活跃：
              <span className="font-semibold ml-1">{activeConfig.name}</span>
              <span className="text-app-muted ml-2 font-mono text-xs">
                {activeConfig.model}
              </span>
            </span>
          </div>
        )}

        {isModelTab && !activeConfig && !loading && (
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
            {analyticsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 size={24} className="animate-spin text-app-accent" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs text-app-muted">
                    MySQL 连接：{" "}
                    <span className="text-app-text font-medium">
                      {connections.filter((c) => c.engine === "mysql").length} 条
                    </span>
                  </div>
                  <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs text-app-muted">
                    PostgreSQL 连接：{" "}
                    <span className="text-app-text font-medium">
                      {connections.filter((c) => c.engine === "postgresql").length} 条
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {connections.map((c) => (
                    <div
                      key={c.id}
                      className="bg-app-surface border border-app-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-app-text">
                          <span className="font-medium truncate">{c.name}</span>
                          <span
                            className={cn(
                              "text-[10px] uppercase px-2 py-0.5 rounded border",
                              c.engine === "mysql"
                                ? "border-amber-500/40 text-amber-300"
                                : "border-sky-500/40 text-sky-300"
                            )}
                          >
                            {c.engine}
                          </span>
                          {c.is_default && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-app-accent/15 text-app-accent border border-app-accent/30">
                              默认
                            </span>
                          )}
                        </div>
                        {c.url_masked && (
                          <p className="text-xs font-mono text-app-muted break-all">
                            {c.url_masked}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {!c.is_default && (
                          <button
                            type="button"
                            onClick={() => setConnectionDefault(c.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text"
                          >
                            设为默认
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => runTestStored(c)}
                          disabled={testingId === c.id}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-app-accent/10 text-app-accent border border-app-accent/30 disabled:opacity-40"
                        >
                          {testingId === c.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Wifi size={12} />
                          )}
                          测试
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditConnection(c)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text flex items-center gap-1"
                        >
                          <Edit2 size={12} />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteConnection(c.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                  {connections.length === 0 && (
                    <p className="text-sm text-app-muted text-center py-6">
                      暂无保存的连接。可在下方添加；未添加时使用环境变量中的 ANALYTICS_* URL。
                    </p>
                  )}
                </div>

                <div className="bg-app-surface border border-app-border rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-sm text-app-text">
                      <Database size={16} className="text-app-accent" />
                      {editingId !== null ? "编辑连接" : "添加连接"}
                    </div>
                    {editingId !== null && (
                      <button
                        type="button"
                        onClick={resetConnectionForm}
                        className="text-xs text-app-muted hover:text-app-text"
                      >
                        取消编辑
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="连接名称"
                      className="rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm text-app-text placeholder:text-app-subtle focus:border-app-accent/50 focus:outline-none"
                    />
                    <select
                      value={formEngine}
                      onChange={(e) =>
                        setFormEngine(e.target.value as "mysql" | "postgresql")
                      }
                      disabled={editingId !== null}
                      className="rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm text-app-text focus:border-app-accent/50 focus:outline-none disabled:opacity-60"
                    >
                      <option value="mysql">MySQL</option>
                      <option value="postgresql">PostgreSQL</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder={
                      editingId !== null
                        ? "新 URL（留空则不修改）"
                        : "mysql://… 或 postgresql://…"
                    }
                    className="w-full rounded-lg bg-app-input border border-app-border px-3 py-2 text-sm font-mono text-app-text placeholder:text-app-subtle focus:border-app-accent/50 focus:outline-none"
                  />
                  <label className="flex items-center gap-2 text-xs text-app-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formDefault}
                      onChange={(e) => setFormDefault(e.target.checked)}
                      className="rounded border-app-border"
                    />
                    设为该引擎的默认连接
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runTestForm}
                      disabled={testingId === "form" || !formUrl.trim()}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-app-accent/10 text-app-accent border border-app-accent/30 disabled:opacity-40"
                    >
                      {testingId === "form" ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wifi size={12} />
                      )}
                      测试当前 URL
                    </button>
                    <button
                      type="button"
                      onClick={submitConnectionForm}
                      disabled={analyticsSaving}
                      className="flex items-center gap-2 rounded-lg bg-app-accent hover:bg-app-accent-hover text-white text-sm font-medium px-5 py-2 disabled:opacity-50"
                    >
                      {analyticsSaving ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : null}
                      {editingId !== null ? "保存修改" : "保存连接"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "scope" && (
          <DataScopeTab refreshTick={scopeRefreshTick} />
        )}


        {/* Config cards */}
        {isModelTab &&
          (loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-app-accent" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 text-app-subtle">
            <Settings size={40} className="mx-auto mb-3 opacity-40" />
            <p>暂无配置，点击右上角“新增配置”</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((cfg) => {
              const testState = testResults[cfg.id];
              return (
                <div
                  key={cfg.id}
                  className={cn(
                    "bg-app-surface border rounded-xl overflow-hidden transition-all",
                    cfg.is_active
                      ? "border-green-500/30 shadow-[0_0_0_1px_rgba(74,222,128,0.1)]"
                      : "border-app-border"
                  )}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    {/* Active indicator */}
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        cfg.is_active ? "bg-green-400" : "bg-app-border"
                      )}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-app-text">
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
                      <p className="text-xs font-mono text-app-accent/80 mt-0.5">
                        {cfg.model}
                      </p>
                      {cfg.api_base && (
                        <p className="text-xs text-app-subtle mt-0.5">
                          Base: {cfg.api_base}
                        </p>
                      )}
                      {Object.keys(cfg.extra_params).length > 0 && (
                        <p className="text-xs text-app-subtle mt-0.5">
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
                        className="p-2 rounded-lg text-app-muted hover:text-app-accent hover:bg-app-accent/10 transition-all disabled:opacity-40"
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
                        className="p-2 rounded-lg text-app-muted hover:text-app-text hover:bg-app-border transition-all"
                      >
                        <Edit2 size={14} />
                      </button>

                      {/* Activate */}
                      {!cfg.is_active && (
                        <button
                          onClick={() => handleActivate(cfg.id)}
                          disabled={activating === cfg.id}
                          title="设为活跃"
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-app-accent/10 text-app-accent border border-app-accent/20 hover:bg-app-accent/20 transition-all disabled:opacity-40"
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
                          className="p-2 rounded-lg text-app-subtle hover:text-red-400 hover:bg-red-400/10 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Test error detail */}
                  {testState && !testState.loading && !testState.result.success && (
                    <div className="border-t border-app-border px-5 py-2.5 bg-red-500/5">
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
        {isModelTab && (
        <details className="mt-8 bg-app-surface border border-app-border rounded-xl overflow-hidden">
          <summary className="px-5 py-3 text-sm text-app-muted cursor-pointer hover:text-app-text select-none">
            常用 LiteLLM Model String 参考
          </summary>
          <div className="px-5 pb-5 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-app-subtle">
                  <th className="text-left py-1 pr-4">Provider</th>
                  <th className="text-left py-1 pr-4">Model String</th>
                  <th className="text-left py-1">API Key 环境变量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/50">
                {[
                  ["OpenAI", "openai/gpt-4o", "OPENAI_API_KEY"],
                  ["Gemini", "gemini/gemini-2.0-flash", "GEMINI_API_KEY"],
                  ["DeepSeek", "deepseek/deepseek-coder", "DEEPSEEK_API_KEY"],
                  [
                    "阿里云 DashScope（通义）",
                    "dashscope/qwen-turbo",
                    "DASHSCOPE_API_KEY；可选 API Base（国内/国际兼容模式 endpoint）",
                  ],
                  [
                    "阿里云 DashScope 嵌入（兼容模式）",
                    "dashscope/text-embedding-v4",
                    "仅 text-embedding-v1～v4；qwen3-vl-embedding 等为多模态原生 API，不可用。维度须与 PG vector(N) 一致",
                  ],
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
                    <td className="py-2 pr-4 text-app-muted">{provider}</td>
                    <td className="py-2 pr-4 font-mono text-app-accent">{model}</td>
                    <td className="py-2 text-app-subtle">{key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-app-subtle mt-3">
              DashScope 说明：
              <a
                href="https://docs.litellm.ai/docs/providers/dashscope"
                target="_blank"
                rel="noopener noreferrer"
                className="text-app-accent hover:underline ml-1"
              >
                LiteLLM — DashScope
              </a>
              。Ollama 说明：
              <a
                href="https://docs.litellm.ai/docs/providers/ollama"
                target="_blank"
                rel="noopener noreferrer"
                className="text-app-accent hover:underline ml-1"
              >
                LiteLLM — Ollama
              </a>
              ；完整 Provider 列表：
              <a
                href="https://docs.litellm.ai/docs/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-app-accent hover:underline ml-1"
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

export default function SettingsPage() {
  return (
    <AuthGuard requireAdmin>
      <SettingsPageInner />
    </AuthGuard>
  );
}
