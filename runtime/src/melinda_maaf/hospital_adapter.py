"""
Authoritative Hospital Adapter & SIMRS Mock Gateway for RSIA Melinda DHAI.
Enforces strict separation between static knowledge and dynamic live data.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ONTOLOGY_PATH = Path(__file__).resolve().parents[3] / "knowledge/11_MACHINE_READABLE" / "ontology" / "rsia_clinical_ontology.json"


def _load_ontology() -> dict[str, Any]:
    if ONTOLOGY_PATH.exists():
        try:
            return json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _assessment_unavailable() -> dict[str, Any]:
    return {
        "status": "ASSESSMENT_UNAVAILABLE_ESCALATE",
        "is_emergency": None,
        "detected_triggers": [],
        "routing": "HUMAN_CLINICAL_ASSESSMENT",
        "message": (
            "Penilaian otomatis tidak tersedia atau gejala belum lengkap. Hasil ini tidak boleh digunakan "
            "untuk mengarahkan pasien ke poli rutin. Minta penilaian langsung tenaga kesehatan; bila kondisi "
            "gawat atau memburuk, bawa pasien ke IGD."
        ),
        "source_provenance": "knowledge/06_CLINICAL_SAFETY/referral/kb-klinis-emergency-red-flags.md",
    }


def check_emergency_red_flags(symptoms: list[str]) -> dict[str, Any]:
    """
    Evaluates patient symptoms against RSIA Melinda Maternal & Neonatal Emergency Red Flags.
    Returns immediate IGD routing if any red flag is triggered.
    """
    if not symptoms or any(not isinstance(symptom, str) or not symptom.strip() for symptom in symptoms):
        return _assessment_unavailable()

    red_flags_spec = _load_ontology().get("emergency_red_flags")
    if not isinstance(red_flags_spec, dict):
        return _assessment_unavailable()
    maternal_triggers = red_flags_spec.get("maternal_triggers")
    pediatric_triggers = red_flags_spec.get("pediatric_triggers")
    if any(
        not isinstance(triggers, list)
        or not triggers
        or any(not isinstance(trigger, str) or not trigger.strip() for trigger in triggers)
        for triggers in (maternal_triggers, pediatric_triggers)
    ):
        return _assessment_unavailable()

    all_triggers = maternal_triggers + pediatric_triggers
    detected: list[str] = []

    # High-risk core clinical keywords that are definitively red flags on their own
    core_emergency_keywords = [
        "perdarahan", "bleeding", "preeklampsia", "eklampsia", "kejang", "seizure",
        "sesak napas", "sesak nafas", "merintih", "sianosis", "retraksi dada",
        "ketuban pecah", "ketuban hijau", "epigastric", "nyeri ulu hati hebat",
        "tidak bernapas", "tidak bergerak", "dehidrasi berat", "letargis"
    ]

    for s in symptoms:
        s_clean = s.casefold().strip()
        # Direct phrase trigger check
        for trigger in all_triggers:
            trigger_clean = trigger.casefold().strip()
            if trigger_clean in s_clean:
                if trigger_clean not in detected:
                    detected.append(trigger_clean)

        # Core emergency keyword check
        for kw in core_emergency_keywords:
            if kw in s_clean:
                if kw not in detected:
                    detected.append(kw)

    if detected:
        return {
            "status": "EMERGENCY_RED_FLAG_TRIGGERED",
            "is_emergency": True,
            "detected_triggers": detected,
            "routing": "IGD_24_JAM",
            "message": (
                "PERINGATAN KLINIS: Gejala yang dilaporkan terdeteksi sebagai tanda bahaya gawat darurat (Red Flag). "
                "Pasien harus segera dibawa ke IGD 24 Jam RSIA Melinda DHAI untuk pemeriksaan langsung oleh dokter jaga/SpOG/SpA."
            ),
            "source_provenance": "knowledge/06_CLINICAL_SAFETY/referral/kb-klinis-emergency-red-flags.md",
        }

    return {
        "status": "NO_RED_FLAG_DETECTED",
        "is_emergency": False,
        "detected_triggers": [],
        "routing": "POLIKLINIK_REGULER",
        "message": "Tidak terdeteksi red flag gawat darurat. Pasien dapat melanjutkan ke pendaftaran poliklinik rawat jalan.",
        "source_provenance": "knowledge/06_CLINICAL_SAFETY/referral/kb-klinis-emergency-red-flags.md",
    }


from .connectors.medify_simrs import MedifySIMRSConnector
from .connectors.satusehat_fhir import SatuSehatFHIRConnector

_medify = MedifySIMRSConnector()
_satusehat = SatuSehatFHIRConnector()


def query_doctor_schedule(specialty: str | None = None, date: str | None = None) -> dict[str, Any]:
    """
    Queries doctor practice schedule from Medify SIMRS.
    """
    return _medify.get_doctor_schedules(specialty=specialty, date=date)


def get_bed_availability() -> dict[str, Any]:
    """
    Queries live inpatient & maternal/neonatal bed capacity from Medify SIMRS.
    """
    return _medify.get_bed_capacity()


def query_queue_status(queue_code: str) -> dict[str, Any]:
    """
    Queries queue progression status from Medify Antrean Gateway.
    """
    return _medify.query_queue_status(queue_code)


def lookup_patient_ihs(nik: str) -> dict[str, Any]:
    """
    Queries SatuSehat Platform for patient IHS Number using NIK.
    """
    return _satusehat.lookup_patient_ihs(nik)

