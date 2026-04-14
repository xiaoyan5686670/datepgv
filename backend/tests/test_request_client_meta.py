from __future__ import annotations

from unittest.mock import MagicMock

from app.services.request_client_meta import client_ip_from_request, user_agent_from_request


def test_client_ip_prefers_x_forwarded_for_first_hop() -> None:
    req = MagicMock()
    req.headers = MagicMock()

    def _get(key: str, default=None):  # type: ignore[no-untyped-def]
        k = (key or "").lower()
        if k == "x-forwarded-for":
            return "203.0.113.1, 10.0.0.1"
        return default

    req.headers.get.side_effect = _get
    req.client = MagicMock()
    req.client.host = "127.0.0.1"
    assert client_ip_from_request(req) == "203.0.113.1"


def test_client_ip_falls_back_to_client_host() -> None:
    req = MagicMock()
    req.headers = MagicMock()
    req.headers.get.return_value = None
    req.client = MagicMock()
    req.client.host = "198.51.100.2"
    assert client_ip_from_request(req) == "198.51.100.2"


def test_user_agent_truncation_and_strip() -> None:
    req = MagicMock()
    req.headers = MagicMock()

    def _get(key: str, default=None):  # type: ignore[no-untyped-def]
        if (key or "").lower() == "user-agent":
            return "  MyBot/1.0  "
        return default

    req.headers.get.side_effect = _get
    assert user_agent_from_request(req) == "MyBot/1.0"
