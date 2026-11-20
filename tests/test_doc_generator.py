from __future__ import annotations

import json
from pathlib import Path

from doc_generator.cli_runner import decide_doc_type, generate_for_ep, load_ep


def test_load_ep_existing():
    ep = load_ep("47104-2024:TKRS:1:1")
    assert ep["id"] == "47104-2024:TKRS:1:1"
    assert ep["chapterCode"] == "TKRS"
    assert "R" in ep["evidenceKinds"]


def test_decide_doc_type_rules():
    tkrs_ep = {"chapterCode": "TKRS", "text": "Ditetapkan oleh Pemilik"}
    assert decide_doc_type(tkrs_ep, "auto") == "SK"

    skp_ep = {"chapterCode": "SKP", "text": "Tata laksana pemberian obat"}
    assert decide_doc_type(skp_ep, "auto") == "SPO"

    assert decide_doc_type(skp_ep, "sk") == "SK"
    assert decide_doc_type(tkrs_ep, "spo") == "SPO"


def test_generate_for_ep_dry_run():
    result = generate_for_ep("47104-2024:TKRS:1:1", dry_run=True)
    assert result["success"] is True
    assert result["docType"] == "SK"
    assert result["chapter"] == "TKRS"
    assert result["nomor"].startswith("SK-DIR/TKRS/2026/")
    assert result["dryRun"] is True


def test_generate_for_ep_compilation(tmp_path: Path):
    target_pdf = tmp_path / "test_ep_sk.pdf"
    result = generate_for_ep("47104-2024:TKRS:1:1", output_path=target_pdf, dry_run=False)
    assert result["success"] is True
    assert target_pdf.exists()
    assert target_pdf.stat().st_size > 1000

    # Verify PDF magic bytes
    with open(target_pdf, "rb") as f:
        header = f.read(5)
    assert header.startswith(b"%PDF-")
