import pytest
from melinda_maaf.connectors.medify_simrs import MedifySIMRSConnector
from melinda_maaf.connectors.satusehat_fhir import SatuSehatFHIRConnector


def test_medify_connector_does_not_fabricate_live_operations():
    connector = MedifySIMRSConnector()
    results = [
        connector.get_doctor_schedules(specialty="obgyn"),
        connector.get_bed_capacity(),
        connector.query_queue_status("A-012"),
        connector.create_pre_registration({
        "name": "Ibu Siti Rahma",
        "phone": "08123456789",
        "target_clinic": "Poli Obgyn",
        }),
    ]

    for result in results:
        assert result["status"] == "configuration_required"
        assert result["mode"] == "not_configured"
        assert "patient_name" not in result
        assert "registration_token" not in result


def test_satusehat_ihs_lookup_nik_validation():
    connector = SatuSehatFHIRConnector()
    with pytest.raises(ValueError, match="exactly 16 numeric digits"):
        connector.lookup_patient_ihs("12345")

    res = connector.lookup_patient_ihs("3571012345670001")
    assert res["status"] == "configuration_required"
    assert res["mode"] == "not_configured"
    assert "nik" not in res
    assert "ihs_number" not in res


def test_satusehat_fhir_resource_builders():
    connector = SatuSehatFHIRConnector()
    encounter = connector.build_encounter_resource(
        ihs_patient="IHS-P-3571012345670001",
        encounter_class="AMB",
        practitioner_name="dr. Ferdi Andriska, S.H., M.Kn., CMDC",
    )
    assert encounter["resourceType"] == "Encounter"
    assert encounter["status"] == "in-progress"
    assert encounter["subject"]["reference"] == "Patient/IHS-P-3571012345670001"

    condition = connector.build_condition_resource(
        ihs_patient="IHS-P-3571012345670001",
        encounter_id=encounter["id"],
        icd10_code="O80",
        icd10_display="Single spontaneous delivery",
    )
    assert condition["resourceType"] == "Condition"
    assert condition["code"]["coding"][0]["code"] == "O80"
