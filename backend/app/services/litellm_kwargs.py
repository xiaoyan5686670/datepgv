"""
Shared LiteLLM kwargs for DB-backed LLMConfig rows.
Normalizes api_base for Ollama / ollama_chat and enables drop_params where needed.
Bare Alibaba DashScope model ids (e.g. qwen-turbo) get a dashscope/ prefix so LiteLLM
can route chat completion. Embeddings: LiteLLM has no dashscope embedding route — we call
the DashScope OpenAI-compatible /embeddings API via model `openai/<model_id>` + compatible api_base.
"""
from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.core.config import settings
from app.models.llm_config import LLMConfig

DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434"
# Same default as litellm.llms.dashscope.chat (intl); China: set DASHSCOPE_API_BASE or UI api_base.
DEFAULT_DASHSCOPE_COMPAT_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# 百炼 OpenAI 兼容 /embeddings 仅支持 text-embedding-v1～v4（及未来同前缀型号），不含多模态 qwen3-vl-embedding 等。
# https://help.aliyun.com/zh/model-studio/developer-reference/embedding-interfaces-compatible-with-openai


def _dashscope_openai_compat_embedding_bare_id(cfg: LLMConfig) -> str:
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


def embedding_target_dimensions(cfg: LLMConfig) -> int:
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


def resolve_api_base(cfg: LLMConfig) -> str | None:
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


def build_completion_kwargs(cfg: LLMConfig) -> dict:
    """Kwargs for litellm.acompletion (merge messages, temperature, stream separately)."""
    kw: dict = {"model": normalize_litellm_model(cfg.model)}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    api_base = resolve_api_base(cfg)
    if api_base:
        kw["api_base"] = api_base
    if is_ollama_family(cfg.model):
        kw["drop_params"] = True
    return kw


def build_embedding_kwargs(cfg: LLMConfig) -> dict:
    """Kwargs for litellm.aembedding (caller adds input)."""
    if is_dashscope_family(cfg.model):
        # LiteLLM implements DashScope for chat only; aembedding raises LiteLLMUnknownProvider for
        # custom_llm_provider=dashscope. DashScope exposes OpenAI-compatible embeddings — use openai route.
        suffix = _dashscope_openai_compat_embedding_bare_id(cfg)
        kw = {"model": f"openai/{suffix}"}
    else:
        kw = {"model": normalize_litellm_model(cfg.model)}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    api_base = resolve_api_base(cfg)
    if api_base:
        kw["api_base"] = api_base
    if is_ollama_family(cfg.model):
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
