import asyncio
import json

from melinda_agent_mcp import server as agent_mcp
from melinda_maaf.mcp_auth import get_current_producer_id


def _run_auth_request(middleware, headers=()):
    messages = []
    observed = {}

    async def app(scope, receive, send):
        observed["producer"] = get_current_producer_id()
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    middleware.app = app
    scope = {"type": "http", "method": "POST", "path": "/mcp", "headers": list(headers)}
    asyncio.run(middleware(scope, receive, send))
    return messages[0]["status"], observed.get("producer")


def test_agent_overview_reports_one_shared_agent():
    overview = agent_mcp.agent_overview()
    assert overview["status"] == "ok"
    assert overview["access_mode"] == "ALL_ACCESS"
    assert overview["agent"] == "ALL_ACCESS"
    assert "agents" not in overview
    assert len(overview["maaf_tools"]) == 13
    assert overview["knowledge_count"] > 0


def test_knowledge_list_search_and_get_work_without_allowlist():
    listed = agent_mcp.knowledge_list(limit=5)
    assert listed["total"] > 0
    assert len(listed["documents"]) == 5

    first_path = listed["documents"][0]["path"]
    fetched = agent_mcp.knowledge_get(first_path)
    assert fetched["status"] == "ok"
    assert fetched["document"]["path"] == first_path

    searched = agent_mcp.knowledge_search("Melinda", limit=5)
    assert searched["count"] >= 0


def test_knowledge_write_writes_inside_sandboxed_knowledge_root(tmp_path, monkeypatch):
    (tmp_path / "knowledge" / "01_HOSPITAL").mkdir(parents=True)
    monkeypatch.setenv("MELINDAOS_ROOT", str(tmp_path))

    res = agent_mcp.knowledge_write("01_HOSPITAL/test-draft.md", "# Test Draft\n")
    assert res["status"] == "written"
    assert res["path"] == "knowledge/01_HOSPITAL/test-draft.md"
    assert (tmp_path / "knowledge" / "01_HOSPITAL" / "test-draft.md").read_text(encoding="utf-8") == "# Test Draft\n"

    bad = agent_mcp.knowledge_write("../outside.md", "nope")
    assert bad["status"] == "invalid_request"


def test_knowledge_write_refuses_policy_contracts_and_approved_status(tmp_path, monkeypatch):
    for folder in ("01_HOSPITAL", "08_AGENT_POLICY/core", "10_TOOL_CONTRACTS/mcp"):
        (tmp_path / "knowledge" / folder).mkdir(parents=True)
    monkeypatch.setenv("MELINDAOS_ROOT", str(tmp_path))

    assert agent_mcp.knowledge_write("08_AGENT_POLICY/core/rules.prompt.md", "# x\n")["status"] == "forbidden"
    assert agent_mcp.knowledge_write("knowledge/10_TOOL_CONTRACTS/mcp/tool-contracts.yaml", "tools: []\n")["status"] == "forbidden"
    approved = agent_mcp.knowledge_write("01_HOSPITAL/spo.md", "---\nstatus: APPROVED\n---\n# SPO\n")
    assert approved["status"] == "forbidden"
    assert agent_mcp.knowledge_write("01_HOSPITAL/data.json", '{"status": "approved"}')["status"] == "forbidden"
    assert not (tmp_path / "knowledge" / "01_HOSPITAL" / "spo.md").exists()
    assert agent_mcp.knowledge_write("01_HOSPITAL/spo.md", "---\nstatus: DRAF\n---\n# SPO\n")["status"] == "written"


def test_knowledge_write_refuses_approved_status_in_any_yaml_or_json_spelling(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_mcp, "repo_root", lambda: tmp_path)
    (tmp_path / "knowledge").mkdir()
    for content in (
        "---\nstatus: !!str APPROVED\n---\n# SPO\n",
        "---\nstatus: >-\n  APPROVED\n---\n# SPO\n",
        "---\na: &x APPROVED\nstatus: *x\n---\n# SPO\n",
        "---\ngovernance:\n  status: APPROVED\n---\n# SPO\n",
    ):
        assert agent_mcp.knowledge_write("01_HOSPITAL/spo.md", content)["status"] == "forbidden", content
    assert agent_mcp.knowledge_write("11_MACHINE_READABLE/x.json", '{"governance": {"status": "\u0041PPROVED"}}')["status"] == "forbidden"


