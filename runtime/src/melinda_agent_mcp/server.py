from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

import yaml
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import Icon, ToolAnnotations

from melinda_maaf.gateway import prepare_action
from melinda_maaf.mcp_auth import SHARED_AGENT_ID, BearerAuthMiddleware, get_current_producer_id
from melinda_maaf.tool_contracts import (
    allowed_roles_for,
    load_tool_contracts,
    risk_for,
)
from melinda_maaf.transport import dispatch_envelope

TOOL_ALLOWLIST_ENV = "MELINDA_AGENT_MCP_TOOL_ALLOWLIST"
ALLOWED_HOSTS_ENV = "MELINDA_AGENT_MCP_ALLOWED_HOSTS"
ALLOWED_HOSTS_FALLBACK_ENV = "MCP_ALLOWED_HOSTS"

_LOCALHOST_HOSTS = ("127.0.0.1:*", "localhost:*", "[::1]:*")
_LOCALHOST_ORIGINS = ("http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*")
_KNOWLEDGE_FOLDERS = (
    "01_HOSPITAL",
    "02_PATIENT_ACCESS",
    "03_INSURANCE",
    "04_BPJS",
    "05_REFERRAL",
    "06_CLINICAL_SAFETY",
    "07_LEGAL_REGULATORY",
    "08_AGENT_POLICY",
    "09_AGENT_ARCHITECTURE",
    "10_TOOL_CONTRACTS",
    "11_MACHINE_READABLE",
)
_GOVERNED_ROOTS = ("knowledge", "docs", "dashboard/schemas")
_SKIP_PARTS = {".git", ".venv", "__pycache__", "node_modules", ".next", "coverage", "sources"}
# The agent's own rules and tool grants are human-owned; APPROVED is a human review outcome, never an agent write.
_WRITE_PROTECTED_FOLDERS = ("08_AGENT_POLICY", "09_AGENT_ARCHITECTURE", "10_TOOL_CONTRACTS")
_APPROVED_STATUS = re.compile(r"""(?im)(?:^|[\s{,])"?status"?\s*:\s*["']?approved\b""")

_READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
_WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

MCP_LOGO_URL = "https://melindaos.app/brand/melindaos-logo.png"
MCP_ICONS = [
    Icon(src=MCP_LOGO_URL, mime_type="image/png", sizes=["512x512"]),
    Icon(src="https://melindaos.app/branding/rsia-melinda-logo-official.png", mime_type="image/png", sizes=["512x512"]),
]

AGENT_INSTRUCTIONS = """\
Pintu tunggal MelindaOS untuk agent. Semua pemanggil memakai satu identitas: ALL_ACCESS.
1. Mulai dengan agent_overview untuk melihat jumlah dokumen dan tool MAAF.
2. Fakta rumah sakit: knowledge_search lalu knowledge_get. Status DRAF bukan fakta final; utamakan APPROVED.
3. Docs dan schema repo: files_list lalu file_read.
4. Data live dashboard (jadwal, Task Vault, Morning Brief, Warta, Medify): dashboard_mcp_call.
5. Tool rumah sakit MAAF: maaf_call. Belum ada backend, jadi hasilnya hanya envelope lokal. Tool L3/L4 membalas approval_required dan L5 human_only.
6. knowledge_write hanya untuk draf: folder 08_AGENT_POLICY dan 10_TOOL_CONTRACTS serta status APPROVED ditolak.
7. knowledge_write, dashboard_mcp_call untuk tool tulis, dan maaf_call mengubah atau menyiapkan aksi nyata: minta persetujuan manusia dulu.
Jangan mengarang fakta klinis, regulasi, atau jadwal; sebutkan sumber dan ketidakpastian."""

mcp = MCPServer(
    "MelindaOS All-Access Agent MCP",
    title="MelindaOS All-Access MCP",
    instructions=AGENT_INSTRUCTIONS,
    website_url="https://melindaos.app",
    icons=MCP_ICONS,
)


def repo_root() -> Path:
    configured = os.getenv("MELINDAOS_ROOT", "").strip()
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[3]


def _parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def allowed_tool_names() -> frozenset[str] | None:
    """Return explicit allowlist if restricted; None or '*' means all tools enabled."""
    raw = os.getenv(TOOL_ALLOWLIST_ENV, "").strip()
    if not raw or raw == "*" or raw.upper() == "ALL":
        return None
    items = frozenset(_parse_csv(raw))
    if "*" in items or "ALL" in items:
        return None
    return items


