"""
Shared LiteLLM kwargs for DB-backed LLMConfig rows.
Normalizes api_base for Ollama / ollama_chat and enables drop_params where needed.
Bare Alibaba DashScope model ids (e.g. qwen-turbo) get a dashscope/ prefix so LiteLLM
can route chat completion. Embeddings: LiteLLM has no dashscope embedding route — we call
the DashScope OpenAI-compatible /embeddings API via model `openai/<model_id>` + compatible api_base.
"""
from __future__ import annotations

import ipaddress
import os
from typing import Any, Protocol
from urllib.parse import urlparse

from app.core.config import settings


class LiteLLMConfigParams(Protocol):
    """ORM row or LLMConfigRuntime — fields needed for LiteLLM routing (never cache ORM across sessions)."""

    model: str
    api_key: str | None
    api_base: str | None
    extra_params: dict[str, Any]

DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434"
# Same default as litellm.llms.dashscope.chat (intl); China: set DASHSCOPE_API_BASE or UI api_base.
DEFAULT_DASHSCOPE_COMPAT_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# 百炼 OpenAI 兼容 /embeddings 仅支持 text-embedding-v1～v4（及未来同前缀型号），不含多模态 qwen3-vl-embedding 等。
# https://help.aliyun.com/zh/model-studio/developer-reference/embedding-interfaces-compatible-with-openai


def _dashscope_openai_compat_embedding_bare_id(cfg: LiteLLMConfigParams) -> str:
    full = normalize_litellm_model(cfg.model)
    low = full.lower()
    if not low.startswith("dashscope/"):
        raise ValueError("内部错误：期望 DashScope 嵌入模型")
    bare = full.split("/", 1)[1].strip()
    if not bare:
        raise ValueError("DashScope 模型名不能为空")
    if not bare.lower().startswith("text-embedding-"):
        raise ValueError(
            f"DashScope 嵌入模型「{bare}」不能用于本应用的 OpenAI 兼容 /embeddings 调用。"
            "阿里云百炼兼容模式仅支持名称以 text-embedding- 开头的模型（如 text-embedding-v4、v3、v2、v1）。"
            "qwen3-vl-embedding 等属于多模态原生向量化接口，不在兼容列表内；"
            "请改用 text-embedding-v4（或 v2/v3），并同步调整 EMBEDDING_DIM 与数据库 vector 维度。"
        )
    return bare


def is_ollama_family(model: str) -> bool:
    m = model.lower().strip()
    return m.startswith("ollama/") or m.startswith("ollama_chat/")


def _looks_like_ollama_api_base(api_base: str | None) -> bool:
    """
    Heuristic for user-entered Ollama endpoint, e.g. http://127.0.0.1:11434.
    """
    raw = (api_base or "").strip().lower()
    if not raw:
        return False
    return "11434" in raw or "ollama" in raw


def _normalize_model_for_cfg(cfg: LiteLLMConfigParams) -> str:
    """
    Normalize model string with provider hints from config context.

    - Keep existing provider/model unchanged.
    - Check for Ollama indicators (':' tag or Ollama-like api_base) BEFORE DashScope shorthand.
    - Auto-prefix bare Ollama-style ids (e.g. gemma4:latest) to ollama/<id>.
    """
    raw = (cfg.model or "").strip()
    if not raw or "/" in raw:
        return raw

    api_base = (cfg.extra_params or {}).get("api_base") or cfg.api_base
    if (
        ":" in raw  # common Ollama tag form, e.g. llama3.2:latest
        or _looks_like_ollama_api_base(str(api_base) if api_base is not None else None)
    ):
        return f"ollama/{raw}"

    # If no Ollama indicators, fall back to general LiteLLM normalization (DashScope shorthand etc).
    return normalize_litellm_model(cfg.model)


def normalize_litellm_model(model: str) -> str:
    """
    LiteLLM requires provider/model. Users often paste DashScope console ids without
    the dashscope/ prefix, which triggers "LLM Provider NOT provided".
    """
    raw = (model or "").strip()
    if not raw or "/" in raw:
        return raw
    m = raw.lower()
    if m.startswith("qwen") or m.startswith("qwq") or m.startswith("text-embedding"):
        return f"dashscope/{raw}"
    return raw


