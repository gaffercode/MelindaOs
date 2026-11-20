"""The committed EP register must be the complete instrument 47104/2024, not a pilot."""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STARKES = REPO_ROOT / "dashboard" / "data" / "starkes"
ID = re.compile(r"^47104-2024:[A-Z]+:\d+(\.\d+)*:\d+$")
PILOT = {
    "47104-2024:SKP:1:1": ("Penetapan regulasi enam sasaran keselamatan pasien.", ["sk-skp"]),
    "47104-2024:SKP:1:2": ("Penerapan identifikasi pasien dengan sedikitnya dua identitas sesuai ketentuan rumah sakit.", ["spo-identifikasi", "materi-identifikasi", "monitoring-identifikasi"]),
    "47104-2024:SKP:1:3": ("Identifikasi sebelum terapi, tindakan, pemeriksaan diagnostik, dan penyajian makanan.", ["spo-identifikasi", "form-audit-identifikasi"]),
    "47104-2024:SKP:1:4": ("Identifikasi pada situasi khusus dan penggunaan label yang tepat.", ["spo-identifikasi", "form-audit-identifikasi"]),
}


def load():
    register = json.loads((STARKES / "requirements.json").read_text(encoding="utf-8"))
    baseline = json.loads((STARKES / "baseline.json").read_text(encoding="utf-8"))
    return register, baseline


def test_register_is_complete_and_matches_baseline_counts():
    register, baseline = load()
    assert register["complete"] is True
    assert baseline["status"] == "verified"
    eps = register["requirements"]
    assert len(eps) == baseline["epTotal"]
    by_chapter = {}
    for ep in eps:
        by_chapter[ep["chapterCode"]] = by_chapter.get(ep["chapterCode"], 0) + 1
    assert by_chapter == baseline["epCountByChapter"]
    assert sorted(by_chapter) == sorted(baseline["chapters"]) and len(by_chapter) == 16


def test_ids_unique_well_formed_and_consistent_with_fields():
    register, baseline = load()
    ids = [ep["id"] for ep in register["requirements"]]
    assert len(ids) == len(set(ids))
    for ep in register["requirements"]:
        assert ID.match(ep["id"]), ep["id"]
        standard = ep["standardCode"].removeprefix(ep["chapterCode"]).strip()
        assert ep["id"] == f"47104-2024:{ep['chapterCode']}:{standard}:{ep['epCode']}"
        assert ep["evidenceKinds"] and set(ep["evidenceKinds"]) <= {"R", "D", "O", "W", "S"}
        assert ep["allowedScores"] and set(ep["allowedScores"]) <= {0, 5, 10}
    for inferred in baseline["scoreInferred"]:  # scale not printed in the PDF: recorded with its basis
        assert inferred["basis"] and next(ep for ep in register["requirements"] if ep["id"] == inferred["id"])["allowedScores"] == inferred["allowedScores"]
        assert isinstance(ep["allowsTdd"], bool)
        assert ep["sourceId"] == baseline["sources"][0]["id"] and ep["page"] >= 1
        assert ep["text"].strip() and ep["disposition"] in {"mapped", "unmapped"}
        assert isinstance(ep["documentIds"], list)


def test_pilot_skp1_records_are_unchanged():
    register, _ = load()
    by_id = {ep["id"]: ep for ep in register["requirements"]}
    for ep_id, (text, document_ids) in PILOT.items():
        assert by_id[ep_id]["text"] == text and by_id[ep_id]["documentIds"] == document_ids and by_id[ep_id]["disposition"] == "mapped"


def test_every_standard_has_consecutive_eps_from_one():
    register, _ = load()
    by_standard: dict[str, list[int]] = {}
    for ep in register["requirements"]:
        by_standard.setdefault(ep["standardCode"], []).append(int(ep["epCode"]))
    for standard, codes in by_standard.items():
        assert sorted(codes) == list(range(1, len(codes) + 1)), standard
    assert (STARKES / "extraction-anomalies.json").exists()
    assert json.loads((STARKES / "extraction-anomalies.json").read_text(encoding="utf-8")) == []
