import json
from pathlib import Path

from readiness.apply import PROVENANCE, RESIDUALS, apply_fills, run
from readiness.resolve_facts import Fill
from readiness.scan import scan_text

FRONT = '---\ndoc_id: "SOP-OPS-X"\ntitle: "X"\ndomain: "Operasional"\nversion: "1.0"\nlast_reviewed: "2026-11-01"\nftdr_safety_override: false\ntags: ["x"]\ngovernance:\n  status: "APPROVED"\n---\n'
BODY = "# X\n\nStatus: DRAF UNTUK KOREKSI — belum disahkan\n\n| Status | DRAF UNTUK KOREKSI; nominal belum final |\n| Jam | [ISI] s.d. [ISI] jam |\n| Ditetapkan oleh | Direktur [ISI] |\n| Unit pemilik | Farmasi [CEK] |\n"


def fills_for(text: str, values: dict[int, str]) -> list[Fill]:
    items = scan_text("x/kb-operasional-x.md", text)
    return [Fill(p, values[i], "ai", "ref", None, "m") for i, p in enumerate(items) if i in values]


def test_two_fills_on_one_line_keep_positions_and_marker_is_removed_when_ready():
    text = FRONT + BODY
    out = apply_fills(text, fills_for(text, {0: "07.00", 1: "14.00", 2: "dr. A", 3: ""}), ready=True)
    assert "| Jam | 07.00 s.d. 14.00 jam |" in out
    assert "| Ditetapkan oleh | Direktur dr. A |" in out
    assert "| Unit pemilik | Farmasi |" in out
    assert "Status: DRAF" not in out and "| Status | BERLAKU; nominal belum final |" in out


def test_marker_kept_when_not_ready_and_crlf_preserved():
    text = (FRONT + BODY).replace("\n", "\r\n")
    out = apply_fills(text, fills_for(text, {0: "07.00"}), ready=False)
    assert "\r\n" in out and "\n" not in out.replace("\r\n", "")
    assert "Status: DRAF UNTUK KOREKSI" in out and "| Jam | 07.00 s.d. [ISI] jam |" in out


def make_repo(tmp_path: Path, body: str = BODY) -> Path:
    (tmp_path / "knowledge/01_HOSPITAL/x").mkdir(parents=True)
    (tmp_path / "dashboard/data/studio").mkdir(parents=True)
    (tmp_path / "dashboard/data/studio/facts.json").write_text(json.dumps([{"key": "director.name", "value": "dr. Ferdi", "status": "verified"}]), encoding="utf-8")
    (tmp_path / "knowledge/01_HOSPITAL/x/kb-operasional-x.md").write_text(FRONT + body, encoding="utf-8")
    return tmp_path


def answers(value="07.00"):
    return lambda body: {"content": [{"type": "text", "text": json.dumps({"value": value, "source_ref": "knowledge/01_HOSPITAL/x/kb-operasional-x.md", "quote": None})}]}


