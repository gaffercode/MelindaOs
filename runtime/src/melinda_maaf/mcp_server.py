from __future__ import annotations

import os
import uuid
from typing import Any

from mcp.server import MCPServer
from mcp.types import Icon

from .gateway import prepare_action
from .mcp_auth import BearerAuthMiddleware
from .tool_contracts import ACTOR_ROLES, allowed_roles_for, risk_for
from .transport import dispatch_envelope

MCP_LOGO_URL = "https://melindaos.app/brand/melindaos-logo.png"

mcp = MCPServer(
    "Melinda MAAF",
    title="Melinda MAAF",
    website_url="https://melindaos.app",
    icons=[Icon(src=MCP_LOGO_URL, mime_type="image/png", sizes=["512x512"])],
)


def _is_all_access() -> bool:
    for var in ("MAAF_ALL_ACCESS", "MELINDAOS_MCP_ALL_ACCESS"):
        if os.getenv(var, "").strip().lower() in {"1", "true", "yes", "all"}:
            return True
    return False


def _actor() -> str:
    # Bind the role at deployment/trust-domain level; the model cannot choose it.
    configured = os.getenv("MAAF_ACTOR_ROLE", "").strip()
    if configured:
        return configured
    if _is_all_access():
        return "ALL_ACCESS"
    return ""


def _is_preapproved(tool: str) -> bool:
    if _is_all_access():
        return True
    allowed = {x.strip() for x in os.getenv("MAAF_PREAPPROVED_L3", "").split(",") if x.strip()}
    return "*" in allowed or tool in allowed


def _is_allowlisted(tool: str) -> bool:
    if _is_all_access():
        return True
    allowed = {x.strip() for x in os.getenv("MAAF_TOOL_ALLOWLIST", "").split(",") if x.strip()}
    return bool(allowed) and ("*" in allowed or "ALL" in allowed or tool in allowed)


def _run(tool: str, payload: dict[str, Any], purpose: str, request_id: str | None = None) -> dict[str, Any]:
    all_access = _is_all_access()
    actor = _actor()
    if actor not in ACTOR_ROLES:
        return {"status": "configuration_required", "reason": "Trusted actor role is not configured."}
    if not _is_allowlisted(tool):
        return {"status": "tool_not_allowlisted", "reason": "This tool is not enabled for the configured trust domain."}
    allowed_roles = allowed_roles_for(tool)
    if allowed_roles is None or (actor not in allowed_roles and not (all_access and actor == "ALL_ACCESS")):
        return {"status": "tool_not_authorized", "reason": "No approved actor-to-tool grant is configured."}
    risk = risk_for(tool)
    if risk is None:
        return {"status": "tool_not_authorized", "reason": "No valid risk class is configured for this tool."}
    rid = request_id or str(uuid.uuid4())
    try:
        prepared = prepare_action(
            tool=tool,
            payload=payload,
            risk_class=risk,
            actor=actor,
            allowed_roles=allowed_roles,
            purpose=purpose,
            request_id=rid,
            preapproved=_is_preapproved(tool),
            all_access=all_access,
        )
    except ValueError as exc:
        return {"status": "invalid_request", "reason": str(exc)}
    if prepared["status"] != "ready":
        return prepared
    if all_access and not os.getenv("MAAF_BACKEND_URL", "").strip():
        return {"status": "accepted", "mode": "all_access_local", "envelope": prepared["envelope"]}
    return dispatch_envelope(prepared["envelope"])


@mcp.tool()
def social_publish(channel: str, text: str, purpose: str, media_urls: list[str] | None = None, request_id: str | None = None) -> dict[str, Any]:
    """Publikasikan konten institusional ke kanal sosial yang sudah dikonfigurasi."""
    return _run("melinda.social.publish", {"channel": channel, "text": text, "media_urls": media_urls or []}, purpose, request_id)


@mcp.tool()
def social_schedule(channel: str, text: str, publish_at: str, purpose: str, media_urls: list[str] | None = None, request_id: str | None = None) -> dict[str, Any]:
    """Jadwalkan publikasi konten institusional."""
    return _run("melinda.social.schedule", {"channel": channel, "text": text, "publish_at": publish_at, "media_urls": media_urls or []}, purpose, request_id)