def is_tool_allowed(name: str) -> bool:
    allowed = allowed_tool_names()
    return allowed is None or name in allowed


def allowed_hosts() -> list[str]:
    raw = os.getenv(ALLOWED_HOSTS_ENV, "") or os.getenv(ALLOWED_HOSTS_FALLBACK_ENV, "")
    hosts = list(_LOCALHOST_HOSTS)
    for host in _parse_csv(raw):
        if host not in hosts:
            hosts.append(host)
        if ":" not in host and not host.startswith("[") and f"{host}:*" not in hosts:
            hosts.append(f"{host}:*")
    return hosts


def transport_security_settings() -> TransportSecuritySettings:
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed_hosts(),
        allowed_origins=list(_LOCALHOST_ORIGINS),
    )


def create_app() -> BearerAuthMiddleware:
    return BearerAuthMiddleware(
        mcp.streamable_http_app(transport_security=transport_security_settings()),
        credential_file_env="MELINDA_AGENT_MCP_BEARER_FILE",
        allow_tokenless=True,
    )


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            fm_raw = "\n".join(lines[1:idx])
            body = "\n".join(lines[idx + 1 :])
            try:
                parsed = yaml.safe_load(fm_raw)
                return (parsed if isinstance(parsed, dict) else {}), body
            except yaml.YAMLError:
                return {}, text
    return {}, text


def _category_for(rel_path: str) -> str | None:
    name = Path(rel_path).name
    if rel_path.endswith(".prompt.md") or rel_path.startswith("knowledge/08_AGENT_POLICY/") or rel_path.startswith("knowledge/09_AGENT_ARCHITECTURE/"):
        return "B" if name.endswith(".md") else None
    if name.endswith(".json") and (rel_path.startswith("knowledge/11_MACHINE_READABLE/") or name.startswith("schema-")):
        return "C"
    if name.endswith(".md"):
        return "A"
    return None


def _declared_status(rel_path: str, raw: str) -> str:
    """The status the readers below would see, parsed the same way, so a write check cannot be fooled by YAML or JSON spelling."""
    if rel_path.endswith(".json"):
        try:
            data = json.loads(raw)
        except ValueError:
            return ""
        gov = data.get("governance") if isinstance(data, dict) else None
        status = (gov.get("status") if isinstance(gov, dict) else None) or (data.get("status") if isinstance(data, dict) else None)
        return str(status or "")
    fm, _ = _split_frontmatter(raw)
    gov = fm.get("governance") if isinstance(fm.get("governance"), dict) else {}
    return str(gov.get("status") or fm.get("status") or "")


def _doc_record(root: Path, file_path: Path) -> dict[str, Any] | None:
    rel = file_path.relative_to(root).as_posix()
    category = _category_for(rel)
    if category is None:
        return None
    try:
        raw = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    if category == "C":
        try:
            data = json.loads(raw)
        except ValueError:
            return None
        gov = data.get("governance") if isinstance(data, dict) else None
        status = gov.get("status") if isinstance(gov, dict) else "DRAF"
        title = (data.get("title") if isinstance(data, dict) else None) or file_path.stem
        return {
            "path": rel,
            "category": "C",
            "doc_id": "",
            "title": str(title),
            "domain": "Machine readable",
            "department": "",
            "status": str(status or "DRAF"),
            "raw": raw,
        }

    fm, body = _split_frontmatter(raw)
    gov = fm.get("governance") if isinstance(fm.get("governance"), dict) else {}
    status = str(gov.get("status") or fm.get("status") or "DRAF")
    title = str(fm.get("title") or "").strip()
    if not title:
        match = re.search(r"^#\s+(.+)$", body, flags=re.MULTILINE)
        title = match.group(1).strip() if match else file_path.name
    return {
        "path": rel,
        "category": category,
        "doc_id": str(fm.get("doc_id") or ""),
        "title": title,
        "domain": str(fm.get("domain") or ("Agent policy" if category == "B" else "")),
        "department": str(fm.get("department") or ""),
        "status": status,
        "tags": fm.get("tags") if isinstance(fm.get("tags"), list) else [],
        "raw": raw,
    }


def _iter_knowledge_docs(root: Path) -> list[dict[str, Any]]:
    knowledge_dir = root / "knowledge"
    if not knowledge_dir.is_dir():
        return []
    docs: list[dict[str, Any]] = []
    for folder in _KNOWLEDGE_FOLDERS:
        base = knowledge_dir / folder
        if not base.is_dir():
            continue
        for file_path in sorted(base.rglob("*")):
            if not file_path.is_file() or any(part in _SKIP_PARTS for part in file_path.parts):
                continue
            record = _doc_record(root, file_path)
            if record is not None:
                docs.append(record)
    return docs


