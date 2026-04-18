import logging
import logging.config

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
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {"level": level, "handlers": ["console"]},
            "loggers": {
                noisy: {"level": "WARNING", "propagate": True}
                for noisy in _NOISY_LOGGERS
            },
        }
    )