@mcp.tool()
def auth_health(provider: str, purpose: str = "Memeriksa kesehatan integrasi") -> dict[str, Any]:
    """Baca status koneksi/token tanpa mengekspos secret."""
    return _run("melinda.auth.health", {"provider": provider}, purpose)


@mcp.tool()
def email_send(to: list[str], subject: str, body: str, purpose: str, request_id: str | None = None) -> dict[str, Any]:
    """Kirim email melalui adapter email resmi Melinda."""
    return _run("melinda.email.send", {"to": to, "subject": subject, "body": body}, purpose, request_id)


@mcp.tool()
def website_publish(slug: str, title: str, body: str, purpose: str, request_id: str | None = None) -> dict[str, Any]:
    """Publikasikan/update konten website melalui CMS API atau signed webhook."""
    return _run("melinda.website.publish", {"slug": slug, "title": title, "body": body}, purpose, request_id)


@mcp.tool()
def ops_task_assign(unit: str, task: str, due_at: str, purpose: str, request_id: str | None = None) -> dict[str, Any]:
    """Buat/assign task internal yang reversible."""
    return _run("melinda.ops.task.assign", {"unit": unit, "task": task, "due_at": due_at}, purpose, request_id)


@mcp.tool()
def finance_summary(period: str, purpose: str = "Menyusun ringkasan keuangan") -> dict[str, Any]:
    """Ambil ringkasan keuangan yang sudah dinormalisasi; tidak melakukan posting transaksi."""
    return _run("melinda.finance.summary", {"period": period}, purpose)


@mcp.tool()
def claims_exceptions(period: str, purpose: str = "Mendeteksi exception klaim") -> dict[str, Any]:
    """Ambil exception klaim/casemix tanpa membuat clinical or financial commitment."""
    return _run("melinda.claims.exceptions", {"period": period}, purpose)


@mcp.tool()
def emergency_red_flag_check(symptoms: list[str], purpose: str = "Pemeriksaan tanda bahaya gawat darurat maternal/pediatrik") -> dict[str, Any]:
    """Keep L5 clinical triage human-only until a clinically approved service is available."""
    return _run("melinda.clinical.red_flag.check", {}, purpose)


@mcp.tool()
def doctor_schedule_query(specialty: str | None = None, date: str | None = None, purpose: str = "Query jadwal praktik dokter SIMRS") -> dict[str, Any]:
    """Query jadwal resmi dokter spesialis dari master jadwal SIMRS RSIA Melinda DHAI."""
    return _run("melinda.medify.schedule.read", {"specialty": specialty, "date": date}, purpose)


@mcp.tool()
def bed_capacity_query(purpose: str = "Query ketersediaan bed rawat inap & intensif") -> dict[str, Any]:
    """Query status kapasitas tempat tidur rawat inap, VK, perinatologi, dan NICU."""
    return _run("melinda.medify.bed_capacity.read", {}, purpose)


@mcp.tool()
def queue_status_query(queue_code: str, purpose: str = "Query status antrean pasien di Medify SIMRS") -> dict[str, Any]:
    """Query posisi dan estimasi waktu tunggu antrean poliklinik/admisi RSIA Melinda DHAI."""
    return _run("melinda.medify.queue_status.read", {"queue_code": queue_code}, purpose)


@mcp.tool()
def satusehat_patient_lookup(nik: str, purpose: str = "Query IHS Number pasien dari platform Kemenkes SatuSehat") -> dict[str, Any]:
    """Cari Indonesian Health Service (IHS) Number pasien berdasarkan NIK 16 digit."""
    if len(nik) != 16 or not nik.isascii() or not nik.isdigit():
        return {"status": "invalid_request", "reason": "NIK must be 16 digits."}
    return _run("melinda.satusehat.patient_lookup", {"nik": nik}, purpose)


app = BearerAuthMiddleware(mcp.streamable_http_app())
