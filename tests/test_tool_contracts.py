from melinda_maaf import tool_contracts


def test_contract_exposes_only_explicit_role_grants(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [ALL_ACCESS]\n",
        encoding="utf-8",
    )

    grants = tool_contracts.load_tool_contracts(contract)

    assert grants == {"melinda.finance.summary": frozenset({"ALL_ACCESS"})}


def test_contract_naming_a_retired_agent_code_fails_closed(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [PARMA]\n",
        encoding="utf-8",
    )

    assert tool_contracts.load_tool_contracts(contract) is None


def test_contract_with_missing_role_mapping_fails_closed(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n",
        encoding="utf-8",
    )

    assert tool_contracts.load_tool_contracts(contract) is None


def test_contract_with_duplicate_tool_ids_fails_closed(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [ALL_ACCESS]\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [ALL_ACCESS]\n",
        encoding="utf-8",
    )

    assert tool_contracts.load_tool_contracts(contract) is None


def test_contract_with_unknown_actor_role_fails_closed(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [SUPERADMIN]\n",
        encoding="utf-8",
    )

    assert tool_contracts.load_tool_contracts(contract) is None


def test_malformed_yaml_fails_closed(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text("tools: [", encoding="utf-8")

    assert tool_contracts.load_tool_contracts(contract) is None


def test_duplicate_yaml_mapping_keys_fail_closed(tmp_path):
    documents = [
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: []\n"
        "    allowed_roles: [ALL_ACCESS]\n",
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    name: melinda.website.publish\n"
        "    allowed_roles: [ALL_ACCESS]\n",
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: [ALL_ACCESS]\n"
        "tools:\n"
        "  - name: melinda.website.publish\n"
        "    allowed_roles: [ALL_ACCESS]\n",
    ]

    for index, document in enumerate(documents):
        contract = tmp_path / f"tool-contracts-{index}.yaml"
        contract.write_text(document, encoding="utf-8")

        assert tool_contracts.load_tool_contracts(contract) is None


def test_current_canonical_contract_grants_only_the_shared_identity():
    expected = frozenset({"ALL_ACCESS"})
    assert tool_contracts.ACTOR_ROLES == expected
    assert tool_contracts.allowed_roles_for("melinda.finance.summary") == expected
    assert tool_contracts.allowed_roles_for("melinda.social.publish") == expected
    assert tool_contracts.allowed_roles_for("melinda.not.registered") is None


def test_contract_wildcard_expands_to_all_actor_roles(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    allowed_roles: ['*']\n"
        "  - name: melinda.auth.health\n"
        "    allowed_roles: all\n",
        encoding="utf-8",
    )

    grants = tool_contracts.load_tool_contracts(contract)

    assert grants == {
        "melinda.finance.summary": tool_contracts.ACTOR_ROLES,
        "melinda.auth.health": tool_contracts.ACTOR_ROLES,
    }


def test_contract_risk_is_read_and_validated_per_tool(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text(
        "tools:\n"
        "  - name: melinda.finance.summary\n"
        "    risk: L0\n"
        "    allowed_roles: []\n"
        "  - name: melinda.email.send\n"
        "    risk: L9\n"
        "    allowed_roles: []\n"
        "  - name: melinda.website.publish\n"
        "    allowed_roles: []\n",
        encoding="utf-8",
    )

    assert tool_contracts.load_tool_risks(contract) == {"melinda.finance.summary": "L0"}


def test_invalid_contract_yields_no_risks(tmp_path):
    contract = tmp_path / "tool-contracts.yaml"
    contract.write_text("tools: [", encoding="utf-8")

    assert tool_contracts.load_tool_risks(contract) is None


def test_risk_for_reads_canonical_contract(monkeypatch):
    assert tool_contracts.risk_for("melinda.satusehat.patient_lookup") == "L4"
    assert tool_contracts.risk_for("melinda.clinical.red_flag.check") == "L5"
    assert tool_contracts.risk_for("melinda.not.registered") is None

    monkeypatch.setattr(tool_contracts, "load_tool_risks", lambda: None)
    assert tool_contracts.risk_for("melinda.finance.summary") is None
