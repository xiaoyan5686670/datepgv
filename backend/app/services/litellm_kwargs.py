"""
Shared LiteLLM kwargs for DB-backed LLMConfig rows.
Normalizes api_base for Ollama / ollama_chat and enables drop_params where needed.
Bare Alibaba DashScope model ids (e.g. qwen-turbo) get a dashscope/ prefix so LiteLLM
can route the request.
"""
from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.core.config import settings
from app.models.llm_config import LLMConfig

DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434"


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
    kw: dict = {"model": normalize_litellm_model(cfg.model)}
    if cfg.api_key:
        kw["api_key"] = cfg.api_key
    api_base = resolve_api_base(cfg)
    if api_base:
        kw["api_base"] = api_base
    if is_ollama_family(cfg.model):
        kw["drop_params"] = True
    return kw