def is_dashscope_family(model: str) -> bool:
    """True for dashscope/… or bare Qwen ids that normalize_litellm_model prefixes."""
    raw = (model or "").strip()
    if raw.lower().startswith("dashscope/"):
        return True
    return normalize_litellm_model(raw).lower().startswith("dashscope/")


def is_vertex_family(model: str) -> bool:
    """Best-effort detection for Vertex-backed Gemini routes in LiteLLM."""
    m = (model or "").strip().lower()
    return m.startswith("vertex_ai/") or m.startswith("vertex/") or m.startswith("gemini/")


def embedding_target_dimensions(cfg: LiteLLMConfigParams) -> int:
    """
    Target vector length for embeddings: extra_params.dimensions / dim override EMBEDDING_DIM.
    Must match PostgreSQL table_metadata.embedding column (vector(N)).
    """
    extra = cfg.extra_params or {}
    raw = extra.get("dimensions", extra.get("dim"))
    if raw is not None:
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
    return settings.EMBEDDING_DIM


def embedding_dimension_target_explanation(cfg: LiteLLMConfigParams) -> str:
    """Human-readable source of embedding_target_dimensions (for error messages)."""
    extra = cfg.extra_params or {}
    if extra.get("dimensions") is not None:
        return "该嵌入配置 extra_params.dimensions"
    if extra.get("dim") is not None:
        return "该嵌入配置 extra_params.dim"
    if os.environ.get("EMBEDDING_DIM") is not None:
        return "环境变量 EMBEDDING_DIM（如项目根目录 .env）"
    return (
        "应用内置默认值 config.EMBEDDING_DIM（未设置环境变量 EMBEDDING_DIM 时使用，"
        f"当前为 {settings.EMBEDDING_DIM}，通常与 init-db 的 vector(1536) 一致）"
    )


def _assert_bailian_v3_v4_dimension(model: str, dim: int) -> None:
    """百炼 v3/v4 不提供 3072 维（常见 large 模型列）；提前报错以免 404/无效请求。"""
    m = model.lower()
    if dim != 3072:
        return
    if "text-embedding-v3" in m or "text-embedding-v4" in m:
        raise ValueError(
            "百炼 text-embedding-v3 / text-embedding-v4 不支持 3072 维。"
            "若库表为 vector(3072)（常见于 text-embedding-3-large），请改用 OpenAI text-embedding-3-large，"
            "或将列改为 v4 支持的维度（如 1536、1024）并设置 EMBEDDING_DIM 与 extra_params.dimensions 后全量重嵌。"
        )


