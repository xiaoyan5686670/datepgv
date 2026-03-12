# Suppress Pydantic V2 config warning from litellm (uses deprecated 'fields' in Config)
import warnings
warnings.filterwarnings(
    "ignore",
    message=".*Valid config keys have changed in V2.*",
    category=UserWarning,
    module="pydantic._internal._config",
)

from app.core.embedding_bootstrap import run_bootstrap

run_bootstrap()  # Load embedding_dim from DB before any model import

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, config, metadata, settings as settings_router
from app.core.config import settings

app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/v1")
app.include_router(metadata.router, prefix="/api/v1")
app.include_router(config.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": settings.APP_VERSION}