def test_knowledge_write_refuses_agent_policy_files_and_approved_targets(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_mcp, "repo_root", lambda: tmp_path)
    (tmp_path / "knowledge" / "01_HOSPITAL").mkdir(parents=True)
    assert agent_mcp.knowledge_write("01_HOSPITAL/rules.prompt.md", "# x\n")["status"] == "forbidden"
    assert agent_mcp.knowledge_write("09_AGENT_ARCHITECTURE/x.md", "# x\n")["status"] == "forbidden"
    assert agent_mcp.knowledge_write("01_HOSPITAL/Rules.PROMPT.md", "# x\n")["status"] == "forbidden"
    assert agent_mcp.knowledge_write("08_agent_policy/x.md", "# x\n")["status"] == "forbidden"
    approved = tmp_path / "knowledge" / "01_HOSPITAL" / "spo.md"
    approved.write_text("---\nstatus: APPROVED\n---\n# SPO\n", encoding="utf-8")
    assert agent_mcp.knowledge_write("01_HOSPITAL/spo.md", "---\nstatus: DRAF\n---\n# SPO\n")["status"] == "forbidden"
    assert "APPROVED" in approved.read_text(encoding="utf-8")


def test_files_list_and_read_work_for_governed_docs():
    listed = agent_mcp.files_list("docs")
    assert listed["count"] > 0
    first = listed["files"][0]
    read_res = agent_mcp.file_read(first)
    assert read_res["status"] == "ok"
    assert first in read_res["path"]


def test_maaf_call_runs_low_risk_tools_as_the_shared_agent(monkeypatch):
    monkeypatch.delenv("MAAF_BACKEND_URL", raising=False)
    res = agent_mcp.maaf_call("melinda.finance.summary", {"period": "2026-11"})
    assert res["status"] == "accepted"
    assert res["mode"] == "all_access_local"
    assert res["envelope"]["actor"] == "ALL_ACCESS"
    assert "all_access" not in res["envelope"]


def test_maaf_call_keeps_the_human_gates_for_l3_to_l5(monkeypatch):
    monkeypatch.delenv("MAAF_BACKEND_URL", raising=False)
    publish = agent_mcp.maaf_call("melinda.social.publish", {"channel": "ig", "text": "Halo"})
    assert publish["status"] == "approval_required"
    assert publish["human_required"] is True
    queue = agent_mcp.maaf_call("melinda.medify.queue_status.read", {})
    assert queue["status"] == "approval_required"
    red_flag = agent_mcp.maaf_call("melinda.clinical.red_flag.check", {"text": "demam"})
    assert red_flag["status"] == "human_only"
    assert "envelope" not in red_flag


def test_all_access_auth_supports_tokenless_local_and_master_token(monkeypatch):
    monkeypatch.delenv("MELINDAOS_MCP_TOKEN", raising=False)
    monkeypatch.delenv("MELINDAOS_MCP_TOKEN_HASH", raising=False)
    monkeypatch.delenv("MELINDA_AGENT_MCP_BEARER_FILE", raising=False)
    monkeypatch.delenv("MELINDA_AGENT_MCP_BEARER_MAP_FILE", raising=False)

    middleware = agent_mcp.create_app()
    status, producer = _run_auth_request(middleware, [(b"x-melinda-agent", b"ALFRED")])
    assert status == 204
    assert producer == "ALL_ACCESS"

    monkeypatch.setenv("MELINDAOS_MCP_TOKEN", "master-secret-for-test")
    rejected_status, _ = _run_auth_request(middleware, [(b"authorization", b"Bearer wrong")])
    assert rejected_status == 401

    accepted_status, accepted_producer = _run_auth_request(
        middleware,
        [(b"authorization", b"Bearer master-secret-for-test"), (b"x-melinda-agent", b"PARMA")],
    )
    assert accepted_status == 204
    assert accepted_producer == "ALL_ACCESS"


def test_dashboard_mcp_call_falls_back_locally_when_url_unset(monkeypatch):
    monkeypatch.delenv("MELINDAOS_DASHBOARD_URL", raising=False)
    overview = agent_mcp.dashboard_mcp_call("agent_overview")
    assert overview["access_mode"] == "ALL_ACCESS"
    assert json.loads(json.dumps(overview))["status"] == "ok"