def _host_allowed_for_ollama_proxy(host: str) -> bool:
    """Restrict SSRF for server-side Ollama tag proxy; allow local/dev and Compose service names."""
    if not host:
        return False
    h = host.lower().strip("[]")
    if h in ("localhost", "host.docker.internal"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        if ip.is_link_local or ip.is_multicast:
            return False
        return ip.is_private or ip.is_loopback
    except ValueError:
        pass
    # Docker Compose single-label service host (e.g. ollama)
    if "." not in h and h.replace("-", "").replace("_", "").isalnum() and len(h) <= 63:
        return True
    return False


def assert_safe_ollama_api_base(api_base: str) -> str:
    """
    Validate user-provided api_base for GET /config/ollama/models.
    Raises ValueError with message suitable for HTTP 400.
    """
    raw = (api_base or "").strip()
    if not raw:
        raise ValueError("api_base 不能为空")
    parsed = urlparse(raw if "://" in raw else f"http://{raw}")
    if parsed.scheme not in ("http", "https"):
        raise ValueError("api_base 仅支持 http 或 https")
    host = parsed.hostname
    if not host or not _host_allowed_for_ollama_proxy(host):
        raise ValueError(
            "api_base 主机名不被允许（请使用本机、内网或 Docker 服务名，如 127.0.0.1、host.docker.internal、ollama）"
        )
    return raw.rstrip("/")


def resolve_api_base(cfg: LiteLLMConfigParams) -> str | None:
    """Effective api_base for LiteLLM; Ollama defaults when unset."""
    extra = cfg.extra_params or {}
    base = extra.get("api_base") or cfg.api_base
    if isinstance(base, str) and base.strip():
        return base.strip().rstrip("/")
    if is_ollama_family(cfg.model):
        env_or_default = (settings.OLLAMA_API_BASE or DEFAULT_OLLAMA_BASE).strip().rstrip("/")
        return env_or_default
    if is_dashscope_family(cfg.model):
        ds = (settings.DASHSCOPE_API_BASE or "").strip()
        if ds:
            return ds.rstrip("/")
        return DEFAULT_DASHSCOPE_COMPAT_BASE.rstrip("/")
    return None


def build_completion_kwargs(cfg: LiteLLMConfigParams) -> dict:
    """Kwargs for litellm.acompletion (merge messages, temperature, stream separately)."""
    normalized_model = _normalize_model_for_cfg(cfg)
    kw: dict = {"model": normalized_model}
    extra = cfg.extra_params or {}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    api_base = resolve_api_base(cfg)
    if api_base:
        kw["api_base"] = api_base
    # Allow provider-specific routing params from UI config.
    for key in ("project", "vertex_project", "google_project", "location", "vertex_location"):
        val = extra.get(key)
        if val is not None and str(val).strip():
            kw[key] = val
    if is_vertex_family(normalized_model):
        loc = str(
            extra.get("vertex_location")
            or extra.get("location")
            or settings.VERTEXAI_LOCATION
        ).strip()
        if loc:
            # Set both names for compatibility across LiteLLM/provider adapters.
            kw.setdefault("vertex_location", loc)
            kw.setdefault("location", loc)
    if is_ollama_family(normalized_model):
        kw["drop_params"] = True
    return kw


def build_embedding_kwargs(cfg: LiteLLMConfigParams) -> dict:
    """Kwargs for litellm.aembedding (caller adds input)."""
    if is_dashscope_family(cfg.model):
        # LiteLLM implements DashScope for chat only; aembedding raises LiteLLMUnknownProvider for
        # custom_llm_provider=dashscope. DashScope exposes OpenAI-compatible embeddings — use openai route.
        suffix = _dashscope_openai_compat_embedding_bare_id(cfg)
        kw = {"model": f"openai/{suffix}"}
    else:
        normalized_model = _normalize_model_for_cfg(cfg)
        kw = {"model": normalized_model}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    extra = cfg.extra_params or {}
    api_base = resolve_api_base(cfg)
    if api_base:
        kw["api_base"] = api_base
    for key in ("project", "vertex_project", "google_project", "location", "vertex_location"):
        val = extra.get(key)
        if val is not None and str(val).strip():
            kw[key] = val
    if is_vertex_family(kw["model"]):
        loc = str(
            extra.get("vertex_location")
            or extra.get("location")
            or settings.VERTEXAI_LOCATION
        ).strip()
        if loc:
            kw.setdefault("vertex_location", loc)
            kw.setdefault("location", loc)
    if is_ollama_family(kw["model"]):
        kw["drop_params"] = True

    # DashScope 嵌入走 openai/ + 百炼 api_base；LiteLLM 在 custom_llm_provider=openai 时若传入
    # dimensions 且 model 名不含子串 "text-embedding-3"，会误报 UnsupportedParamsError
    #（text-embedding-v3 / v4 都不含该子串）。故不向 LiteLLM 传 dimensions，用百炼默认输出维度。
    if is_dashscope_family(cfg.model):
        m = kw["model"].lower()
        if "text-embedding-v3" in m or "text-embedding-v4" in m:
            _assert_bailian_v3_v4_dimension(
                kw["model"], embedding_target_dimensions(cfg)
            )
        kw["drop_params"] = True
    return kw
