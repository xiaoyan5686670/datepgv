"""Extract client IP / User-Agent from Starlette/FastAPI Request (proxy-aware)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.requests import Request


def client_ip_from_request(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()[:128] or None
    if request.client and request.client.host:
        return request.client.host[:128]
    return None


def user_agent_from_request(request: Request) -> str | None:
    ua = request.headers.get("user-agent") or request.headers.get("User-Agent")
    if ua:
        return ua.strip()[:512] or None
    return None
