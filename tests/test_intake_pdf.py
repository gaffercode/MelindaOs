import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "governance" / "intake_pdf.py"
_spec = importlib.util.spec_from_file_location("intake_pdf", SCRIPT)
intake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(intake)

META = {"title": "SPO Contoh Uji", "domain": "Operasional", "department": "Farmasi", "folder": "knowledge/01_HOSPITAL/hospital_sop", "topic": "spo-contoh-uji", "source": "sources/raw/contoh.pdf", "today": "2026-11-11"}
TEXT_PAGE = ("Pengertian\nObat disimpan pada suhu ruang sesuai label pabrik.", "teks")


def test_text_layer_only_draft_passes_the_checker(tmp_path: Path):
    text, anomalies = intake.build_document([TEXT_PAGE], **META)
    assert anomalies == [] and "governance:" in text and 'source_raw_path: sources/raw/contoh.pdf' in text
    target = intake.target_path(tmp_path, META["folder"], META["domain"], META["topic"])
    intake.write_new(target, text)
    assert target.name == "kb-operasional-spo-contoh-uji.md"
    assert intake.spec.check_a(target, tmp_path) == []


def test_ocr_and_unreadable_pages_keep_the_draft_out_of_approved(tmp_path: Path):
    pages = [TEXT_PAGE, ("Teks hasil baca mesin.", "ocr"), ("", "kosong")]
    text, anomalies = intake.build_document(pages, **META)
    assert anomalies[0].startswith("OCR: halaman 2 ") and anomalies[1].startswith("KOSONG: halaman 3 ")
    assert "governance:" not in text and 'review_status: "NEEDS_CHIEF_REVIEW"' in text and "Teks hasil baca mesin." in text
    target = tmp_path / "knowledge/01_HOSPITAL/hospital_sop/kb-operasional-spo-contoh-uji.md"
    intake.write_new(target, text)
    assert intake.spec.check_a(target, tmp_path) != []


def test_existing_file_is_never_overwritten(tmp_path: Path):
    target = tmp_path / "kb-operasional-x.md"
    target.write_text("isi lama", encoding="utf-8")
    with pytest.raises(FileExistsError):
        intake.write_new(target, "isi baru")
    assert target.read_text(encoding="utf-8") == "isi lama"


def test_target_must_be_a_knowledge_folder(tmp_path: Path):
    with pytest.raises(SystemExit):
        intake.target_path(tmp_path, "dashboard/data", "Operasional", "x")


def test_recheck_refuses_until_a_person_has_cleared_the_machine_read_pages(tmp_path: Path):
    text, _ = intake.build_document([TEXT_PAGE, ("Teks hasil baca mesin.", "ocr")], **META)
    draft = tmp_path / "kb-operasional-spo-contoh-uji.md"
    intake.write_new(draft, text)
    with pytest.raises(SystemExit, match="belum dicocokkan"):
        intake.recheck(draft)
    assert draft.read_text(encoding="utf-8") == text
    kept = [line for line in text.splitlines() if "OCR: halaman" not in line and line != "anomalies:"]
    draft.write_text("\n".join(kept) + "\n", encoding="utf-8", newline="\n")
    intake.recheck(draft)
    assert "governance:" in draft.read_text(encoding="utf-8")


def test_recheck_never_touches_a_file_that_is_not_an_intake_draft(tmp_path: Path):
    text, _ = intake.build_document([TEXT_PAGE], **META)
    approved = tmp_path / "kb-operasional-spo-contoh-uji.md"
    intake.write_new(approved, text)
    with pytest.raises(SystemExit, match="Bukan draf intake"):
        intake.recheck(approved)
    assert approved.read_text(encoding="utf-8") == text


def test_a_scanner_stamp_alone_is_not_a_text_layer():
    assert not intake.has_text_layer("Dipindai dengan CamScanner")
    assert intake.has_text_layer("Obat disimpan pada suhu ruang.")
