"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createConfig, fetchOllamaModels, updateConfig } from "@/lib/api";
import type { LLMConfig, LLMConfigCreate } from "@/types";

// Common model presets for quick selection (LiteLLM: ollama_chat is recommended for chat)
const LLM_PRESETS = [
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "GPT-4o-mini", value: "openai/gpt-4o-mini" },
  { label: "Gemini 2.0 Flash", value: "gemini/gemini-2.0-flash" },
  { label: "Gemini 1.5 Pro", value: "gemini/gemini-1.5-pro" },
  { label: "DeepSeek Coder V2", value: "deepseek/deepseek-coder" },
  {
    label: "阿里云 DashScope — qwen-turbo",
    value: "dashscope/qwen-turbo",
  },
  {
    label: "阿里云 DashScope — qwen-plus",
    value: "dashscope/qwen-plus",
  },
  {
    label: "阿里云 DashScope — qwen-max",
    value: "dashscope/qwen-max",
  },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet-20241022" },
  { label: "Ollama Chat — llama3.2（推荐）", value: "ollama_chat/llama3.2" },
  { label: "Ollama Chat — qwen2.5-coder", value: "ollama_chat/qwen2.5-coder" },
  { label: "Ollama 旧接口 — ollama/…", value: "ollama/qwen2.5-coder" },
  { label: "自定义...", value: "__custom__" },
];

const EMBEDDING_PRESETS = [
  {
    label: "DashScope text-embedding-v4（兼容 /embeddings；维度见百炼文档）",
    value: "dashscope/text-embedding-v4",
  },
  {
    label: "DashScope text-embedding-v2 (常见1536d，请先连接测试)",
    value: "dashscope/text-embedding-v2",
  },
  { label: "text-embedding-3-small (1536d)", value: "openai/text-embedding-3-small" },
  { label: "text-embedding-3-large (3072d)", value: "openai/text-embedding-3-large" },
  { label: "Gemini text-embedding-004 (768d)", value: "gemini/text-embedding-004" },
  { label: "Ollama嵌入 nomic-embed-text (768d)", value: "ollama/nomic-embed-text" },
  { label: "自定义...", value: "__custom__" },
];

function isOllamaModelString(m: string): boolean {
  const s = m.trim().toLowerCase();
  return s.startsWith("ollama/") || s.startsWith("ollama_chat/");
}

interface LLMConfigModalProps {
  configType: "llm" | "embedding";
  existing?: LLMConfig;
  onSuccess: (cfg: LLMConfig) => void;
  onClose: () => void;
}

