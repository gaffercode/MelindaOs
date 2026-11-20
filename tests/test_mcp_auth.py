import asyncio
import importlib
import importlib.util


def middleware_type():
    spec = importlib.util.find_spec("melinda_maaf.mcp_auth")
    assert spec is not None, "MCP ingress must require an authenticated bearer"
    return importlib.import_module("melinda_maaf.mcp_auth").BearerAuthMiddleware


def request(middleware, headers=()):
    messages = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "method": "POST", "path": "/mcp", "headers": list(headers)}
    asyncio.run(middleware(app)(scope, receive, send))
    return messages


def test_mcp_ingress_fails_closed_without_server_credential(monkeypatch):
    monkeypatch.delenv("MAAF_MCP_BEARER_FILE", raising=False)

    response = request(middleware_type())

    assert response[0]["status"] == 503


def test_mcp_ingress_rejects_missing_and_invalid_bearer(tmp_path, monkeypatch):
    credential_file = tmp_path / "mcp-bearer.txt"
    credential_file.write_text("synthetic-mcp-bearer", encoding="utf-8")
    monkeypatch.setenv("MAAF_MCP_BEARER_FILE", str(credential_file))
    middleware = middleware_type()

    assert request(middleware)[0]["status"] == 401
    assert request(middleware, [(b"authorization", b"Bearer wrong")])[0]["status"] == 401


def test_mcp_ingress_forwards_only_a_valid_bearer(tmp_path, monkeypatch):
    credential_file = tmp_path / "mcp-bearer.txt"
    credential_file.write_text("synthetic-mcp-bearer", encoding="utf-8")
    monkeypatch.setenv("MAAF_MCP_BEARER_FILE", str(credential_file))

    response = request(middleware_type(), [(b"authorization", b"Bearer synthetic-mcp-bearer")])

    assert response[0]["status"] == 204


def test_mcp_ingress_rejects_duplicate_authorization_headers(tmp_path, monkeypatch):
    credential_file = tmp_path / "mcp-bearer.txt"
    credential_file.write_text("synthetic-mcp-bearer", encoding="utf-8")
    monkeypatch.setenv("MAAF_MCP_BEARER_FILE", str(credential_file))

    response = request(middleware_type(), [
        (b"authorization", b"Bearer synthetic-mcp-bearer"),
        (b"authorization", b"Bearer synthetic-mcp-bearer"),
    ])

    assert response[0]["status"] == 401