def _safe_resolve_under(base: Path, candidate: str) -> Path | None:
    if not candidate or "\x00" in candidate:
        return None
    cleaned = candidate.strip().replace("\\", "/").lstrip("/")
    resolved_base = base.resolve()
    target = (resolved_base / cleaned).resolve()
    try:
        if not target.is_relative_to(resolved_base):
            return None
    except ValueError:
        return None
    return target


@mcp.tool(
    name="agent_overview",
    description="Ringkasan MelindaOS All-Access MCP: satu identitas agent bersama, jumlah dokumen knowledge, dan daftar tool MAAF yang aktif.",
    annotations=_READ,
)
def agent_overview() -> dict[str, Any]:
    root = repo_root()
    docs = _iter_knowledge_docs(root)
    contracts = load_tool_contracts() or {}
    return {
        "status": "ok",
        "access_mode": "ALL_ACCESS",
        "icon_url": MCP_LOGO_URL,
        "caller_agent": get_current_producer_id(),
        "agent": SHARED_AGENT_ID,
        "knowledge_count": len(docs),
        "approved_count": sum(1 for d in docs if d["status"] == "APPROVED"),
        "draft_count": sum(1 for d in docs if d["status"] != "APPROVED"),
        "maaf_tools": sorted(contracts.keys()),
        "dashboard_url_configured": bool(os.getenv("MELINDAOS_DASHBOARD_URL", "").strip()),
    }


