---
doc_id: "SOP-KLI-REFERRAL-DECISION-RULES-JSON"
title: "REFERRAL_DECISION_RULES.json"
domain: "Klinis"
department: "Rujukan"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: true
tags: ["klinis", "rujukan", "referral", "referral-decision-rules-json"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# REFERRAL_DECISION_RULES.json

Isi berkas `REFERRAL_DECISION_RULES.json`:

```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "R001",
      "if": {"emergency_possible": true},
      "then": {
        "require_routine_referral_before_care": false,
        "action": "route_to_immediate_capable_emergency_care",
        "melinda_preference": "only_if_safe_capable_and_reasonably_reachable"
      }
    },
    {
      "id": "R002",
      "if": {"payer": "JKN", "visit": "new_planned_specialist", "emergency_possible": false},
      "then": {
        "action": "start_with_registered_FKTP_assessment",
        "referral": "if_clinically_indicated",
        "melinda_destination": "verify_live_mapping_and_capability"
      }
    },
    {
      "id": "R003",
      "if": {"payer": "SELF_PAY", "visit": "planned", "service_available": true},
      "then": {
        "action": "direct_booking",
        "referral_required_by_JKN": false,
        "verify": ["schedule", "tariff_if_quoted"]
      }
    },
    {
      "id": "R004",
      "if": {"existing_referral_destination": "OTHER_FACILITY", "patient_prefers_melinda": true},
      "then": {
        "action": "verify_melinda_capability_and_mapping_then_refer_patient_to_authorized_referrer_for_destination_change_if_permitted",
        "prohibited": ["ignore_existing_referral", "alter_referral", "invent_clinical_indication"]
      }
    },
    {
      "id": "R005",
      "if": {"rujuk_balik": true},
      "then": {
        "action": "support_FKTP_continuity_and_preserve_documented_return_path_to_melinda",
        "prohibited": ["block_rujuk_balik"]
      }
    },
    {
      "id": "R006",
      "if": {"melinda_not_capable_or_not_available": true},
      "then": {
        "action": "help_patient_reach_alternative_capable_facility",
        "commercial_priority_override": "patient_safety_and_clinical_need"
      }
    }
  ]
}
```
