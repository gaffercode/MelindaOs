import pytest

from melinda_maaf.policy import authorize


def test_l0_is_automatically_allowed():
    decision = authorize('read_metrics', 'L0', 'ATLAS', allowed_roles=frozenset({'ATLAS'}))
    assert decision.outcome == 'allow'
    assert decision.human_required is False


def test_l2_reversible_internal_is_allowed():
    decision = authorize('create_internal_task', 'L2', 'FLOW', allowed_roles=frozenset({'FLOW'}))
    assert decision.outcome == 'allow'


def test_l3_requires_approval_when_not_preapproved():
    decision = authorize('publish_social_post', 'L3', 'ATLAS', allowed_roles=frozenset({'ATLAS'}), preapproved=False)
    assert decision.outcome == 'approval_required'
    assert decision.human_required is True


def test_l3_can_run_when_action_class_is_preapproved():
    decision = authorize('publish_social_post', 'L3', 'ATLAS', allowed_roles=frozenset({'ATLAS'}), preapproved=True)
    assert decision.outcome == 'allow'
    assert decision.human_required is False


def test_l4_always_requires_designated_human():
    decision = authorize('release_payment', 'L4', 'LEDGER', allowed_roles=frozenset({'LEDGER'}), preapproved=True)
    assert decision.outcome == 'approval_required'
    assert decision.human_required is True


def test_l5_clinical_action_is_human_only():
    decision = authorize('issue_prescription', 'L5', 'AEGIS', allowed_roles=frozenset({'AEGIS'}), preapproved=True)
    assert decision.outcome == 'human_only'
    assert decision.human_required is True


def test_unknown_risk_class_is_denied():
    decision = authorize('anything', 'LX', 'ATLAS', allowed_roles=frozenset({'ATLAS'}))
    assert decision.outcome == 'deny'


def test_missing_tool_grant_is_denied_before_low_risk_allows():
    decision = authorize('melinda.finance.summary', 'L0', 'DIR', allowed_roles=None)

    assert decision.outcome == 'deny'
    assert decision.human_required is True


def test_actor_outside_tool_grant_is_denied():
    decision = authorize('melinda.finance.summary', 'L0', 'FIN', allowed_roles=frozenset({'DIR'}))

    assert decision.outcome == 'deny'
