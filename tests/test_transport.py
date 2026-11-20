import io
import json
from urllib import error

import pytest

from melinda_maaf import transport

ENVELOPE = {"request_id": "req-123", "tool": "melinda.finance.summary", "payload": {}}


class _Response(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200):
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def captured(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout):
        calls.append(req)
        return _Response(json.dumps({"status": "accepted", "id": "a1"}).encode("utf-8"))

    monkeypatch.setattr(transport.request, "urlopen", fake_urlopen)
    monkeypatch.delenv("MAAF_GATEWAY_BEARER_FILE", raising=False)
    return calls


def test_missing_backend_url_requires_configuration(monkeypatch, captured):
    monkeypatch.delenv("MAAF_BACKEND_URL", raising=False)

    result = transport.dispatch_envelope(ENVELOPE)

    assert result["status"] == "configuration_required"
    assert captured == []


@pytest.mark.parametrize("url", ["http://maaf.example.com", "file:///etc/passwd", "ftp://maaf.example.com", "http://localhost.evil.com"])
def test_insecure_backend_url_is_rejected_without_request(monkeypatch, captured, url):
    monkeypatch.setenv("MAAF_BACKEND_URL", url)

    result = transport.dispatch_envelope(ENVELOPE)

    assert result["status"] == "configuration_required"
    assert captured == []


@pytest.mark.parametrize("url", ["https://maaf.example.com", "http://localhost:8080", "http://127.0.0.1:9000/"])
def test_https_or_loopback_backend_url_is_dispatched(monkeypatch, captured, url):
    monkeypatch.setenv("MAAF_BACKEND_URL", url)

    result = transport.dispatch_envelope(ENVELOPE)

    assert result == {"status": "accepted", "id": "a1"}
    assert captured[0].full_url == f"{url.rstrip('/')}/v1/actions"
    assert json.loads(captured[0].data) == ENVELOPE


def test_empty_response_body_is_accepted_with_http_status(monkeypatch):
    monkeypatch.setenv("MAAF_BACKEND_URL", "https://maaf.example.com")
    monkeypatch.setattr(transport.request, "urlopen", lambda req, timeout: _Response(b"", status=202))

    assert transport.dispatch_envelope(ENVELOPE) == {"status": "accepted", "http_status": 202}


@pytest.mark.parametrize(
    "exc",
    [
        error.HTTPError("https://maaf.example.com/v1/actions", 503, "Service Unavailable", {}, None),
        error.URLError("connection refused"),
        TimeoutError("timed out"),
    ],
)
def test_transport_failures_are_normalized(monkeypatch, exc):
    monkeypatch.setenv("MAAF_BACKEND_URL", "https://maaf.example.com")

    def failing_urlopen(req, timeout):
        raise exc

    monkeypatch.setattr(transport.request, "urlopen", failing_urlopen)

    assert transport.dispatch_envelope(ENVELOPE)["status"] == "transport_error"


def test_bearer_token_file_adds_authorization_header(monkeypatch, captured, tmp_path):
    token_file = tmp_path / "bearer"
    token_file.write_text("secret-token\n", encoding="utf-8")
    monkeypatch.setenv("MAAF_BACKEND_URL", "https://maaf.example.com")
    monkeypatch.setenv("MAAF_GATEWAY_BEARER_FILE", str(token_file))

    transport.dispatch_envelope(ENVELOPE)

    assert captured[0].get_header("Authorization") == "Bearer secret-token"


def test_idempotency_key_equals_request_id(monkeypatch, captured):
    monkeypatch.setenv("MAAF_BACKEND_URL", "https://maaf.example.com")

    transport.dispatch_envelope(ENVELOPE)

    assert captured[0].get_header("Idempotency-key") == "req-123"
    assert captured[0].get_header("Authorization") is None
