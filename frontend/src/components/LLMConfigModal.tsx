"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createConfig, updateConfig } from "@/lib/api";
import type { LLMConfig, LLMConfigCreate } from "@/types";

// Common model presets for quick selection
const LLM_PRESETS = [
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "GPT-4o-mini", value: "openai/gpt-4o-mini" },
  { label: "Gemini 2.0 Flash", value: "gemini/gemini-2.0-flash" },
  { label: "Gemini 1.5 Pro", value: "gemini/gemini-1.5-pro" },
  { label: "DeepSeek Coder V2", value: "deepseek/deepseek-coder" },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet-20241022" },
  { label: "Ollama (本地)", value: "ollama/qwen2.5-coder:32b" },
  { label: "自定义...", value: "__custom__" },
];

const EMBEDDING_PRESETS = [
  { label: "text-embedding-3-small (1536d)", value: "openai/text-embedding-3-small" },
  { label: "text-embedding-3-large (3072d)", value: "openai/text-embedding-3-large" },
  { label: "Gemini text-embedding-004 (768d)", value: "gemini/text-embedding-004" },
  { label: "Ollama nomic-embed-text (768d)", value: "ollama/nomic-embed-text" },
  { label: "自定义...", value: "__custom__" },
];

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

  const typeLabel = configType === "llm" ? "LLM 模型" : "Embedding 模型";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1d27] border border-[#2a2d3d] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1a1d27] border-b border-[#2a2d3d] px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#e2e8f0]">
            {isEdit ? "编辑" : "新增"} {typeLabel} 配置
          </h2>
          <button onClick={onClose} className="text-[#8892a4] hover:text-[#e2e8f0]">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">
              配置名称 <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：我的 Gemini 配置"
              required
              className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50"
            />
          </div>

          {/* Model preset selector */}
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">
              模型预设
            </label>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] outline-none focus:border-[#0ea5e9]/50"
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
            <label className="block text-xs text-[#8892a4] mb-1.5">
              Model String <span className="text-red-400">*</span>
              <span className="ml-2 text-[#4a5568]">
                （LiteLLM 格式，如 gemini/gemini-2.0-flash）
              </span>
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="provider/model-name"
              required
              className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] font-mono placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">
              API Key
              {isEdit && existing?.api_key_set && (
                <span className="ml-2 text-green-400">（已设置，留空则保持不变）</span>
              )}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit && existing?.api_key_set ? "留空保持现有 Key" : "sk-... 或 AIza..."}
              className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50"
            />
          </div>

          {/* API Base */}
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">
              API Base URL
              <span className="ml-2 text-[#4a5568]">（可选，Ollama / 私有代理时填写）</span>
            </label>
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full bg-[#12151f] border border-[#2a2d3d] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] font-mono placeholder-[#4a5568] outline-none focus:border-[#0ea5e9]/50"
            />
          </div>

          {/* Extra params */}
          <div>
            <label className="block text-xs text-[#8892a4] mb-1.5">
              额外参数
              <span className="ml-2 text-[#4a5568]">（JSON 格式，如 temperature、dim）</span>
            </label>
            <textarea
              value={extraParams}
              onChange={(e) => {
                setExtraParams(e.target.value);
                setExtraParamsError("");
              }}
              rows={4}
              className={cn(
                "w-full bg-[#12151f] border rounded-lg px-3 py-2 text-sm text-[#e2e8f0] font-mono placeholder-[#4a5568] outline-none resize-none",
                extraParamsError ? "border-red-400/50" : "border-[#2a2d3d] focus:border-[#0ea5e9]/50"
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
              className="flex-1 py-2.5 rounded-xl border border-[#2a2d3d] text-sm text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-[#0ea5e9] hover:bg-[#0284c7] disabled:bg-[#2a2d3d] text-white text-sm font-medium transition-colors"
            >
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
