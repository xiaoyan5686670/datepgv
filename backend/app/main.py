from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin_rag_permission,
    audit,
    auth,
    chat,
    config,
    metadata,
    rag,
    sql_skills,
    stats_chat_queries,
    users,
)
from app.core.config import settings
from app.core.migrations import run_migrations


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    await run_migrations()
    yield


app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(metadata.router, prefix="/api/v1")
app.include_router(config.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(rag.router, prefix="/api/v1")
app.include_router(sql_skills.router, prefix="/api/v1")
app.include_router(stats_chat_queries.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(admin_rag_permission.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.APP_VERSION}