export function LLMConfigModal({
  configType,
  existing,
  onSuccess,
  onClose,
}: LLMConfigModalProps) {
  const isEdit = !!existing;
  const presets = configType === "llm" ? LLM_PRESETS : EMBEDDING_PRESETS;

  const [name, setName] = useState(existing?.name ?? "");
  const [selectedPreset, setSelectedPreset] = useState("__custom__");
  const [model, setModel] = useState(existing?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState(existing?.api_base ?? "");
  const [extraParams, setExtraParams] = useState(
    existing ? JSON.stringify(existing.extra_params, null, 2) : "{}"
  );
  const [extraParamsError, setExtraParamsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaFetchLoading, setOllamaFetchLoading] = useState(false);
  const [ollamaFetchError, setOllamaFetchError] = useState("");
  const showOllamaHelper = isOllamaModelString(model);

  // When preset changes, autofill model string
  useEffect(() => {
    if (selectedPreset !== "__custom__") {
      setModel(selectedPreset);
    }
  }, [selectedPreset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate extra_params JSON
    let parsedExtra: Record<string, unknown> = {};
    try {
      parsedExtra = JSON.parse(extraParams || "{}");
    } catch {
      setExtraParamsError("不是合法的 JSON 格式");
      return;
    }
    setExtraParamsError("");

    setLoading(true);
    try {
      const payload: LLMConfigCreate = {
        name: name.trim(),
        config_type: configType,
        model: model.trim(),
        api_key: apiKey || undefined,
        api_base: apiBase.trim() || undefined,
        extra_params: parsedExtra,
      };

      let result: LLMConfig;
      if (isEdit) {
        result = await updateConfig(existing!.id, payload);
      } else {
        result = await createConfig(payload);
      }
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const handleFetchOllamaModels = async () => {
    setOllamaFetchError("");
    setOllamaFetchLoading(true);
    try {
      const base = apiBase.trim() || "http://127.0.0.1:11434";
      const list = await fetchOllamaModels(base);
      setOllamaModels(list);
      if (!list.length) {
        setOllamaFetchError("未返回任何模型，请在本机执行 ollama pull <model> 后再试。");
      }
    } catch (e) {
      setOllamaFetchError(e instanceof Error ? e.message : "获取失败");
      setOllamaModels([]);
    } finally {
      setOllamaFetchLoading(false);
    }
  };

  const typeLabel = configType === "llm" ? "LLM 模型" : "Embedding 模型";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-app-surface border border-app-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-app-surface border-b border-app-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-app-text">
            {isEdit ? "编辑" : "新增"} {typeLabel} 配置
          </h2>
          <button onClick={onClose} className="text-app-muted hover:text-app-text">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              配置名称 <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：我的 Gemini 配置"
              required
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          {/* Model preset selector */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              模型预设
            </label>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text outline-none focus:border-app-accent/50"
            >
              <option value="__custom__">自定义输入</option>
              {presets.filter((p) => p.value !== "__custom__").map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model string */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              Model String <span className="text-red-400">*</span>
              <span className="ml-2 text-app-subtle">
                （LiteLLM 格式，如 gemini/gemini-2.0-flash）
              </span>
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="provider/model-name"
              required
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text font-mono placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              API Key
              <span className="ml-2 text-app-subtle font-normal">（Ollama 一般留空）</span>
              {isEdit && existing?.api_key_set && (
                <span className="ml-2 text-green-400">（已设置，留空则保持不变）</span>
              )}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit && existing?.api_key_set ? "留空保持现有 Key" : "sk-... 或 AIza..."}
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          {/* API Base */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              API Base URL
              <span className="ml-2 text-app-subtle">（可选，Ollama / 私有代理时填写）</span>
            </label>
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text font-mono placeholder:text-app-subtle outline-none focus:border-app-accent/50"
            />
          </div>

          {showOllamaHelper && (
            <div className="rounded-lg border border-app-accent/25 bg-app-accent/5 px-3 py-3 space-y-2 text-xs text-app-muted">
              <p>
                <span className="text-app-text">Ollama：</span>
                本机通常填{" "}
                <code className="text-app-accent">http://127.0.0.1:11434</code>
                ；Docker 内后端访问宿主机可试{" "}
                <code className="text-app-accent">http://host.docker.internal:11434</code>
                。
                {configType === "llm" ? (
                  <>
                    {" "}
                    LLM 对话推荐使用{" "}
                    <code className="text-app-accent">ollama_chat/模型名</code>。
                  </>
                ) : (
                  <>
                    {" "}
                    Embedding 使用{" "}
                    <code className="text-app-accent">ollama/模型名</code>（注意向量维度须与库表一致）。
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleFetchOllamaModels}
                  disabled={ollamaFetchLoading}
                  className="px-3 py-1.5 rounded-lg bg-app-accent/20 text-app-accent border border-app-accent/40 text-xs font-medium hover:bg-app-accent/30 disabled:opacity-50"
                >
                  {ollamaFetchLoading ? "获取中…" : "获取模型列表"}
                </button>
                {ollamaModels.length > 0 && (
                  <select
                    className="flex-1 min-w-[12rem] bg-app-input border border-app-border rounded-lg px-2 py-1.5 text-sm text-app-text"
                    defaultValue=""
                    onChange={(e) => {
                      const name = e.target.value;
                      e.target.value = "";
                      if (!name) return;
                      const useChat =
                        configType === "llm" &&
                        model.trim().toLowerCase().startsWith("ollama_chat/");
                      setSelectedPreset("__custom__");
                      setModel(useChat ? `ollama_chat/${name}` : `ollama/${name}`);
                    }}
                  >
                    <option value="">选择已安装的模型填入上方 Model String…</option>
                    {ollamaModels.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {ollamaFetchError && (
                <p className="text-red-400 font-mono break-all">{ollamaFetchError}</p>
              )}
            </div>
          )}

          {/* Extra params */}
          <div>
            <label className="block text-xs text-app-muted mb-1.5">
              额外参数
              <span className="ml-2 text-app-subtle">（JSON 格式，如 temperature、dim）</span>
            </label>
            <textarea
              value={extraParams}
              onChange={(e) => {
                setExtraParams(e.target.value);
                setExtraParamsError("");
              }}
              rows={4}
              className={cn(
                "w-full bg-app-input border rounded-lg px-3 py-2 text-sm text-app-text font-mono placeholder:text-app-subtle outline-none resize-none",
                extraParamsError ? "border-red-400/50" : "border-app-border focus:border-app-accent/50"
              )}
            />
            {extraParamsError && (
              <p className="text-xs text-red-400 mt-1">{extraParamsError}</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-app-border text-sm text-app-muted hover:text-app-text transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-app-accent hover:bg-app-accent-hover disabled:bg-app-border text-white text-sm font-medium transition-colors"
            >
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
