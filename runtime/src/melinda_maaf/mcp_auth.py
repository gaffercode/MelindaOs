from __future__ import annotations

import contextvars
import hashlib
import hmac
import json
import logging
import os
from contextvars import ContextVar
from pathlib import Path
from typing import Any
from collections.abc import Awaitable, Callable


ASGIApp = Callable[[dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]], Awaitable[None]]

# Optional per-producer inbound map: JSON {producerId: sha256hex(inbound bearer)}.
BEARER_MAP_ENV = "MELINDA_AGENT_MCP_BEARER_MAP_FILE"
MASTER_TOKEN_ENV = "MELINDAOS_MCP_TOKEN"
MASTER_TOKEN_HASH_ENV = "MELINDAOS_MCP_TOKEN_HASH"
# Producer recorded when the legacy single-bearer file mode is in use.
LEGACY_PRODUCER_ID = "katt-mcp"
# Every all-access MCP caller shares one identity; agent names are not distinguished.
SHARED_AGENT_ID = "ALL_ACCESS"

# Producer matched from the presented bearer for this request. Never holds a
# token or bearer value — only the producer id. Defaults to the legacy single
# producer so legacy deployments keep working without any map configured.
current_producer_id: ContextVar[str] = ContextVar("melinda_mcp_producer_id", default=LEGACY_PRODUCER_ID)

log = logging.getLogger(__name__)


def get_current_producer_id() -> str:
    """Producer id matched from the inbound bearer of the current request."""
    return current_producer_id.get()


class BearerAuthMiddleware:
    """Fail-closed bearer authentication for every MCP HTTP request."""

    def __init__(
        self,
        app: ASGIApp,
        credential_file_env: str = "MAAF_MCP_BEARER_FILE",
        *,
        allow_tokenless: bool = False,
    ) -> None:
        self.app = app
        self.credential_file_env = credential_file_env
        self.allow_tokenless = allow_tokenless

    @staticmethod
    def _is_all_access_mode() -> bool:
        for var in ("MAAF_ALL_ACCESS", "MELINDAOS_MCP_ALL_ACCESS"):
            if os.getenv(var, "").strip().lower() in {"1", "true", "yes", "all"}:
                return True
        return False

    @staticmethod
    def _master_token_hash() -> str | None:
        raw_hash = os.getenv(MASTER_TOKEN_HASH_ENV, "").strip().lower()
        if raw_hash and len(raw_hash) == 64 and all(c in "0123456789abcdef" for c in raw_hash):
            return raw_hash
        raw_token = os.getenv(MASTER_TOKEN_ENV, "").strip()
        if raw_token:
            return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        return None

    def _read_token(self) -> bytes | None:
        credential_path = os.getenv(self.credential_file_env)
        if not credential_path:
            return None
        try:
            token = Path(credential_path).read_bytes().strip()
        except OSError:
            return None
        return token or None

    def _read_bearer_map(self, map_path: str) -> dict[str, str]:
        """Read and validate the per-producer bearer map. Raises on any problem."""
        try:
            raw = Path(map_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"bearer map is not readable: {exc}") from exc
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise ValueError(f"bearer map is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("bearer map must be a JSON object of producer id to sha256 hex")
        entries: dict[str, str] = {}
        for producer, fingerprint in data.items():
            if not isinstance(producer, str) or not producer:
                raise ValueError("bearer map producer ids must be non-empty strings")
            if (
                not isinstance(fingerprint, str)
                or len(fingerprint) != 64
                or any(char not in "0123456789abcdefABCDEF" for char in fingerprint)
            ):
                raise ValueError(f"bearer map entry for producer '{producer}' is not a sha256 hex digest")
            entries[producer] = fingerprint.lower()
        return entries

    @staticmethod
    def _presented_bearer(scope: dict[str, Any]) -> bytes | None:
        authorization = [value for key, value in scope.get("headers", []) if key.lower() == b"authorization"]
        if len(authorization) != 1:
            return None
        scheme, separator, supplied = authorization[0].partition(b" ")
        if scheme.lower() != b"bearer" or not separator or not supplied:
            return None
        return supplied

    @staticmethod
    async def _reject(send: Callable[..., Awaitable[Any]], status: int, error: bytes) -> None:
        body = b'{"error":"' + error + b'"}'
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"cache-control", b"no-store"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    def _reset_producer(self, scope: dict[str, Any]) -> None:
        current_producer_id.set(LEGACY_PRODUCER_ID)
        scope.pop("melinda.producer_id", None)

    def _accept_producer(self, scope: dict[str, Any], producer: str) -> None:
        current_producer_id.set(producer)
        scope["melinda.producer_id"] = producer
        # Producer id only — bearer values are never logged.
        log.info("mcp request authenticated producer=%s", producer)

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        map_path = os.getenv(BEARER_MAP_ENV)
        if map_path:
            try:
                entries = self._read_bearer_map(map_path)
            except ValueError:
                self._reset_producer(scope)
                await self._reject(send, 503, b"authentication_not_configured")
                return
            supplied = self._presented_bearer(scope)
            if supplied is None:
                self._reset_producer(scope)
                await self._reject(send, 401, b"unauthorized")
                return
            digest = hashlib.sha256(supplied).hexdigest()
            matched: str | None = None
            for producer, expected in entries.items():
                # Compare against every entry so timing does not reveal position.
                if hmac.compare_digest(digest, expected):
                    matched = producer
            if matched is None:
                self._reset_producer(scope)
                await self._reject(send, 401, b"unauthorized")
                return
            self._accept_producer(scope, matched)
            await self.app(scope, receive, send)
            return

        master_hash = self._master_token_hash()
        if master_hash:
            authorization = [value for key, value in scope.get("headers", []) if key.lower() == b"authorization"]
            if len(authorization) != 1:
                self._reset_producer(scope)
                await self._reject(send, 401, b"unauthorized")
                return
            supplied = self._presented_bearer(scope)
            if supplied is None:
                self._reset_producer(scope)
                await self._reject(send, 401, b"unauthorized")
                return
            digest = hashlib.sha256(supplied).hexdigest()
            if not hmac.compare_digest(digest, master_hash):
                self._reset_producer(scope)
                await self._reject(send, 401, b"unauthorized")
                return
            self._accept_producer(scope, SHARED_AGENT_ID)
            await self.app(scope, receive, send)
            return

        token = self._read_token()
        if token is None:
            if self.allow_tokenless or self._is_all_access_mode():
                self._accept_producer(scope, SHARED_AGENT_ID)
                await self.app(scope, receive, send)
                return
            self._reset_producer(scope)
            await self._reject(send, 503, b"authentication_not_configured")
            return

        authorization = [value for key, value in scope.get("headers", []) if key.lower() == b"authorization"]
        if len(authorization) != 1:
            self._reset_producer(scope)
            await self._reject(send, 401, b"unauthorized")
            return
        scheme, separator, supplied = authorization[0].partition(b" ")
        if scheme.lower() != b"bearer" or not separator or not supplied or not hmac.compare_digest(token, supplied):
            self._reset_producer(scope)
            await self._reject(send, 401, b"unauthorized")
            return

        self._accept_producer(scope, LEGACY_PRODUCER_ID)
        await self.app(scope, receive, send)
