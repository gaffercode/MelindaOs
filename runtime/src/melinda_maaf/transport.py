from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib import parse, request


def _read_bearer() -> str | None:
    path = os.getenv("MAAF_GATEWAY_BEARER_FILE")
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    token = p.read_text(encoding="utf-8").strip()
    return token or None


def _is_trusted_url(url: str) -> bool:
    parsed = parse.urlsplit(url)
    if parsed.scheme == "https":
        return bool(parsed.hostname)
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}


def dispatch_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    """Dispatch an approved envelope to the MAAF execution backend.

    The backend owns provider credentials, idempotency, retries, audit storage,
    and final authorization. The MCP layer never receives provider tokens.
    """
    base = os.getenv("MAAF_BACKEND_URL", "").rstrip("/")
    if not base:
        return {"status": "configuration_required", "reason": "MAAF_BACKEND_URL is not configured"}
    if not _is_trusted_url(base):
        return {"status": "configuration_required", "reason": "MAAF_BACKEND_URL must use https (http only for localhost)"}

    body = json.dumps(envelope).encode("utf-8")
    headers = {"Content-Type": "application/json", "Idempotency-Key": envelope["request_id"]}
    bearer = _read_bearer()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = request.Request(f"{base}/v1/actions", data=body, headers=headers, method="POST")
    timeout = float(os.getenv("MAAF_REQUEST_TIMEOUT_SECONDS", "20"))
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {"status": "accepted", "http_status": response.status}
    except Exception as exc:  # transport errors are normalized for agent retry logic
        return {"status": "transport_error", "reason": str(exc)}
