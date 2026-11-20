import pytest

from melinda_maaf.gateway import prepare_action


def test_prepare_action_builds_auditable_envelope_for_allowed_action():
    result = prepare_action(
        tool='melinda.social.publish',
        payload={'channel': 'x', 'text': 'Tes'},
        risk_class='L3',
        actor='DIR',
        allowed_roles=frozenset({'DIR'}),
        purpose='Publikasi konten institusional yang sudah disetujui',
        preapproved=True,
        request_id='req-123',
    )
    assert result['status'] == 'ready'
    assert result['envelope']['request_id'] == 'req-123'
    assert result['envelope']['actor'] == 'DIR'
    assert result['envelope']['purpose']


def test_prepare_action_stops_non_preapproved_l3_before_dispatch():
    result = prepare_action(
        tool='melinda.social.publish', payload={}, risk_class='L3', actor='DIR',
        allowed_roles=frozenset({'DIR'}),
        purpose='Publikasi', preapproved=False, request_id='req-124'
    )
    assert result['status'] == 'approval_required'
    assert 'envelope' not in result


def test_prepare_action_stops_clinical_l5():
    result = prepare_action(
        tool='melinda.clinical.order', payload={}, risk_class='L5', actor='LEG',
        allowed_roles=frozenset({'LEG'}),
        purpose='Order klinis', preapproved=True, request_id='req-125'
    )
    assert result['status'] == 'human_only'


def test_purpose_is_mandatory():
    with pytest.raises(ValueError, match='purpose'):
        prepare_action(
            tool='melinda.ops.task.assign', payload={}, risk_class='L2', actor='OPS',
            allowed_roles=frozenset({'OPS'}),
            purpose=' ', request_id='req-126'
        )
