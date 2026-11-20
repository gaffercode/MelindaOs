---
doc_id: "SOP-KLI-KNOWLEDGE-FIELDS-YAML"
title: "KNOWLEDGE_FIELDS.yaml"
domain: "Klinis"
department: "Rujukan"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: true
tags: ["klinis", "rujukan", "referral", "knowledge-fields-yaml"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# KNOWLEDGE_FIELDS.yaml

Isi berkas `KNOWLEDGE_FIELDS.yaml`:

```yaml
version: "1.0"
entity: "RSIA Melinda DHAI"

hospital:
  legal_name:
    value: null
    source: internal_master
    staleness: MONTHLY
  bpjs_partner_status:
    value: null
    source: payer_contract_or_live_system
    staleness: LIVE
  emergency_service_24h:
    value: true
    source: public_website_snapshot
    last_verified_at: "2026-08-28"
    staleness: WEEKLY
  online_registration:
    h_minus_min: 7
    h_minus_max: 1
    source: public_website_snapshot
    last_verified_at: "2026-08-28"
    staleness: WEEKLY
  same_day_registration_phone:
    value: "(0354) 691016"
    source: public_website_snapshot
    last_verified_at: "2026-08-28"
    staleness: WEEKLY

referral:
  competency_map:
    source: internal_clinical_registry
    staleness: LIVE
  jkn_destination_mapping:
    source: live_referral_system
    staleness: LIVE
  receiving_capacity:
    source: hospital_capacity_system
    staleness: LIVE
  referral_desk_contact:
    value: null
    source: internal_directory
    staleness: DAILY

patient_context_required:
  - urgency
  - payer
  - requested_service
  - new_or_followup
  - referral_present
  - referral_destination
  - control_letter_present
  - transfer_from_facility

routing_outputs:
  - pathway
  - referral_requirement
  - melinda_accessibility
  - documents_needed
  - next_action
  - safety_instruction
  - live_verification_needed
```
