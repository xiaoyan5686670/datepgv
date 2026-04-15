"use client";

import {
  ArrowLeft,
  CheckCircle,
  Database,
  Edit2,
  Loader2,
  Search,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Users,
  Trash2,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { LLMConfigModal } from "@/components/LLMConfigModal";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  fetchScopePolicies,
  createScopePolicy,
  updateScopePolicy,
  deleteScopePolicy,
  bulkSetScopePoliciesEnabled,
  previewScopeForUser,
} from "@/lib/api";
import type {
  AnalyticsDbConnection,
  LLMConfig,
  LLMConfigTestResult,
  DataScopePolicy,
  DataScopePreview,
} from "@/types";

type TabType = "llm" | "embedding" | "analytics" | "scope";

function SettingsPageInner() {
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
  const [scopePolicies, setScopePolicies] = useState<DataScopePolicy[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeBulkLoading, setScopeBulkLoading] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [showScopeEditor, setShowScopeEditor] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeDimensionFilter, setScopeDimensionFilter] = useState<
    "all" | DataScopePolicy["dimension"]
  >("all");
  const [scopeSubjectFilter, setScopeSubjectFilter] = useState<
    "all" | DataScopePolicy["subject_type"]
  >("all");
  const [scopeEnabledFilter, setScopeEnabledFilter] = useState<"all" | "enabled" | "disabled">(
    "all"
  );
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<number[]>([]);
  const [previewUserIdInput, setPreviewUserIdInput] = useState("");
  const [scopePreviewLoading, setScopePreviewLoading] = useState(false);
  const [scopePreview, setScopePreview] = useState<DataScopePreview | null>(null);
  const [scopeForm, setScopeForm] = useState({
    subject_type: "level" as DataScopePolicy["subject_type"],
    subject_key: "",
    dimension: "province" as DataScopePolicy["dimension"],
    allowed_values: "",
    deny_values: "",
    merge_mode: "union" as DataScopePolicy["merge_mode"],
    priority: 100,
    enabled: true,
    note: "",
  });
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

  const resetScopeEditor = useCallback(() => {
    setEditingPolicyId(null);
    setScopeForm({
      subject_type: "level",
      subject_key: "",
      dimension: "province",
      allowed_values: "",
      deny_values: "",
      merge_mode: "union",
      priority: 100,
      enabled: true,
      note: "",
    });
  }, []);

  const loadScopePolicies = useCallback(async () => {
    setScopeLoading(true);
    try {
      setScopePolicies(await fetchScopePolicies());
    } catch (err) {
      alert(err instanceof Error ? err.message : "加载权限策略失败");
    } finally {
      setScopeLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeTab === "analytics") {
      loadConnections();
    } else if (activeTab === "scope") {
      loadScopePolicies();
    }
  }, [activeTab, loadConnections, loadScopePolicies]);

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

  const filteredScopePolicies = scopePolicies.filter((p) => {
    const q = scopeQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      `${p.subject_type}:${p.subject_key}`.toLowerCase().includes(q) ||
      (p.note ?? "").toLowerCase().includes(q) ||
      p.allowed_values.join(",").toLowerCase().includes(q) ||
      p.deny_values.join(",").toLowerCase().includes(q);
    const matchesDimension =
      scopeDimensionFilter === "all" || p.dimension === scopeDimensionFilter;
    const matchesSubject =
      scopeSubjectFilter === "all" || p.subject_type === scopeSubjectFilter;
    const matchesEnabled =
      scopeEnabledFilter === "all" ||
      (scopeEnabledFilter === "enabled" ? p.enabled : !p.enabled);
    return matchesQuery && matchesDimension && matchesSubject && matchesEnabled;
  });

  const allFilteredSelected =
    filteredScopePolicies.length > 0 &&
    filteredScopePolicies.every((p) => selectedPolicyIds.includes(p.id));

  const toggleSelectFiltered = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredScopePolicies.map((p) => p.id));
      setSelectedPolicyIds((prev) => prev.filter((id) => !filteredIds.has(id)));
      return;
    }
    setSelectedPolicyIds((prev) => {
      const out = new Set(prev);
      filteredScopePolicies.forEach((p) => out.add(p.id));
      return [...out];
    });
  };

  const applyBulkEnabled = async (enabled: boolean) => {
    if (!selectedPolicyIds.length) return;
    setScopeBulkLoading(true);
    try {
      await bulkSetScopePoliciesEnabled(selectedPolicyIds, enabled);
      await loadScopePolicies();
      setSelectedPolicyIds([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "批量更新策略失败");
    } finally {
      setScopeBulkLoading(false);
    }
  };

  const runScopePreview = async () => {
    const userId = Number(previewUserIdInput.trim());
    if (!Number.isFinite(userId) || userId <= 0) {
      alert("请输入有效的用户ID");
      return;
    }
    setScopePreviewLoading(true);
    try {
      setScopePreview(await previewScopeForUser(userId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "预览失败");
    } finally {
      setScopePreviewLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      {/* Header */}
      <header className="border-b border-app-border bg-app-input px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-app-muted hover:text-app-text transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <Settings size={18} className="text-app-accent" />
            <span className="font-semibold">
              {activeTab === "analytics" ? "数据连接" : activeTab === "scope" ? "数据权限策略" : "模型配置"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle className="p-2 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:border-app-accent/50 transition-all" />
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
          </div>
        </div>
      </header>

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
        ) : activeTab === "scope" ? (
          <div className="mb-6 bg-app-accent/5 border border-app-accent/20 rounded-xl px-5 py-4 text-sm text-app-muted">
            这里维护 <strong className="text-app-text">SQL 范围策略表</strong>（唯一权限事实源）。
            生效顺序：按 priority 从小到大；支持 union/replace。值请用逗号分隔（例如：广西,广东）。
          </div>
        ) : (
          <div className="mb-6 bg-app-accent/5 border border-app-accent/20 rounded-xl px-5 py-4 text-sm text-app-muted">
            在这里管理所有 LLM 和 Embedding 模型配置。
            <span className="text-app-text">将任意配置设为“活跃”</span>
            后，整个系统立即切换到该模型，无需重启服务。
            支持 OpenAI、Gemini、DeepSeek、Anthropic、Ollama
            等所有 LiteLLM 兼容的 Provider。
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-app-surface border border-app-border rounded-xl p-1 w-fit flex-wrap">
          {(["llm", "embedding", "analytics", "scope"] as TabType[]).map((tab) => {
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
                    ? "bg-app-accent/10 text-app-accent border border-app-accent/30"
                    : "text-app-muted hover:text-app-text"
                )}
              >
                {tab === "llm"
                  ? "LLM 模型"
                  : tab === "embedding"
                    ? "Embedding 模型"
                    : tab === "analytics"
                      ? "数据连接"
                      : "权限策略"}
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
          <button
            onClick={() => (
              activeTab === "analytics"
                ? loadConnections()
                : activeTab === "scope"
                  ? loadScopePolicies()
                  : load()
            )}
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
          <div className="grid gap-6 lg:grid-cols-[1fr_360px] mb-8">
            <div className="space-y-6">
              {/* Toolbar */}
              <div className="bg-app-surface/60 backdrop-blur-md border border-app-border shadow-sm rounded-2xl p-4 transition-all">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[200px] group">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle group-focus-within:text-app-accent transition-colors" />
                    <input
                      value={scopeQuery}
                      onChange={(e) => setScopeQuery(e.target.value)}
                      placeholder="搜索主体 / 备注 / allowed / denied"
                      className="w-full rounded-xl bg-app-input/50 backdrop-blur-sm border border-app-border pl-9 pr-4 py-2.5 text-xs text-app-text transition-all focus:bg-app-input focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none"
                    />
                  </div>
                  <select
                    className="rounded-xl bg-app-input/50 backdrop-blur-sm border border-app-border px-3 py-2.5 text-xs text-app-text transition-all focus:border-app-accent/50 focus:outline-none focus:ring-2 focus:ring-app-accent/20 cursor-pointer hover:bg-app-input"
                    value={scopeDimensionFilter}
                    onChange={(e) =>
                      setScopeDimensionFilter(e.target.value as "all" | DataScopePolicy["dimension"])
                    }
                  >
                    <option value="all">全部维度</option>
                    <option value="province">Province</option>
                    <option value="employee">Employee</option>
                    <option value="region">Region</option>
                    <option value="district">District</option>
                  </select>
                  <select
                    className="rounded-xl bg-app-input/50 backdrop-blur-sm border border-app-border px-3 py-2.5 text-xs text-app-text transition-all focus:border-app-accent/50 focus:outline-none focus:ring-2 focus:ring-app-accent/20 cursor-pointer hover:bg-app-input"
                    value={scopeSubjectFilter}
                    onChange={(e) =>
                      setScopeSubjectFilter(e.target.value as "all" | DataScopePolicy["subject_type"])
                    }
                  >
                    <option value="all">全部主体</option>
                    <option value="level">Level</option>
                    <option value="role">Role</option>
                    <option value="user_id">User ID（数字 id 或工号）</option>
                    <option value="user_name">User Name</option>
                  </select>
                  <select
                    className="rounded-xl bg-app-input/50 backdrop-blur-sm border border-app-border px-3 py-2.5 text-xs text-app-text transition-all focus:border-app-accent/50 focus:outline-none focus:ring-2 focus:ring-app-accent/20 cursor-pointer hover:bg-app-input"
                    value={scopeEnabledFilter}
                    onChange={(e) =>
                      setScopeEnabledFilter(e.target.value as "all" | "enabled" | "disabled")
                    }
                  >
                    <option value="all">全部状态</option>
                    <option value="enabled">仅启用</option>
                    <option value="disabled">仅禁用</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-app-border/60">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        resetScopeEditor();
                        setShowScopeEditor(true);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-app-accent hover:bg-app-accent-hover text-white text-xs font-medium transition-all shadow-md hover:shadow-lg shadow-app-accent/20 hover:-translate-y-0.5"
                    >
                      <Plus size={14} />
                      新增策略
                    </button>
                    <div className="h-4 w-px bg-app-border mx-1"></div>
                    <button
                      onClick={toggleSelectFiltered}
                      className="px-3 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-text hover:bg-app-surface transition-all text-xs font-medium"
                    >
                      {allFilteredSelected ? "取消全选筛项" : "全选筛项"}
                    </button>
                    <button
                      disabled={!selectedPolicyIds.length || scopeBulkLoading}
                      onClick={() => applyBulkEnabled(true)}
                      className="px-3 py-2 rounded-xl border border-green-500/30 text-green-500 hover:bg-green-500/10 transition-all text-xs font-medium disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      批量启用 {selectedPolicyIds.length > 0 && `(${selectedPolicyIds.length})`}
                    </button>
                    <button
                      disabled={!selectedPolicyIds.length || scopeBulkLoading}
                      onClick={() => applyBulkEnabled(false)}
                      className="px-3 py-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-all text-xs font-medium disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      批量禁用 {selectedPolicyIds.length > 0 && `(${selectedPolicyIds.length})`}
                    </button>
                  </div>
                  <div className="text-xs text-app-subtle">
                    匹配 {filteredScopePolicies.length} 条策略
                  </div>
                </div>
              </div>

              {scopeLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-app-accent" />
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredScopePolicies.map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        "group relative p-5 rounded-2xl border transition-all duration-300",
                        p.enabled 
                          ? "bg-app-surface border-app-border hover:border-app-accent/40 shadow-sm hover:shadow-xl hover:-translate-y-1" 
                          : "bg-app-surface/40 border-dashed border-app-border opacity-70 grayscale-[0.3]"
                      )}
                    >
                      {selectedPolicyIds.includes(p.id) && (
                        <div className="absolute inset-0 border-2 border-app-accent/60 rounded-2xl pointer-events-none transition-all" />
                      )}
                      
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="mt-1 shrink-0">
                          <input
                            type="checkbox"
                            checked={selectedPolicyIds.includes(p.id)}
                            onChange={(e) =>
                              setSelectedPolicyIds((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, p.id])]
                                  : prev.filter((id) => id !== p.id)
                              )
                            }
                            className="w-4 h-4 rounded text-app-accent focus:ring-app-accent/30 bg-app-input border-app-border cursor-pointer transition-colors"
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-app-subtle">#{p.id}</span>
                            <span className={cn(
                                "px-2.5 py-0.5 rounded-md text-[10px] uppercase font-semibold tracking-wide border",
                                p.dimension === "province" ? "bg-sky-500/10 text-sky-500 border-sky-500/20" :
                                p.dimension === "employee" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                p.dimension === "region" ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" :
                                "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              )}>
                              {p.dimension}
                            </span>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-app-input/80 border border-app-border text-[10px] text-app-muted">
                              <span className="opacity-70">优先</span>
                              <span className="font-mono font-medium text-app-text">{p.priority}</span>
                            </div>
                            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-md border", p.enabled ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-app-input text-app-subtle border-app-border")}>
                              {p.enabled ? "ACTIVE" : "INACTIVE"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 py-1">
                            <div className="text-[10px] uppercase font-semibold text-app-subtle tracking-widest min-w-[60px]">SUBJECT</div>
                            <div className="text-sm font-mono text-app-text px-2 py-1 bg-gradient-to-r from-app-input to-transparent rounded-lg">
                              <span className="text-app-accent opacity-80">{p.subject_type}:</span> {p.subject_key}
                            </div>
                          </div>

                          <div className="space-y-2 pt-1">
                            <div className="flex items-start gap-2">
                              <div className="text-[10px] uppercase font-bold text-green-500/80 tracking-widest min-w-[60px] pt-1">ALLOW</div>
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {p.allowed_values.length > 0 ? p.allowed_values.map((v, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-md bg-green-500/10 text-green-500 font-medium text-xs border border-green-500/20 break-all shadow-sm">
                                    {v}
                                  </span>
                                )) : <span className="text-xs text-app-subtle/50 italic py-0.5">none</span>}
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <div className="text-[10px] uppercase font-bold text-red-500/80 tracking-widest min-w-[60px] pt-1">DENY</div>
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {p.deny_values.length > 0 ? p.deny_values.map((v, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-500 font-medium text-xs border border-red-500/20 break-all shadow-sm">
                                    {v}
                                  </span>
                                )) : <span className="text-xs text-app-subtle/50 italic py-0.5">none</span>}
                              </div>
                            </div>
                          </div>

                          {p.note && (
                            <div className="mt-2 pt-3 border-t border-border/50 text-xs text-app-subtle italic flex items-center gap-2">
                              {p.note}
                            </div>
                          )}
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-row justify-end gap-1 sm:flex-col shrink-0 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="p-2 rounded-xl text-app-muted hover:text-app-accent hover:bg-app-accent/10 transition-all focus:opacity-100"
                            title="编辑"
                            onClick={() => {
                              setEditingPolicyId(p.id);
                              setScopeForm({
                                subject_type: p.subject_type,
                                subject_key: p.subject_key,
                                dimension: p.dimension,
                                allowed_values: p.allowed_values.join(","),
                                deny_values: p.deny_values.join(","),
                                merge_mode: p.merge_mode,
                                priority: p.priority,
                                enabled: p.enabled,
                                note: p.note ?? "",
                              });
                              setShowScopeEditor(true);
                            }}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            type="button"
                            className="p-2 rounded-xl text-app-muted hover:text-red-500 hover:bg-red-500/10 transition-all focus:opacity-100"
                            title="删除"
                            onClick={async () => {
                              if (!confirm(`确认删除策略 #${p.id} ?`)) return;
                              await deleteScopePolicy(p.id);
                              await loadScopePolicies();
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredScopePolicies.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 bg-app-surface/20 border border-dashed border-app-border rounded-2xl text-app-subtle">
                      <Shield size={32} className="opacity-20 mb-3" />
                      <p className="text-sm">未找到匹配的策略</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-6 lg:sticky lg:top-6 self-start max-h-[calc(100vh-2rem)] mb-safe overflow-y-auto pr-1">
              {/* Preview Panel */}
              <div className="relative overflow-hidden bg-gradient-to-b from-app-surface to-app-surface/40 border border-app-border/80 backdrop-blur-xl rounded-2xl p-5 shadow-lg flex flex-col gap-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-app-text relative z-10">
                  <div className="p-1.5 rounded-lg bg-app-accent/10 text-app-accent"><Users size={16} /></div>
                  策略生效预览
                </div>
                <div className="flex gap-2 relative z-10">
                  <input
                    value={previewUserIdInput}
                    onChange={(e) => setPreviewUserIdInput(e.target.value)}
                    placeholder="输入用户ID进行验证"
                    className="flex-1 rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none"
                  />
                  <button
                    onClick={runScopePreview}
                    disabled={scopePreviewLoading}
                    className="px-4 py-2 text-xs font-medium rounded-xl border border-app-border bg-app-surface text-app-text hover:bg-app-input hover:border-app-accent/30 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:hover:border-app-border"
                  >
                    {scopePreviewLoading ? <Loader2 size={14} className="animate-spin" /> : "预览"}
                  </button>
                </div>
                {scopePreview && (
                  <div className="relative z-10 p-4 rounded-xl bg-app-input/50 border border-app-border/60 backdrop-blur-sm space-y-3 font-mono text-[11px] leading-relaxed">
                    <div className="flex justify-between items-center border-b border-app-border/40 pb-2">
                      <span className="text-app-text font-bold">{scopePreview.username}</span>
                      <span className="text-app-subtle bg-app-border/50 px-2 py-0.5 rounded-md">ID: {scopePreview.user_id}</span>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-app-muted items-center">
                      <span className="text-app-subtle text-[10px] uppercase">Source</span>
                      <span className="text-app-accent bg-app-accent/10 px-1.5 py-0.5 rounded border border-app-accent/20 w-fit">{scopePreview.source}</span>
                      <span className="text-app-subtle text-[10px] uppercase">Policy IDs</span>
                      <span>[{scopePreview.policy_ids.join(", ")}]</span>
                    </div>
                    <div className="pt-2 space-y-1.5">
                      <div className="flex gap-2 items-start">
                        <span className="text-[10px] uppercase w-[60px] inline-block text-sky-500 font-semibold pt-0.5">province</span>
                        <div className="flex flex-wrap gap-1 flex-1">{scopePreview.province_values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text">{v}</span>)}</div>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="text-[10px] uppercase w-[60px] inline-block text-emerald-500 font-semibold pt-0.5">employee</span>
                        <div className="flex flex-wrap gap-1 flex-1">{scopePreview.employee_values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text">{v}</span>)}</div>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="text-[10px] uppercase w-[60px] inline-block text-indigo-500 font-semibold pt-0.5">region</span>
                        <div className="flex flex-wrap gap-1 flex-1">{scopePreview.region_values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text">{v}</span>)}</div>
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="text-[10px] uppercase w-[60px] inline-block text-amber-500 font-semibold pt-0.5">district</span>
                        <div className="flex flex-wrap gap-1 flex-1">{scopePreview.district_values.map((v, i) => <span key={i} className="px-1.5 py-0.5 bg-app-surface border border-app-border/80 rounded-md text-app-text">{v}</span>)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Editor Panel */}
              {showScopeEditor && (
                <div className="relative overflow-hidden bg-app-surface border border-app-border rounded-2xl p-5 shadow-2xl space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between gap-2 text-sm font-semibold text-app-text border-b border-app-border pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                        <Shield size={16} />
                      </div>
                      {editingPolicyId ? "编辑权限策略" : "新增权限策略"}
                    </div>
                    <button
                      className="p-1 rounded-md text-app-subtle hover:bg-app-input hover:text-app-text transition-colors"
                      onClick={() => {
                        setShowScopeEditor(false);
                        resetScopeEditor();
                      }}
                    >
                      <XCircle size={18} />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Subject Type</label>
                        <select
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none cursor-pointer"
                          value={scopeForm.subject_type}
                          onChange={(e) =>
                            setScopeForm((s) => ({
                              ...s,
                              subject_type: e.target.value as DataScopePolicy["subject_type"],
                            }))
                          }
                        >
                          <option value="level">Level</option>
                          <option value="role">Role</option>
                          <option value="user_id">User ID（数字 id 或工号）</option>
                          <option value="user_name">User Name</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Subject Key</label>
                        <input
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs font-mono transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none focus:bg-app-surface"
                          placeholder="e.g. 42、XY001475、zhangsan"
                          value={scopeForm.subject_key}
                          onChange={(e) =>
                            setScopeForm((s) => ({ ...s, subject_key: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Dimension</label>
                        <select
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none cursor-pointer"
                          value={scopeForm.dimension}
                          onChange={(e) =>
                            setScopeForm((s) => ({
                              ...s,
                              dimension: e.target.value as DataScopePolicy["dimension"],
                            }))
                          }
                        >
                          <option value="province">province</option>
                          <option value="employee">employee</option>
                          <option value="region">region</option>
                          <option value="district">district</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Merge Mode</label>
                        <select
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none cursor-pointer"
                          value={scopeForm.merge_mode}
                          onChange={(e) =>
                            setScopeForm((s) => ({
                              ...s,
                              merge_mode: e.target.value as DataScopePolicy["merge_mode"],
                            }))
                          }
                        >
                          <option value="union">union</option>
                          <option value="replace">replace</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1 flex items-center justify-between">
                        <span className="text-green-500">Allowed Values</span>
                        <span className="text-[9px] font-normal opacity-60 bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded">逗号分隔 (CSV)</span>
                      </label>
                      <input
                        className="w-full rounded-xl bg-green-500/5 hover:bg-app-surface border border-green-500/20 px-3 py-2.5 text-xs transition-all focus:border-green-500/50 focus:ring-2 focus:ring-green-500/20 focus:outline-none placeholder:text-green-500/40"
                        placeholder="e.g. 广东, 广西"
                        value={scopeForm.allowed_values}
                        onChange={(e) =>
                          setScopeForm((s) => ({ ...s, allowed_values: e.target.value }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1 flex items-center justify-between">
                         <span className="text-red-500">Denied Values</span>
                         <span className="text-[9px] font-normal opacity-60 bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded">逗号分隔 (CSV)</span>
                      </label>
                      <input
                        className="w-full rounded-xl bg-red-500/5 hover:bg-app-surface border border-red-500/20 px-3 py-2.5 text-xs transition-all focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 focus:outline-none placeholder:text-red-500/40"
                        placeholder="e.g. 北京"
                        value={scopeForm.deny_values}
                        onChange={(e) =>
                          setScopeForm((s) => ({ ...s, deny_values: e.target.value }))
                        }
                      />
                    </div>

                    <div className="grid grid-cols-[80px_1fr] gap-4">
                      <div className="space-y-1.5">
                         <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Priority</label>
                        <input
                          type="number"
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs text-center font-mono transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none focus:bg-app-surface"
                          placeholder="100"
                          value={scopeForm.priority}
                          onChange={(e) =>
                            setScopeForm((s) => ({ ...s, priority: Number(e.target.value || 0) }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] uppercase text-app-subtle font-semibold ml-1">Note</label>
                        <input
                          className="w-full rounded-xl bg-app-input border border-app-border px-3 py-2 text-xs transition-all focus:border-app-accent/50 focus:ring-2 focus:ring-app-accent/20 focus:outline-none focus:bg-app-surface"
                          placeholder="添加备注信息..."
                          value={scopeForm.note}
                          onChange={(e) => setScopeForm((s) => ({ ...s, note: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 mt-2 border-t border-app-border">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className={cn("relative w-10 h-5 rounded-full transition-colors duration-300", scopeForm.enabled ? "bg-green-500" : "bg-app-border")}>
                        <div className={cn("absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform duration-300 shadow", scopeForm.enabled ? "translate-x-5" : "translate-x-0")} />
                      </div>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={scopeForm.enabled}
                        onChange={(e) =>
                          setScopeForm((s) => ({ ...s, enabled: e.target.checked }))
                        }
                      />
                      <span className={cn("text-xs font-semibold transition-colors", scopeForm.enabled ? "text-app-text" : "text-app-muted group-hover:text-app-text")}>
                        {scopeForm.enabled ? "策略已启用" : "策略已禁用"}
                      </span>
                    </label>
                    <button
                      onClick={async () => {
                        if (!scopeForm.subject_key.trim()) return alert("请填写 Subject Key");
                        setScopeSaving(true);
                        try {
                          const payload = {
                            ...scopeForm,
                            allowed_values: scopeForm.allowed_values
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                            deny_values: scopeForm.deny_values
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          };
                          if (editingPolicyId) {
                            await updateScopePolicy(editingPolicyId, payload);
                          } else {
                            await createScopePolicy(payload);
                          }
                          await loadScopePolicies();
                          resetScopeEditor();
                          setShowScopeEditor(false);
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "保存策略失败");
                        } finally {
                          setScopeSaving(false);
                        }
                      }}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-app-accent hover:bg-app-accent-hover text-white text-xs font-semibold transition-all shadow-md hover:shadow-lg shadow-app-accent/20 hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
                      disabled={scopeSaving}
                    >
                      {scopeSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {editingPolicyId ? "更新策略" : "保存新建"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
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
