import pytest

from melinda_maaf import mcp_server, tool_contracts


def test_tool_dispatch_requires_a_bound_actor(monkeypatch):
    monkeypatch.delenv("MAAF_ACTOR_ROLE", raising=False)
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "melinda.finance.summary")

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "Ringkasan")

    assert result["status"] == "configuration_required"
    assert result["reason"] == "Trusted actor role is not configured."


def test_tool_dispatch_rejects_an_unknown_actor_role(monkeypatch):
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "UNAPPROVED")
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "melinda.finance.summary")

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "Ringkasan")

    assert result["status"] == "configuration_required"


def test_tool_dispatch_requires_an_explicit_allowlist(monkeypatch):
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    monkeypatch.delenv("MAAF_TOOL_ALLOWLIST", raising=False)

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "Ringkasan")

    assert result["status"] == "tool_not_allowlisted"


def test_allowlisted_tools_dispatch_with_server_bound_actor(monkeypatch):
    captured = []
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "melinda.finance.summary")
    monkeypatch.setattr(mcp_server, "allowed_roles_for", lambda tool: frozenset({"ALL_ACCESS"}), raising=False)
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: captured.append(envelope) or {"status": "accepted"})

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "Ringkasan")

    assert result == {"status": "accepted"}
    assert captured[0]["actor"] == "ALL_ACCESS"
    assert captured[0]["risk_class"] == "L0"


def test_allowlisted_tool_without_an_approved_role_grant_is_denied(monkeypatch):
    captured = []
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "melinda.finance.summary")
    monkeypatch.setattr(mcp_server, "allowed_roles_for", lambda name: frozenset())
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: captured.append(envelope) or {"status": "accepted"})

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "Ringkasan")

    assert result["status"] == "tool_not_authorized"
    assert captured == []


def test_allowlisted_unknown_tool_is_denied_before_dispatch(monkeypatch):
    captured = []
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "melinda.not.registered")
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: captured.append(envelope) or {"status": "accepted"})

    result = mcp_server._run("melinda.not.registered", {}, "Ringkasan")

    assert result["status"] == "tool_not_authorized"
    assert captured == []


def _grant_dir(monkeypatch, tool):
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", tool)
    monkeypatch.setattr(mcp_server, "allowed_roles_for", lambda name: frozenset({"ALL_ACCESS"}))


def test_blank_purpose_is_an_invalid_request(monkeypatch):
    _grant_dir(monkeypatch, "melinda.finance.summary")
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: pytest.fail("must not dispatch"))

    result = mcp_server._run("melinda.finance.summary", {"period": "2026-10"}, "   ")

    assert result == {"status": "invalid_request", "reason": "purpose is required"}


def test_contract_risk_drives_dispatch_policy(monkeypatch):
    captured = []
    _grant_dir(monkeypatch, "melinda.finance.summary")
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: captured.append(envelope) or {"status": "accepted"})

    assert mcp_server._run("melinda.finance.summary", {}, "Ringkasan") == {"status": "accepted"}

    monkeypatch.setattr(tool_contracts, "load_tool_risks", lambda: {"melinda.finance.summary": "L5"})
    result = mcp_server._run("melinda.finance.summary", {}, "Ringkasan")

    assert result["status"] != "accepted"
    assert len(captured) == 1


def test_tool_without_valid_contract_risk_is_not_authorized(monkeypatch):
    _grant_dir(monkeypatch, "melinda.finance.summary")
    monkeypatch.setattr(tool_contracts, "load_tool_risks", lambda: {})
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: pytest.fail("must not dispatch"))

    result = mcp_server._run("melinda.finance.summary", {}, "Ringkasan")

    assert result == {"status": "tool_not_authorized", "reason": "No valid risk class is configured for this tool."}


@pytest.mark.parametrize("nik", ["123", "12345678901234567", "12345678901234ab", ""])
def test_satusehat_lookup_rejects_malformed_nik_before_run(monkeypatch, nik):
    monkeypatch.setattr(mcp_server, "_run", lambda *args, **kwargs: pytest.fail("must not run"))

    result = mcp_server.satusehat_patient_lookup(nik)

    assert result == {"status": "invalid_request", "reason": "NIK must be 16 digits."}


def test_satusehat_lookup_with_valid_nik_reaches_run(monkeypatch):
    calls = []
    monkeypatch.setattr(mcp_server, "_run", lambda *args, **kwargs: calls.append(args) or {"status": "ok"})

    assert mcp_server.satusehat_patient_lookup("3506012345678901") == {"status": "ok"}
    assert calls[0][0] == "melinda.satusehat.patient_lookup"
    assert calls[0][1] == {"nik": "3506012345678901"}


def test_wildcard_allowlist_dispatches_only_the_shared_identity(monkeypatch):
    captured = []
    monkeypatch.delenv("MAAF_ALL_ACCESS", raising=False)
    monkeypatch.setenv("MAAF_TOOL_ALLOWLIST", "*")
    monkeypatch.setattr(mcp_server, "dispatch_envelope", lambda envelope: captured.append(envelope) or {"status": "accepted"})

    for retired in ("PARMA", "ALFRED", "LUNA", "DIR"):
        monkeypatch.setenv("MAAF_ACTOR_ROLE", retired)
        assert mcp_server._run("melinda.finance.summary", {"period": "2026-11"}, "Ringkasan")["status"] == "configuration_required"
    monkeypatch.setenv("MAAF_ACTOR_ROLE", "ALL_ACCESS")
    assert mcp_server._run("melinda.finance.summary", {"period": "2026-11"}, "Ringkasan") == {"status": "accepted"}
    assert [item["actor"] for item in captured] == ["ALL_ACCESS"]


def test_all_access_mode_allows_all_tools_locally(monkeypatch):
    monkeypatch.delenv("MAAF_ACTOR_ROLE", raising=False)
    monkeypatch.delenv("MAAF_TOOL_ALLOWLIST", raising=False)
    monkeypatch.delenv("MAAF_BACKEND_URL", raising=False)
    monkeypatch.setenv("MAAF_ALL_ACCESS", "1")

    res = mcp_server._run("melinda.social.publish", {"channel": "ig", "text": "Info"}, "Publikasi")
    assert res["status"] == "accepted"
    assert res["mode"] == "all_access_local"
    assert res["envelope"]["actor"] == "ALL_ACCESS"
    assert res["envelope"]["all_access"] is True