def test_run_applies_logs_provenance_and_is_idempotent(tmp_path: Path):
    root = make_repo(tmp_path)
    doc = root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md"
    backups = tmp_path / "bak"
    first = run(root, apply=True, transport=answers(), model="m", backup_dir=backups)
    assert (first.files_changed, first.fills, first.residuals, first.ai_pending) == (1, 4, 0, 0)
    assert first.by_method == {"ai": 3, "fact": 1}
    text = doc.read_text(encoding="utf-8")
    assert "[ISI]" not in text and "[CEK]" not in text and "DRAF UNTUK KOREKSI" not in text
    assert "| Ditetapkan oleh | Direktur dr. Ferdi |" in text
    assert (backups / "knowledge/01_HOSPITAL/x/kb-operasional-x.md").exists()
    rows = [json.loads(line) for line in (root / PROVENANCE).read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 4
    assert set(rows[0]) == {"docPath", "line", "placeholder", "value", "method", "sourceRef", "quote", "model", "at"}
    fact = next(r for r in rows if r["method"] == "fact")
    assert fact["value"] == "dr. Ferdi" and fact["sourceRef"] == "dashboard/data/studio/facts.json#director.name" and fact["model"] is None
    assert json.loads((root / RESIDUALS).read_text(encoding="utf-8")) == []
    second = run(root, apply=True, transport=answers(), model="m", backup_dir=backups)
    assert (second.files_changed, second.fills) == (0, 0)
    assert len((root / PROVENANCE).read_text(encoding="utf-8").splitlines()) == 4


def test_api_error_leaves_file_untouched(tmp_path: Path):
    root = make_repo(tmp_path)
    doc = root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md"
    before = doc.read_text(encoding="utf-8")

    def flaky(body):
        raise TimeoutError("down")

    report = run(root, apply=True, transport=flaky, model="m", backup_dir=tmp_path / "bak")
    assert report.files_changed == 0 and report.fills == 1 and report.by_reason == {"api_error": 3}
    assert doc.read_text(encoding="utf-8") == before
    assert not (root / PROVENANCE).exists()
    assert len(json.loads((root / RESIDUALS).read_text(encoding="utf-8"))) == 3


def test_dry_run_without_transport_counts_pending_and_writes_nothing(tmp_path: Path):
    root = make_repo(tmp_path)
    report = run(root, apply=False, transport=None, model="m")
    assert (report.files_changed, report.fills, report.ai_pending, report.residuals) == (0, 1, 3, 0)
    assert "[ISI]" in (root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md").read_text(encoding="utf-8")
    assert not (root / RESIDUALS).exists()


def test_residual_keeps_marker_but_fills_are_written(tmp_path: Path):
    root = make_repo(tmp_path, BODY + "\n```\n[ISI]\n```\n")
    report = run(root, apply=True, transport=answers(), model="m", backup_dir=tmp_path / "bak")
    assert report.files_changed == 1 and report.by_reason == {"inside_code": 1}
    text = (root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md").read_text(encoding="utf-8")
    assert "Status: DRAF UNTUK KOREKSI" in text and "| Jam | 07.00 s.d. 07.00 jam |" in text


def test_draft_marker_without_placeholders_is_a_director_residual(tmp_path: Path):
    root = make_repo(tmp_path, "# X\n\nStatus: DRAF UNTUK KOREKSI, menunggu SK Direktur.\n")
    report = run(root, apply=True, transport=None, model="m", backup_dir=tmp_path / "bak")
    assert (report.files_changed, report.fills, report.by_reason) == (0, 0, {"director": 1})
    rows = json.loads((root / RESIDUALS).read_text(encoding="utf-8"))
    assert rows[0]["placeholder"] == "DRAF UNTUK KOREKSI" and rows[0]["line"] == 14
    assert "DRAF UNTUK KOREKSI" in (root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md").read_text(encoding="utf-8")


def test_session_decisions_fill_or_park_without_any_transport(tmp_path: Path):
    from readiness.apply import load_manual, template_rows

    root = make_repo(tmp_path)
    doc = root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md"
    probe = run(root, apply=False, transport=None, model="m")
    rows = template_rows(root, probe.pending_items)
    assert [r["placeholder"] for r in rows] == ["[ISI]", "[ISI]", "[CEK]"] and rows[0]["text"].startswith("| Jam |")
    rows[0].update(value="07.00", sourceRef="knowledge/01_HOSPITAL/x/kb-operasional-x.md")
    rows[1].update(residual="director", note="jam tutup belum ditetapkan")
    rows[2].update(value="")
    decisions = tmp_path / "fills.json"
    decisions.write_text(json.dumps(rows), encoding="utf-8")
    report = run(root, apply=True, transport=None, model="m", backup_dir=tmp_path / "bak", manual=load_manual(decisions))
    assert (report.files_changed, report.fills, report.residuals, report.ai_pending) == (1, 3, 1, 0)
    assert report.by_method == {"fact": 1, "session": 2} and report.by_reason == {"director": 1}
    text = doc.read_text(encoding="utf-8")
    assert "| Jam | 07.00 s.d. [ISI] jam |" in text and "| Unit pemilik | Farmasi |" in text and "DRAF UNTUK KOREKSI" in text
    residuals = json.loads((root / RESIDUALS).read_text(encoding="utf-8"))
    assert residuals == [{"docPath": "knowledge/01_HOSPITAL/x/kb-operasional-x.md", "line": 17, "placeholder": "[ISI]", "reason": "director", "detail": "jam tutup belum ditetapkan"}]
    session = [r for r in (root / PROVENANCE).read_text(encoding="utf-8").splitlines() if '"session"' in r]
    assert len(session) == 2 and "Claude Code session" in session[0]
    # A form cell: the remaining [ISI] becomes a blank cell (an empty [ISI] value is otherwise rejected).
    rows[1] = {**rows[1], "residual": None, "form": True}
    decisions.write_text(json.dumps([rows[1]]), encoding="utf-8")
    again = run(root, apply=True, transport=None, model="m", backup_dir=tmp_path / "bak", manual=load_manual(decisions))
    assert (again.fills, again.residuals, again.by_method) == (1, 0, {"session": 1})
    assert "| Jam | 07.00 s.d. jam |" in doc.read_text(encoding="utf-8")
    assert json.loads((root / RESIDUALS).read_text(encoding="utf-8")) == []


def test_single_file_apply_keeps_other_documents_residuals(tmp_path: Path):
    root = make_repo(tmp_path, body="# X\n\nStatus: DRAF UNTUK KOREKSI, menunggu SK Direktur.\n")
    other = {"docPath": "knowledge/01_HOSPITAL/y/kb-operasional-y.md", "line": 9, "placeholder": "[ISI]", "reason": "director", "detail": "milik dokumen lain"}
    stale = {"docPath": "knowledge/01_HOSPITAL/x/kb-operasional-x.md", "line": 99, "placeholder": "[ISI]", "reason": "director", "detail": "baris lama"}
    (root / RESIDUALS).parent.mkdir(parents=True)
    (root / RESIDUALS).write_text(json.dumps([stale, other]), encoding="utf-8")
    run(root, apply=True, transport=None, model="m", backup_dir=tmp_path / "bak", only=root / "knowledge/01_HOSPITAL/x/kb-operasional-x.md")
    rows = json.loads((root / RESIDUALS).read_text(encoding="utf-8"))
    assert rows[-1] == other and stale not in rows
    assert [row["placeholder"] for row in rows if row["docPath"].endswith("kb-operasional-x.md")] == ["DRAF UNTUK KOREKSI"]
