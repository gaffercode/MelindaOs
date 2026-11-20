from __future__ import annotations

from typing import Any

from .policy import authorize


def prepare_action(
    *,
    tool: str,
    payload: dict[str, Any],
    risk_class: str,
    actor: str,
    allowed_roles: frozenset[str] | None,
    purpose: str,
    request_id: str,
    preapproved: bool = False,
    all_access: bool = False,
) -> dict[str, Any]:
    """Create an auditable action envelope only when policy permits dispatch."""
    if not purpose or not purpose.strip():
        raise ValueError("purpose is required")
    if not request_id or not request_id.strip():
        raise ValueError("request_id is required")

    decision = authorize(tool, risk_class, actor, allowed_roles, preapproved=preapproved, all_access=all_access)
    if decision.outcome != "allow":
        return {
            "status": decision.outcome,
            "human_required": decision.human_required,
            "reason": decision.reason,
        }

    envelope: dict[str, Any] = {
        "request_id": request_id,
        "tool": tool,
        "actor": actor,
        "purpose": purpose.strip(),
        "risk_class": risk_class,
        "preapproved": preapproved,
        "payload": payload,
    }
    if all_access:
        envelope["all_access"] = True

    return {
        "status": "ready",
        "human_required": False,
        "envelope": envelope,
    }
