
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.chat import ChatMessage

async def dump_recent_messages():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(5)
        )
        msgs = result.scalars().all()
        for m in reversed(msgs):
            print(f"Time: {m.created_at}")
            print(f"Role: {m.role}")
            print(f"Content: {m.content[:200]}...")
            print(f"SQL: {m.generated_sql}")
            print(f"Error: {m.exec_error}")
            print("-" * 20)

if __name__ == "__main__":
    asyncio.run(dump_recent_messages())
