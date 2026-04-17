
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.llm_config import LLMConfig

async def dump_active_config():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LLMConfig)
        )
        configs = result.scalars().all()
        for cfg in configs:
            print(f"ID: {cfg.id}")
            print(f"Name: {cfg.name}")
            print(f"Model: {cfg.model}")
            print(f"API Base: {cfg.api_base}")
            print(f"Extra Params: {cfg.extra_params}")
            print("-" * 20)

if __name__ == "__main__":
    asyncio.run(dump_active_config())
