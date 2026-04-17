import asyncio
import litellm
import sys
from typing import Any
from unittest.mock import MagicMock
from dataclasses import dataclass

@dataclass
class Settings:
    OLLAMA_API_BASE: str = 'http://10.200.2.125:11434'
    DASHSCOPE_API_BASE: str = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    EMBEDDING_DIM: int = 1024
    VERTEXAI_LOCATION: str = 'us-central1'

mock_settings = Settings()
sys.modules['app.core.config'] = MagicMock()
sys.modules['app.core.config'].settings = mock_settings

from app.services.litellm_kwargs import build_completion_kwargs

@dataclass
class MockConfig:
    model: str
    api_key: str | None = None
    api_base: str | None = None
    extra_params: dict[str, Any] = None

async def try_chat(model_name, api_base):
    cfg = MockConfig(model=model_name, api_base=api_base)
    kwargs = build_completion_kwargs(cfg)
    print(f"\nFinal kwargs for {model_name}: {kwargs}")
    
    try:
        response = await litellm.acompletion(
            messages=[{"role": "user", "content": "hi"}],
            stream=True,
            **kwargs
        )
        print(f"Streaming response from {model_name}:")
        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                print(content, end="", flush=True)
        print("\n--- Done ---")
    except Exception as e:
        print(f"Error calling {model_name}: {e}")

async def main():
    # Try ID 8 equivalent
    await try_chat("qwen3.5:9b", "http://10.200.2.103:11434")

if __name__ == "__main__":
    asyncio.run(main())
