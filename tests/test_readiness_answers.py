import importlib.util
import json
from pathlib import Path

import pytest

import readiness.__main__ as cli
from readiness.answers import METHOD, apply_answers, load_answers
from readiness.apply import DRAFT_STATUS_DETAIL, PROVENANCE, RESIDUALS
from readiness.queue import QUEUE, QueueError, item_id
from readiness.scan import DRAFT_MARKER, scan_text

_spec = importlib.util.spec_from_file_location("validate_frontmatter", Path(__file__).resolve().parents[1] / "tools" / "governance" / "validate_frontmatter.py")
vf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vf)

DOC = "knowledge/01_HOSPITAL/x/kb-operasional-x.md"
OTHER = "knowledge/01_HOSPITAL/x/kb-operasional-y.md"
FRONT = '---\ndoc_id: "SOP-OPS-X"\ntitle: "Dokumen X"\ndomain: "Operasional"\nversion: "1.0"\nlast_reviewed: "2026-11-01"\nftdr_safety_override: false\ntags: ["x"]\ngovernance:\n  status: "APPROVED"\n---\n'
L_JAM = "| Jam buka | [ISI jam] s.d. [ISI jam] |"
L_UNIT = "| Unit pemilik | Farmasi [CEK] |"
L_CAT = "| Catatan | Belum termasuk BMHP [CEK] |"
L_DOSE = "Dosis maksimal [ISI] mg per hari."
HEAD = "Status: DRAF UNTUK KOREKSI\n\n## Jadwal\n\n"
PLAIN = f"{HEAD}{L_JAM}\n{L_UNIT}\n{L_CAT}\n"
BODY = f"{PLAIN}{L_DOSE}\n"
L_ONE = "| Jam buka | [ISI jam] |"
TWINS = f"{HEAD}{L_ONE}\n\n## Rawat inap\n\n{L_ONE}\n"
L_ROLE = "| Penanggung jawab | [ISI] | [ISI] |"
DIRECTOR_FACT = [{"key": "director.name", "value": "dr. Contoh", "status": "verified"}]


def director_rows(body: str, doc: str = DOC, shift: int = 0) -> list[dict]:
    return [
        {"docPath": doc, "line": p.line + shift, "placeholder": p.raw, "reason": "director", "detail": f"Perlu data RS: {index}"}
        for index, p in enumerate(item for item in scan_text(doc, FRONT + body) if not item.in_code)
    ]


