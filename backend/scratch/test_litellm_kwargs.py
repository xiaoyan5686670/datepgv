
import os
import asyncio
from typing import Any
from dataclasses import dataclass

# Mock settings
@dataclass
class Settings:
    OLLAMA_API_BASE: str = "http://10.200.2.125:11434"
    DASHSCOPE_API_BASE: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    EMBEDDING_DIM: int = 1024
    VERTEXAI_LOCATION: str = "us-central1"

# We need to mock the app.core.config.settings before importing litellm_kwargs
import sys
from unittest.mock import MagicMock

mock_settings = Settings()
sys.modules["app.core.config"] = MagicMock()
sys.modules["app.core.config"].settings = mock_settings

from app.services.litellm_kwargs import build_completion_kwargs, resolve_api_base

@dataclass
class MockConfig:
    model: str
    api_key: str | None = None
    api_base: str | None = None
    extra_params: dict[str, Any] = None

def test_routing():
    print("Testing local Qwen model routing...")
    
    # Case 1: Local Qwen with tag, no api_base in config
    cfg1 = MockConfig(model="qwen3.5:9b")
    kwargs1 = build_completion_kwargs(cfg1)
    print(f"Config: model='qwen3.5:9b', api_base=None")
    print(f"Result Model: {kwargs1['model']}")
    print(f"Result API Base: {kwargs1.get('api_base')}")
    assert kwargs1["model"] == "ollama/qwen3.5:9b"
    assert kwargs1["api_base"] == mock_settings.OLLAMA_API_BASE
    print("✓ Case 1 passed")

    # Case 2: Local Qwen without tag, but with Ollama-like api_base in config
    cfg2 = MockConfig(model="qwen-turbo", api_base="http://10.200.2.125:11434")
    kwargs2 = build_completion_kwargs(cfg2)
    print(f"Config: model='qwen-turbo', api_base='http://10.200.2.125:11434'")
    print(f"Result Model: {kwargs2['model']}")
    print(f"Result API Base: {kwargs2.get('api_base')}")
    assert kwargs2["model"] == "ollama/qwen-turbo"
    assert kwargs2["api_base"] == "http://10.200.2.125:11434"
    print("✓ Case 2 passed")

    # Case 3: Cloud Qwen (DashScope)
    cfg3 = MockConfig(model="qwen-turbo")
    kwargs3 = build_completion_kwargs(cfg3)
    print(f"Config: model='qwen-turbo', api_base=None")
    print(f"Result Model: {kwargs3['model']}")
    print(f"Result API Base: {kwargs3.get('api_base')}")
    assert kwargs3["model"] == "dashscope/qwen-turbo"
    assert "dashscope" in kwargs3["api_base"]
    print("✓ Case 3 passed")

if __name__ == "__main__":
    test_routing()
