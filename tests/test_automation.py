from melinda_maaf.automation import should_escalate


def test_does_not_escalate_before_automated_recovery():
    assert should_escalate(False, False, 'L1') is False


def test_does_not_escalate_routine_failure_after_one_recovery_if_provider_does_not_require_human():
    assert should_escalate(True, False, 'L1') is False


def test_escalates_when_provider_requires_human_and_recovery_was_attempted():
    assert should_escalate(True, True, 'L1') is True


def test_high_consequence_still_escalates_after_recovery():
    assert should_escalate(True, False, 'L4') is True


def test_clinical_authority_always_escalates():
    assert should_escalate(False, False, 'L5') is True
