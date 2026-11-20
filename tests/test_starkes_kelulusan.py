import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STARKES = REPO_ROOT / "knowledge/11_MACHINE_READABLE" / "starkes"
KELULUSAN = STARKES / "starkes-kelulusan-2024.json"
SCHEMA = STARKES / "schema-starkes-kelulusan.json"


def test_kelulusan_non_teaching_values():
    data = json.loads(KELULUSAN.read_text(encoding="utf-8"))
    nt = data["non_teaching"]
    assert nt["paripurna"] == {"chapters_min_80": "all_applicable_except_prognas", "prognas_min": 100}
    assert nt["utama"] == {"chapters_min_80_range": [11, 13], "skp_min": 80, "prognas_min": 100}
    assert nt["madya"] == {"chapters_min_80_range": [7, 10], "skp_min": 70, "prognas_min": 100}
    assert nt["tidak_terakreditasi"] == {"chapters_min_80_below": 7, "skp_below": 70, "prognas_below": 100, "logic": "any"}
    assert data["source"]["sha256"] and data["source"]["page"]


def test_kelulusan_teaching_utama_range():
    data = json.loads(KELULUSAN.read_text(encoding="utf-8"))
    assert data["teaching"]["utama"]["chapters_min_80_range"] == [11, 14]
    assert data["teaching"]["paripurna"] == data["non_teaching"]["paripurna"]


def test_kelulusan_source_cites_survey_guideline():
    data = json.loads(KELULUSAN.read_text(encoding="utf-8"))
    assert "HK.02.02/D/43961/2024" in data["source"]["decree"]
    assert data["standard"]["decree"].endswith("HK.01.07/MENKES/1596/2024")


def test_kelulusan_matches_schema():
    jsonschema = __import__("jsonschema")
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    data = json.loads(KELULUSAN.read_text(encoding="utf-8"))
    jsonschema.validate(data, schema)