@mcp.tool(
    name="knowledge_list",
    description="Daftar dokumen knowledge MelindaOS (mencakup APPROVED dan DRAF). Filter opsional: category (A/B/C), domain, department, status, q, limit, offset.",
    annotations=_READ,
)
def knowledge_list(
    category: str | None = None,
    domain: str | None = None,
    department: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    docs = _iter_knowledge_docs(repo_root())
    if category:
        cat_u = category.strip().upper()
        docs = [d for d in docs if d["category"] == cat_u]
    if domain:
        dom_l = domain.strip().lower()
        docs = [d for d in docs if dom_l in d["domain"].lower()]
    if department:
        dept_l = department.strip().lower()
        docs = [d for d in docs if dept_l in d["department"].lower()]
    if status:
        st_u = status.strip().upper()
        docs = [d for d in docs if d["status"].upper() == st_u]
    if q:
        q_l = q.strip().lower()
        docs = [
            d for d in docs
            if q_l in d["title"].lower() or q_l in d["doc_id"].lower() or q_l in d["path"].lower()
        ]

    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    page = docs[safe_offset : safe_offset + safe_limit]
    return {
        "total": len(docs),
        "offset": safe_offset,
        "limit": safe_limit,
        "documents": [
            {k: v for k, v in d.items() if k != "raw"}
            for d in page
        ],
    }


@mcp.tool(
    name="knowledge_search",
    description="Cari dokumen di seluruh knowledge MelindaOS (judul, doc_id, tag, dan isi).",
    annotations=_READ,
)
def knowledge_search(query: str, limit: int = 20) -> dict[str, Any]:
    if not query or not query.strip():
        return {"status": "invalid_request", "reason": "query is required"}
    terms = [t for t in query.strip().lower().split() if t]
    docs = _iter_knowledge_docs(repo_root())
    scored: list[tuple[int, dict[str, Any], str]] = []
    for doc in docs:
        haystack = f"{doc['title']}\n{doc['doc_id']}\n{doc['path']}\n{doc['raw']}".lower()
        hits = sum(1 for term in terms if term in haystack)
        if hits == 0:
            continue
        title_hits = sum(2 for term in terms if term in doc["title"].lower() or term in doc["doc_id"].lower())
        score = hits * 10 + title_hits
        first_pos = min((haystack.find(term) for term in terms if term in haystack), default=0)
        raw_start = max(0, first_pos - 80)
        snippet = re.sub(r"\s+", " ", doc["raw"][raw_start : raw_start + 220]).strip()
        scored.append((score, doc, snippet))
    scored.sort(key=lambda item: (-item[0], item[1]["path"]))
    safe_limit = max(1, min(limit, 100))
    results = []
    for score, doc, snippet in scored[:safe_limit]:
        results.append({
            "path": doc["path"],
            "doc_id": doc["doc_id"],
            "title": doc["title"],
            "category": doc["category"],
            "domain": doc["domain"],
            "status": doc["status"],
            "match": "full" if score >= len(terms) * 10 else "partial",
            "snippet": snippet,
        })
    return {"query": query, "count": len(results), "results": results}


@mcp.tool(
    name="knowledge_get",
    description="Baca isi lengkap satu dokumen knowledge berdasarkan path relatif atau doc_id.",
    annotations=_READ,
)
def knowledge_get(path: str) -> dict[str, Any]:
    if not path or not path.strip():
        return {"status": "invalid_request", "reason": "path is required"}
    root = repo_root()
    query = path.strip().replace("\\", "/").lstrip("/")
    candidates = [query]
    if not query.startswith("knowledge/"):
        candidates.append(f"knowledge/{query}")
    for candidate in candidates:
        resolved = _safe_resolve_under(root / "knowledge", candidate.removeprefix("knowledge/"))
        if resolved and resolved.is_file():
            record = _doc_record(root, resolved)
            if record:
                return {"status": "ok", "document": record}
            return {
                "status": "ok",
                "document": {
                    "path": resolved.relative_to(root).as_posix(),
                    "content": resolved.read_text(encoding="utf-8", errors="replace"),
                },
            }
    for doc in _iter_knowledge_docs(root):
        if doc["doc_id"] and doc["doc_id"].lower() == query.lower():
            return {"status": "ok", "document": doc}
    return {"status": "not_found", "reason": f"Dokumen '{path}' tidak ditemukan."}


@mcp.tool(
    name="knowledge_write",
    description="Tulis atau perbarui file dokumen/draf di dalam folder knowledge/ (all-access; path traversal di luar knowledge/ ditolak).",
    annotations=_WRITE,
)
def knowledge_write(path: str, content: str) -> dict[str, Any]:
    if not path or not path.strip():
        return {"status": "invalid_request", "reason": "path is required"}
    root = repo_root()
    knowledge_dir = root / "knowledge"
    cleaned = path.strip().replace("\\", "/").lstrip("/")
    if cleaned.startswith("knowledge/"):
        cleaned = cleaned.removeprefix("knowledge/")
    target = _safe_resolve_under(knowledge_dir, cleaned)
    if target is None or any(part in _SKIP_PARTS for part in target.relative_to(knowledge_dir).parts):
        return {"status": "invalid_request", "reason": "Path harus berada di dalam knowledge/ yang valid."}
    rel = "knowledge/" + target.relative_to(knowledge_dir).as_posix()
    protected = {folder.casefold() for folder in _WRITE_PROTECTED_FOLDERS}
    if target.relative_to(knowledge_dir).parts[0].casefold() in protected or rel.casefold().endswith(".prompt.md"):
        return {"status": "forbidden", "reason": "Kebijakan agen dan kontrak tool hanya diubah manusia."}
    if _APPROVED_STATUS.search(content) or _declared_status(rel, content).strip().upper() == "APPROVED":
        return {"status": "forbidden", "reason": "Status APPROVED hanya dipasang lewat tinjauan manusia; simpan sebagai DRAF."}
    if target.is_file():
        try:
            existing = target.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            existing = ""
        if _declared_status(rel, existing).strip().upper() == "APPROVED":
            return {"status": "forbidden", "reason": "Dokumen APPROVED hanya diubah lewat tinjauan manusia."}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {
        "status": "written",
        "path": target.relative_to(root).as_posix(),
        "bytes": len(content.encode("utf-8")),
        "agent": get_current_producer_id(),
    }


@mcp.tool(
    name="files_list",
    description="Daftar file di folder governed (knowledge, docs, dashboard/schemas).",
    annotations=_READ,
)
def files_list(folder: str = "docs") -> dict[str, Any]:
    root = repo_root()
    normalized = folder.strip().replace("\\", "/").strip("/")
    if normalized not in _GOVERNED_ROOTS:
        return {
            "status": "invalid_request",
            "reason": f"Folder harus salah satu dari: {', '.join(_GOVERNED_ROOTS)}",
        }
    base = root / normalized
    if not base.is_dir():
        return {"folder": normalized, "files": []}
    files = [
        p.relative_to(root).as_posix()
        for p in sorted(base.rglob("*"))
        if p.is_file() and not any(part in _SKIP_PARTS for part in p.parts)
    ]
    return {"folder": normalized, "count": len(files), "files": files[:500]}


@mcp.tool(
    name="file_read",
    description="Baca isi file dari folder governed (knowledge/, docs/, atau dashboard/schemas/).",
    annotations=_READ,
)
def file_read(path: str) -> dict[str, Any]:
    root = repo_root()
    cleaned = path.strip().replace("\\", "/").lstrip("/")
    for allowed_root in _GOVERNED_ROOTS:
        if cleaned == allowed_root or cleaned.startswith(f"{allowed_root}/"):
            rel = cleaned.removeprefix(f"{allowed_root}/")
            target = _safe_resolve_under(root / allowed_root, rel)
            if target and target.is_file():
                return {
                    "status": "ok",
                    "path": target.relative_to(root).as_posix(),
                    "content": target.read_text(encoding="utf-8", errors="replace"),
                }
            return {"status": "not_found", "reason": f"File '{path}' tidak ditemukan."}
    return {"status": "invalid_request", "reason": "Path di luar folder governed yang diizinkan."}


@mcp.tool(
    name="dashboard_mcp_call",
    description="Teruskan panggilan tool langsung ke endpoint MCP Dashboard (/api/mcp) untuk membaca/mengubah jadwal, Task Vault, Morning Brief, Warta, Arahan, atau sinkronisasi halaman.",
    annotations=_WRITE,
)
def dashboard_mcp_call(tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    base = os.getenv("MELINDAOS_DASHBOARD_URL", "").strip().rstrip("/")
    if not base:
        if tool_name == "agent_overview":
            return agent_overview()
        if tool_name in {"daftar_dokumen", "knowledge_list"}:
            return knowledge_list(**(arguments or {}))
        if tool_name in {"cari_dokumen", "knowledge_search"}:
            return knowledge_search(query=str((arguments or {}).get("query", "")))
        if tool_name in {"baca_dokumen", "knowledge_get"}:
            return knowledge_get(path=str((arguments or {}).get("path", "")))
        return {
            "status": "dashboard_url_not_configured",
            "reason": "Set MELINDAOS_DASHBOARD_URL untuk memanggil endpoint /api/mcp Dashboard secara remote.",
            "tool": tool_name,
        }

    parsed = url_parse.urlsplit(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return {"status": "configuration_required", "reason": "MELINDAOS_DASHBOARD_URL tidak valid."}

    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments or {}},
    }
    headers = {"Content-Type": "application/json"}
    token = os.getenv("MELINDAOS_MCP_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = url_request.Request(
        f"{base}/api/mcp",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with url_request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {"status": "ok"}
    except url_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {"status": "http_error", "http_status": exc.code, "detail": body[:500]}
    except Exception as exc:
        return {"status": "transport_error", "reason": str(exc)}


@mcp.tool(
    name="maaf_call",
    description="Jalankan salah satu dari 13 tool kontrak MAAF (melinda.social.*, melinda.finance.summary, melinda.medify.*, dll). L0-L2 berjalan; L3/L4 membalas approval_required, L5 human_only.",
    annotations=_WRITE,
)
def maaf_call(
    tool_name: str,
    payload: dict[str, Any] | None = None,
    purpose: str = "Eksekusi all-access agent MelindaOS",
    request_id: str | None = None,
) -> dict[str, Any]:
    if tool_name == "melinda.satusehat.patient_lookup":
        nik = str((payload or {}).get("nik", ""))
        if len(nik) != 16 or not nik.isascii() or not nik.isdigit():
            return {"status": "invalid_request", "reason": "NIK must be 16 digits."}

    allowed_roles = allowed_roles_for(tool_name)
    risk = risk_for(tool_name)
    if allowed_roles is None or risk is None:
        return {"status": "tool_not_registered", "reason": f"Tool MAAF '{tool_name}' tidak terdaftar di kontrak."}

    rid = request_id or str(uuid.uuid4())
    try:
        prepared = prepare_action(
            tool=tool_name,
            payload=payload or {},
            risk_class=risk,
            actor=SHARED_AGENT_ID,
            allowed_roles=allowed_roles,
            purpose=purpose,
            request_id=rid,
        )
    except ValueError as exc:
        return {"status": "invalid_request", "reason": str(exc)}

    if prepared["status"] != "ready":
        return prepared

    if not os.getenv("MAAF_BACKEND_URL", "").strip():
        return {"status": "accepted", "mode": "all_access_local", "envelope": prepared["envelope"]}
    return dispatch_envelope(prepared["envelope"])


app = create_app()


def main() -> None:
    transport = os.getenv("MELINDA_AGENT_MCP_TRANSPORT", "stdio").strip().lower()
    if transport == "streamable-http":
        mcp.run(transport="streamable-http")
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
