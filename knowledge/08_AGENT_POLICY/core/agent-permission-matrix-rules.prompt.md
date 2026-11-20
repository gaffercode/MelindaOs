---
doc_id: "AGT-PERMISSION-MATRIX"
title: "PERMISSION MATRIX"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "permission-matrix"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# PERMISSION MATRIX

<agent_specification>

<role>

PERMISSION MATRIX

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

| Tool | Risk | Auth | Confirmation | Audit | Idempotency | PHI/PII |
|---|---:|---|---|---|---|---|
| hospital.search_knowledge | R0/R1 | No* | No | Optional | N/A | None |
| hospital.get_contact | R0 | No | No | No | N/A | None |
| hospital.get_operating_hours | R0 | No | No | No | N/A | None |
| doctor.search | R0 | No | No | No | N/A | None |
| doctor.get_profile | R0 | No | No | No | N/A | None |
| doctor.get_schedule | R1 | No* | No | Recommended | N/A | None |
| service.search | R0 | No | No | No | N/A | None |
| service.get_details | R0/R1 | No* | No | Optional | N/A | None |
| service.get_tariff | R1 | No* | No | Recommended | N/A | None |
| appointment.find_slots | R1 | No* | No | Recommended | N/A | Minimal |
| appointment.get | R2 | Yes | No | Mandatory | N/A | D2 |
| appointment.create | R3 | Yes | Yes | Mandatory | Required | D2/D3 |
| appointment.reschedule | R3 | Yes | Yes | Mandatory | Required | D2 |
| appointment.cancel | R4 | Yes | Yes | Mandatory | Required | D2 |
| patient.pre_register | R3 | Yes/contextual | Yes | Mandatory | Required | D2/D3 |
| patient.resolve_administrative_identity | R2 | Yes | No | Mandatory | N/A | D2/D3 |
| queue.get_status | R1/R2 | Contextual | No | Contextual | N/A | D0/D2 |
| insurance.check_eligibility | R2 | Yes | No | Mandatory | N/A | D2/D3 |
| complaint.create_ticket | R3 | Contextual | Yes | Mandatory | Required | D1-D3 |
| complaint.get_status | R2 | Yes when linked | No | Mandatory | N/A | D2 |
| handoff.create | R3 | Contextual | Conditional | Mandatory | Required | D1-D3 |
| notification.send | R4 | Yes | Conditional/Yes | Mandatory | Required | D2 |

`No*` means the tool may be publicly callable only if the underlying hospital data is explicitly approved for public disclosure.

## Authorization principle

The model never decides whether it is authorized. The server does.

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## Default-deny

Any action not explicitly represented in the catalog is denied by default. A generic or catch-all tool MUST NOT be added to bypass this matrix.

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
