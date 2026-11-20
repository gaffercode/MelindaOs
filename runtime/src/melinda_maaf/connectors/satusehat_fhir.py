"""
Kemenkes SatuSehat Platform Connector (HL7 FHIR R4 Specification).
Portal: https://satusehat.kemkes.go.id/platform
Transforms hospital events into standard SatuSehat FHIR R4 resources:
- Patient (IHS Number lookup via NIK)
- Encounter (Rawat Jalan / Inap / IGD)
- Condition (ICD-10 clinical diagnosis)
- Observation (Vital signs & physical metrics)
- Procedure (ICD-9-CM surgical / obstetric procedures)
"""
from __future__ import annotations

import os
from typing import Any
import uuid


class SatuSehatFHIRConnector:
    def __init__(
        self,
        auth_url: str | None = None,
        base_url: str | None = None,
        org_id: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> None:
        self.auth_url = auth_url or os.getenv("SATUSEHAT_AUTH_URL", "https://api-satusehat.kemkes.go.id/oauth2/v1")
        self.base_url = base_url or os.getenv("SATUSEHAT_BASE_URL", "https://api-satusehat.kemkes.go.id/fhir-r4/v1")
        self.org_id = org_id or os.getenv("SATUSEHAT_ORG_ID", "10000004")
        self.client_id = client_id or os.getenv("SATUSEHAT_CLIENT_ID", "")
        self.client_secret = client_secret or os.getenv("SATUSEHAT_CLIENT_SECRET", "")

    def lookup_patient_ihs(self, nik: str) -> dict[str, Any]:
        """
        Queries Kemenkes SatuSehat for patient IHS Number (Indonesian Health Service Number) using NIK.
        """
        nik_clean = nik.strip()
        if len(nik_clean) != 16 or not nik_clean.isdigit():
            raise ValueError("NIK must be exactly 16 numeric digits.")
        return {
            "status": "configuration_required",
            "mode": "not_configured",
            "source": "Kemenkes SatuSehat",
            "reason": "Authenticated live patient lookup is not implemented; no identity was resolved.",
        }

    def build_encounter_resource(
        self,
        ihs_patient: str,
        encounter_class: str = "AMB",  # AMB (Ambulatory/Rajal), IMP (Inpatient/Ranap), EMER (Emergency/IGD)
        practitioner_name: str = "dr. Ferdi Andriska, S.H., M.Kn., CMDC",
        period_start: str = "2026-09-28T09:00:00+07:00",
    ) -> dict[str, Any]:
        """
        Builds a standard SatuSehat HL7 FHIR R4 Encounter resource.
        """
        enc_id = str(uuid.uuid4())
        class_display = {
            "AMB": "ambulatory",
            "IMP": "inpatient encounter",
            "EMER": "emergency",
        }.get(encounter_class, "ambulatory")

        return {
            "resourceType": "Encounter",
            "id": enc_id,
            "identifier": [
                {
                    "system": f"http://sys-ids.kemkes.go.id/encounter/{self.org_id}",
                    "value": enc_id,
                }
            ],
            "status": "in-progress",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": encounter_class,
                "display": class_display,
            },
            "subject": {
                "reference": f"Patient/{ihs_patient}",
                "display": "Pasien RSIA Melinda",
            },
            "participant": [
                {
                    "type": [
                        {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                    "code": "ATND",
                                    "display": "attender",
                                }
                            ]
                        }
                    ],
                    "individual": {
                        "reference": "Practitioner/N10000001",
                        "display": practitioner_name,
                    },
                }
            ],
            "period": {
                "start": period_start,
            },
            "serviceProvider": {
                "reference": f"Organization/{self.org_id}",
                "display": "RSIA Melinda DHAI Kediri",
            },
        }

    def build_condition_resource(
        self,
        ihs_patient: str,
        encounter_id: str,
        icd10_code: str,
        icd10_display: str,
    ) -> dict[str, Any]:
        """
        Builds a standard SatuSehat HL7 FHIR R4 Condition resource (ICD-10).
        """
        cond_id = str(uuid.uuid4())
        return {
            "resourceType": "Condition",
            "id": cond_id,
            "clinicalStatus": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                        "code": "active",
                        "display": "Active",
                    }
                ]
            },
            "category": [
                {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/condition-category",
                            "code": "encounter-diagnosis",
                            "display": "Encounter Diagnosis",
                        }
                    ]
                }
            ],
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/icd-10",
                        "code": icd10_code,
                        "display": icd10_display,
                    }
                ]
            },
            "subject": {
                "reference": f"Patient/{ihs_patient}",
            },
            "encounter": {
                "reference": f"Encounter/{encounter_id}",
            },
        }