def make_repo(tmp_path: Path, body: str = BODY, rows: list[dict] | None = None, newline: str = "\n", facts: list[dict] | None = None) -> Path:
    (tmp_path / "knowledge/01_HOSPITAL/x").mkdir(parents=True)
    (tmp_path / "dashboard/data/studio").mkdir(parents=True)
    (tmp_path / "dashboard/data/studio/facts.json").write_text(json.dumps(facts or []), encoding="utf-8")
    write_doc(tmp_path, FRONT + body, newline)
    residuals = tmp_path / RESIDUALS
    residuals.parent.mkdir(parents=True)
    residuals.write_text(json.dumps(director_rows(body) if rows is None else rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return tmp_path


def write_doc(root: Path, text: str, newline: str = "\n", doc: str = DOC) -> None:
    with open(root / doc, "w", encoding="utf-8", newline="") as handle:
        handle.write(text.replace("\n", newline))


def read_doc(root: Path, doc: str = DOC) -> str:
    with open(root / doc, encoding="utf-8", newline="") as handle:
        return handle.read()


def row(line_text: str, placeholder: str, decision: str, text: str = "", nth: int = 0, id: str | None = None, doc: str = DOC, twin: int = 0) -> dict:
    """An answer row as the dashboard downloads it. `nth` picks the placeholder on the line, `twin` the line among identical ones."""
    column = -1
    for _ in range(nth + 1):
        column = line_text.index(placeholder, column + 1)
    return {"id": id or item_id(doc, line_text, twin), "docPath": doc, "lineText": line_text, "column": column, "placeholder": placeholder, "decision": decision,
            "text": text, "answeredBy": "director-test", "answeredAt": "2026-11-12T03:00:00.000Z"}


def residual_rows(root: Path, doc: str = DOC) -> list[dict]:
    return [r for r in json.loads((root / RESIDUALS).read_text(encoding="utf-8")) if r["docPath"] == doc]


VALUE = row(L_JAM, "[ISI jam]", "value", "07.00")
CONFIRM = row(L_UNIT, "[CEK]", "confirm")


def test_value_and_confirm_change_only_their_placeholders(tmp_path: Path):
    repo = make_repo(tmp_path)
    report = apply_answers(repo, [VALUE, CONFIRM], apply=True, backup_dir=tmp_path / "backup")
    assert read_doc(repo) == FRONT + BODY.replace(L_JAM, "| Jam buka | 07.00 s.d. [ISI jam] |").replace(L_UNIT, "| Unit pemilik | Farmasi |")
    assert len(report.applied) == 2 and report.files_changed == 1
    assert not report.stale and not report.refused and not report.corrections
    assert (tmp_path / "backup" / DOC).read_text(encoding="utf-8") == FRONT + BODY


def test_dry_run_writes_nothing(tmp_path: Path):
    repo = make_repo(tmp_path)
    residuals_before = (repo / RESIDUALS).read_bytes()
    report = apply_answers(repo, [VALUE], backup_dir=tmp_path / "backup")
    assert len(report.applied) == 1 and report.files_changed == 0
    assert read_doc(repo) == FRONT + BODY and (repo / RESIDUALS).read_bytes() == residuals_before
    assert not (repo / PROVENANCE).exists() and not (repo / QUEUE).exists() and not (tmp_path / "backup").exists()


def test_match_ignores_line_numbers(tmp_path: Path):
    repo = make_repo(tmp_path)
    write_doc(repo, FRONT + "Paragraf baru.\n\n" + BODY)
    report = apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    assert len(report.applied) == 1 and "| Jam buka | 07.00 s.d. [ISI jam] |" in read_doc(repo)


def test_second_placeholder_on_a_line_is_matched_by_column(tmp_path: Path):
    repo = make_repo(tmp_path)
    apply_answers(repo, [row(L_JAM, "[ISI jam]", "value", "14.00", nth=1)], apply=True, backup_dir=tmp_path / "backup")
    assert "| Jam buka | [ISI jam] s.d. 14.00 |" in read_doc(repo)


def test_stale_row_is_reported_and_skipped(tmp_path: Path):
    repo = make_repo(tmp_path)
    stale = row("| Jam buka | [ISI jam] s.d. 21.00 |", "[ISI jam]", "value", "07.00")
    report = apply_answers(repo, [stale], apply=True, backup_dir=tmp_path / "backup")
    assert report.stale == [stale] and not report.applied and read_doc(repo) == FRONT + BODY


def test_row_for_a_missing_document_is_stale(tmp_path: Path):
    repo = make_repo(tmp_path)
    gone = row(L_JAM, "[ISI jam]", "value", "07.00", doc="knowledge/01_HOSPITAL/x/kb-operasional-hilang.md")
    report = apply_answers(repo, [gone, VALUE], apply=True, backup_dir=tmp_path / "backup")
    assert report.stale == [gone] and len(report.applied) == 1


def test_row_outside_the_repository_is_stale(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    (tmp_path / "luar.md").write_text(L_JAM + "\n", encoding="utf-8")
    outside = row(L_JAM, "[ISI jam]", "value", "07.00", doc="../luar.md")
    report = apply_answers(repo, [outside], apply=True, backup_dir=tmp_path / "backup")
    assert report.stale == [outside] and (tmp_path / "luar.md").read_text(encoding="utf-8") == L_JAM + "\n"


def test_clinical_value_is_refused(tmp_path: Path):
    repo = make_repo(tmp_path)
    clinical = row(L_DOSE, "[ISI]", "value", "500")
    report = apply_answers(repo, [clinical], apply=True, backup_dir=tmp_path / "backup")
    assert report.refused == [(clinical, "clinical_unquoted")] and read_doc(repo) == FRONT + BODY


def test_narrative_value_is_refused(tmp_path: Path):
    repo = make_repo(tmp_path)
    narrative = row(L_JAM, "[ISI jam]", "value", "belum ada")
    assert apply_answers(repo, [narrative], apply=True, backup_dir=tmp_path / "backup").refused == [(narrative, "ai_invalid")]


def test_confirm_on_an_isi_is_refused(tmp_path: Path):
    repo = make_repo(tmp_path)
    wrong = row(L_JAM, "[ISI jam]", "confirm")
    assert apply_answers(repo, [wrong], apply=True, backup_dir=tmp_path / "backup").refused == [(wrong, "ai_invalid")]


def test_correction_writes_nothing_and_is_reported(tmp_path: Path):
    repo = make_repo(tmp_path)
    correction = row(L_CAT, "[CEK]", "correction", "Sudah termasuk BMHP")
    report = apply_answers(repo, [correction], apply=True, backup_dir=tmp_path / "backup")
    assert report.corrections == [correction] and report.files_changed == 0 and read_doc(repo) == FRONT + BODY


def test_provenance_names_the_director(tmp_path: Path):
    repo = make_repo(tmp_path)
    apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    record = json.loads((repo / PROVENANCE).read_text(encoding="utf-8").splitlines()[-1])
    assert METHOD == "director" and record["method"] == "director" and record["sourceRef"] == "director-answer:" + VALUE["id"]
    assert record["model"] is None and record["value"] == "07.00" and record["docPath"] == DOC and record["placeholder"] == "[ISI jam]"
    assert record["answeredBy"] == "director-test" and record["answeredAt"] == "2026-11-12T03:00:00.000Z"


def test_residuals_drop_applied_rows_and_refresh_lines(tmp_path: Path):
    repo = make_repo(tmp_path, rows=director_rows(BODY, shift=-2))
    apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    fresh = director_rows(BODY)
    assert residual_rows(repo) == fresh[1:]


def test_other_documents_rows_are_kept(tmp_path: Path):
    other = [{"docPath": OTHER, "line": 99, "placeholder": "[ISI]", "reason": "director", "detail": "Perlu data RS: lain"},
             {"docPath": OTHER, "line": 5, "placeholder": "[ISI]", "reason": "inside_code", "detail": None}]
    repo = make_repo(tmp_path, rows=other[:1] + director_rows(BODY) + other[1:])
    apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    assert residual_rows(repo, OTHER) == other
    assert [r["docPath"] for r in json.loads((repo / RESIDUALS).read_text(encoding="utf-8"))] == [OTHER, DOC, DOC, DOC, DOC, OTHER]


def test_draft_marker_is_never_changed(tmp_path: Path):
    repo = make_repo(tmp_path, PLAIN)
    answers = [VALUE, row(L_JAM, "[ISI jam]", "value", "14.00", nth=1), CONFIRM, row(L_CAT, "[CEK]", "confirm")]
    report = apply_answers(repo, answers, apply=True, backup_dir=tmp_path / "backup")
    text = read_doc(repo)
    assert len(report.applied) == 4 and "Status: DRAF UNTUK KOREKSI" in text and "[ISI" not in text and "[CEK" not in text
    assert residual_rows(repo) == [{"docPath": DOC, "line": 12, "placeholder": DRAFT_MARKER, "reason": "director", "detail": DRAFT_STATUS_DETAIL}]
    data, body = vf.split_frontmatter(text)
    assert vf.readiness_issues(data, body, [DRAFT_MARKER]) == []
    assert vf.readiness_issues(data, body, []) != []


def test_out_of_order_residuals_leave_the_document_untouched(tmp_path: Path):
    repo = make_repo(tmp_path, rows=director_rows(BODY)[:-1])
    report = apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    assert report.refused == [(VALUE, "residuals_out_of_order")] and not report.applied and read_doc(repo) == FRONT + BODY


def test_crlf_document_keeps_its_line_endings(tmp_path: Path):
    repo = make_repo(tmp_path, newline="\r\n")
    report = apply_answers(repo, [VALUE], apply=True, backup_dir=tmp_path / "backup")
    text = read_doc(repo)
    assert len(report.applied) == 1 and "| Jam buka | 07.00 s.d. [ISI jam] |\r\n" in text and "\n" not in text.replace("\r\n", "")


def test_load_answers_reads_rows_and_rejects_a_row_without_a_required_key(tmp_path: Path):
    good = tmp_path / "good.json"
    good.write_text(json.dumps({"exportedAt": "2026-11-12T03:05:00.000Z", "rows": [VALUE]}), encoding="utf-8")
    assert load_answers(good) == [VALUE]
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"exportedAt": "x", "rows": [{key: value for key, value in VALUE.items() if key != "lineText"}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="lineText"):
        load_answers(bad)


def answers_file(tmp_path: Path, rows: list[dict]) -> str:
    path = tmp_path / "director-answers.json"
    path.write_text(json.dumps({"exportedAt": "2026-11-12T03:05:00.000Z", "rows": rows}), encoding="utf-8")
    return str(path)


def test_cli_answers_dry_run_and_apply(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    repo = make_repo(tmp_path / "repo")
    monkeypatch.setattr(cli, "REPO_ROOT", repo)
    file = answers_file(tmp_path, [VALUE])
    assert cli.main(["--answers", file]) == 0
    out = capsys.readouterr().out
    assert out.startswith("DRY RUN") and "applied=1" in out and not (repo / QUEUE).exists() and read_doc(repo) == FRONT + BODY
    assert cli.main(["--answers", file, "--apply"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("APPLIED") and "applied=1" in out and "files_changed=1" in out
    texts = [item["text"] for item in json.loads((repo / QUEUE).read_text(encoding="utf-8"))["items"]]
    assert L_JAM not in texts and "| Jam buka | 07.00 s.d. [ISI jam] |" in texts


def test_cli_plain_apply_regenerates_the_queue_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    body = "| Jam | [ISI jam] |\n"
    repo = make_repo(tmp_path / "repo", body)
    monkeypatch.setattr(cli, "REPO_ROOT", repo)
    decisions = tmp_path / "fills.json"
    decisions.write_text(json.dumps([{"docPath": DOC, "line": 12, "column": 8, "placeholder": "[ISI jam]", "value": "07.00", "sourceRef": DOC, "quote": None}]), encoding="utf-8")
    assert cli.main(["--apply", "--fills", str(decisions)]) == 0
    assert "| Jam | 07.00 |" in read_doc(repo)
    assert json.loads((repo / QUEUE).read_text(encoding="utf-8"))["items"] == []
    capsys.readouterr()


def test_cli_returns_3_when_the_queue_cannot_be_regenerated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    repo = make_repo(tmp_path / "repo")
    monkeypatch.setattr(cli, "REPO_ROOT", repo)

    def broken(root: Path) -> Path:
        raise QueueError("x")

    monkeypatch.setattr(cli, "write_queue", broken)
    assert cli.main(["--answers", answers_file(tmp_path, [VALUE]), "--apply"]) == 3
    assert "queue file not regenerated: x" in capsys.readouterr().out and "| Jam buka | 07.00 s.d. [ISI jam] |" in read_doc(repo)


def test_cli_answers_refuses_other_modes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    repo = make_repo(tmp_path / "repo")
    monkeypatch.setattr(cli, "REPO_ROOT", repo)
    assert cli.main(["--answers", answers_file(tmp_path, [VALUE]), "--apply", "--fills", "x.json"]) == 2
    assert "--answers cannot be combined" in capsys.readouterr().out and read_doc(repo) == FRONT + BODY


@pytest.mark.parametrize("text", ["07.00 | 21.00", "07.00\n21.00", "07.00\r21.00", "`07.00", "07.00\t21.00", "07.00\u202821.00", "07.00\x8521.00"])
def test_value_that_could_break_the_line_is_refused(tmp_path: Path, text: str):
    # The download file passes through a person's hands, so the last gate before the documents checks again.
    repo = make_repo(tmp_path)
    unsafe = row(L_JAM, "[ISI jam]", "value", text)
    report = apply_answers(repo, [unsafe], apply=True, backup_dir=tmp_path / "backup")
    assert report.refused == [(unsafe, "unsafe_value")] and not report.applied
    assert read_doc(repo) == FRONT + BODY


def test_answer_for_the_second_of_two_identical_lines_changes_the_second(tmp_path: Path):
    repo = make_repo(tmp_path, TWINS)
    report = apply_answers(repo, [row(L_ONE, "[ISI jam]", "value", "14.00", twin=1)], apply=True, backup_dir=tmp_path / "backup")
    assert read_doc(repo) == FRONT + f"{HEAD}{L_ONE}\n\n## Rawat inap\n\n| Jam buka | 14.00 |\n"
    assert len(report.applied) == 1 and not report.refused and not report.stale


def test_identical_lines_each_get_their_own_answer(tmp_path: Path):
    repo = make_repo(tmp_path, TWINS)
    answers = [row(L_ONE, "[ISI jam]", "value", "14.00", twin=1), row(L_ONE, "[ISI jam]", "value", "07.00")]
    report = apply_answers(repo, answers, apply=True, backup_dir=tmp_path / "backup")
    assert read_doc(repo) == FRONT + f"{HEAD}| Jam buka | 07.00 |\n\n## Rawat inap\n\n| Jam buka | 14.00 |\n"
    assert len(report.applied) == 2 and not report.refused and not report.stale


def test_row_whose_id_no_line_has_is_stale(tmp_path: Path):
    repo = make_repo(tmp_path)
    unknown = row(L_JAM, "[ISI jam]", "value", "07.00", id="f" * 16)
    report = apply_answers(repo, [unknown], apply=True, backup_dir=tmp_path / "backup")
    assert report.stale == [unknown] and not report.applied and read_doc(repo) == FRONT + BODY


@pytest.mark.parametrize("apply", [False, True])
def test_value_that_would_let_a_fact_fill_the_next_placeholder_is_refused(tmp_path: Path, apply: bool):
    body = f"{HEAD}{L_ROLE}\n{L_UNIT}\n"
    repo = make_repo(tmp_path, body, facts=DIRECTOR_FACT)
    role, confirm = row(L_ROLE, "[ISI]", "value", "Direktur"), row(L_UNIT, "[CEK]", "confirm")
    report = apply_answers(repo, [role, confirm], apply=apply, backup_dir=tmp_path / "backup")
    assert report.refused == [(role, "side_effect"), (confirm, "side_effect")] and not report.applied and report.files_changed == 0
    assert read_doc(repo) == FRONT + body and not (repo / PROVENANCE).exists()


def test_answer_already_applied_is_not_applied_to_the_identical_line_that_inherits_its_id(tmp_path: Path):
    repo = make_repo(tmp_path, TWINS)
    first = row(L_ONE, "[ISI jam]", "value", "07.00")
    apply_answers(repo, [first], apply=True, backup_dir=tmp_path / "backup")
    after_first = read_doc(repo)
    report = apply_answers(repo, [first], apply=True, backup_dir=tmp_path / "backup")
    assert report.refused == [(first, "already_applied")] and not report.applied and read_doc(repo) == after_first
