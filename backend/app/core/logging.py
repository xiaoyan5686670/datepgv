import logging
import logging.config
from pathlib import Path

from app.core.config import settings

# Third-party loggers that produce excessive output at INFO/DEBUG.
# They are capped at WARNING; uvicorn.error (startup/shutdown messages) is unaffected.
_NOISY_LOGGERS = [
    "litellm",
    "httpx",
    "httpcore",
    "uvicorn.access",
]


def configure_logging() -> None:
    level = settings.LOG_LEVEL.upper()

    handlers: dict = {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "stream": "ext://sys.stdout",
        }
    }
    active_handlers = ["console"]

    if settings.LOG_FILE:
        log_path = Path(settings.LOG_FILE)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers["file"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "formatter": "default",
            "filename": str(log_path),
            "maxBytes": settings.LOG_FILE_MAX_BYTES,
            "backupCount": settings.LOG_FILE_BACKUP_COUNT,
            "encoding": "utf-8",
        }
        active_handlers.append("file")

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(asctime)s %(levelname)-8s %(name)s  %(message)s",
                    "datefmt": "%Y-%m-%d %H:%M:%S",
                }
            },
            "handlers": handlers,
            "root": {"level": level, "handlers": active_handlers},
            "loggers": {
                noisy: {"level": "WARNING", "propagate": True}
                for noisy in _NOISY_LOGGERS
            },
        }
    )
