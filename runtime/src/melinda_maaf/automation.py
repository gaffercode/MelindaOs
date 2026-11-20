
def should_escalate(recovery_attempted: bool, provider_requires_human: bool, risk_class: str) -> bool:
    """Return True only when a human is genuinely required.

    Automation Above All means ordinary recoverable failures should not be
    escalated before automated recovery has been attempted. L4/L5 remain
    human-gated by design.
    """
    if risk_class == "L5":
        return True
    if risk_class == "L4":
        return recovery_attempted
    if provider_requires_human and recovery_attempted:
        return True
    return False
