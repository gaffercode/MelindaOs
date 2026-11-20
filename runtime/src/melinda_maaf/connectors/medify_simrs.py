"""Explicitly unavailable Medify adapter until authenticated integration exists."""
from __future__ import annotations

from typing import Any


class MedifySIMRSConnector:
    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        self.base_url = base_url
        self.api_key_configured = bool(api_key)

    @staticmethod
    def _unavailable() -> dict[str, Any]:
        return {
            "status": "configuration_required",
            "mode": "not_configured",
            "source": "Medify SIMRS",
            "reason": "Authenticated live adapter is not implemented; no operational data was queried.",
        }

    def get_doctor_schedules(self, specialty: str | None = None, date: str | None = None) -> dict[str, Any]:
        return {**self._unavailable(), "results": []}

    def get_bed_capacity(self) -> dict[str, Any]:
        return self._unavailable()

    def query_queue_status(self, queue_code: str) -> dict[str, Any]:
        return self._unavailable()

    def create_pre_registration(self, patient_data: dict[str, Any]) -> dict[str, Any]:
        return self._unavailable()
