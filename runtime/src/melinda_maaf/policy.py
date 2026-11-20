from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    outcome: str
    human_required: bool
    reason: str


def authorize(
    action: str,
    risk_class: str,
    actor_role: str,
    allowed_roles: frozenset[str] | None,
    preapproved: bool = False,
    all_access: bool = False,
) -> Decision:
    """Evaluate a requested action against the Melinda autonomy model.

    This is deliberately conservative unless `all_access=True`: L4 always requires
    designated human authority, and L5 clinical authority is human-only. Tool access
    requires an explicit actor grant before risk is evaluated.
    """
    if not isinstance(allowed_roles, frozenset) or (actor_role not in allowed_roles and not (all_access and actor_role == "ALL_ACCESS")):
        return Decision("deny", True, "Actor is not explicitly approved for this tool")
    if all_access:
        return Decision("allow", False, "All-access mode is enabled for this agent")
    if risk_class in {"L0", "L1", "L2"}:
        return Decision("allow", False, f"{risk_class} is autonomous within policy boundaries")
    if risk_class == "L3":
        if preapproved:
            return Decision("allow", False, "L3 action class is explicitly pre-approved")
        return Decision("approval_required", True, "L3 consequential external action is not pre-approved")
    if risk_class == "L4":
        return Decision("approval_required", True, "L4 high-consequence action requires designated human authority")
    if risk_class == "L5":
        return Decision("human_only", True, "L5 clinical authority is reserved for an authorized clinician")
    return Decision("deny", True, f"Unknown risk class: {risk_class}")
