import pytest

from melinda_maaf import hospital_adapter
from melinda_maaf.hospital_adapter import (
    check_emergency_red_flags,
    get_bed_availability,
    query_doctor_schedule,
)


def test_red_flag_triggers_emergency_routing():
    result = check_emergency_red_flags(["ibu hamil mengalami perdarahan jalan lahir aktif"])
    assert result["is_emergency"] is True
    assert result["status"] == "EMERGENCY_RED_FLAG_TRIGGERED"
    assert result["routing"] == "IGD_24_JAM"


def test_every_ontology_red_flag_phrase_triggers_emergency_routing():
    specification = hospital_adapter._load_ontology()["emergency_red_flags"]

    for trigger in specification["maternal_triggers"] + specification["pediatric_triggers"]:
        result = check_emergency_red_flags([trigger])
        assert result["status"] == "EMERGENCY_RED_FLAG_TRIGGERED", trigger
        assert result["routing"] == "IGD_24_JAM", trigger


@pytest.mark.parametrize("ontology_content", [None, "{", '{"emergency_red_flags": []}'])
def test_unavailable_or_malformed_ontology_requires_human_assessment(tmp_path, monkeypatch, ontology_content):
    ontology_path = tmp_path / "ontology.json"
    if ontology_content is not None:
        ontology_path.write_text(ontology_content, encoding="utf-8")
    monkeypatch.setattr(hospital_adapter, "ONTOLOGY_PATH", ontology_path)

    result = check_emergency_red_flags(["kontrol rutin kehamilan tanpa keluhan"])

    assert result["status"] == "ASSESSMENT_UNAVAILABLE_ESCALATE"
    assert result["is_emergency"] is None
    assert result["routing"] == "HUMAN_CLINICAL_ASSESSMENT"


def test_empty_symptom_input_requires_human_assessment():
    result = check_emergency_red_flags([])

    assert result["status"] == "ASSESSMENT_UNAVAILABLE_ESCALATE"
    assert result["is_emergency"] is None
    assert result["routing"] == "HUMAN_CLINICAL_ASSESSMENT"


def test_non_emergency_passes_to_polyclinic():
    result = check_emergency_red_flags(["kontrol rutin kehamilan trimester 2 tanpa keluhan"])
    assert result["is_emergency"] is False
    assert result["status"] == "NO_RED_FLAG_DETECTED"
    assert result["routing"] == "POLIKLINIK_REGULER"


def test_doctor_schedule_query():
    result = query_doctor_schedule(specialty="obgyn")
    assert result["status"] == "configuration_required"
    assert result["mode"] == "not_configured"
    assert result["results"] == []


def test_doctor_schedule_query_passes_date_to_connector(monkeypatch):
    calls = []
    monkeypatch.setattr(
        hospital_adapter._medify,
        "get_doctor_schedules",
        lambda specialty=None, date=None: calls.append((specialty, date)) or {"status": "ok"},
    )

    query_doctor_schedule(specialty="obgyn", date="2026-10-07")

    assert calls == [("obgyn", "2026-10-07")]


def test_doctor_schedule_connector_accepts_date_and_stays_unavailable():
    result = hospital_adapter._medify.get_doctor_schedules(specialty="obgyn", date="2026-10-07")

    assert result["status"] == "configuration_required"
    assert result["results"] == []


def test_bed_availability_structure():
    beds = get_bed_availability()
    assert beds["status"] == "configuration_required"
    assert beds["mode"] == "not_configured"
    assert "wards" not in beds
