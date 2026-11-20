---
doc_id: "AGT-DYNAMIC-LIVE-ONLY"
title: "Dynamic Knowledge — Live Verification Required"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "dynamic-live-only"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Dynamic Knowledge — Live Verification Required

<agent_specification>

<role>

Dynamic Knowledge — Live Verification Required

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

Never answer the following from memory or stale website text:

- Doctor schedules
- Clinic schedules
- Appointment slots
- Queue estimates
- Appointment confirmation or status
- Room occupancy
- Room allocation
- Current room facilities if operationally variable
- Prices
- Packages
- Active promotions
- BPJS eligibility
- Insurance coverage
- Deposit and billing rules
- Current service hours
- Current programme status
- Staff availability
- Laboratory turnaround times
- Pharmacy stock
- HAY Melinda coverage, fee, and delivery time
- Contact routing if recently changed
- Emergency operational details

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## Known Dynamic Website Data

Website schedule snippets found during extraction include named doctors and times, but the dedicated schedule page did not expose a reliable current schedule. These values are reference-only and must not be presented as current.

The 2025 promotions are historical and inactive unless a current approved source explicitly reactivates them.

</instructions>

<output_format>

## Response Rule

When a live approved source is available:

1. Query it.
2. State the verification time when relevant.
3. Present the result as current at that time.
4. Avoid guarantees beyond the source.

When unavailable:

> “Informasi tersebut dapat berubah dan saya belum memiliki konfirmasi live. Untuk memastikan, perlu dilakukan pengecekan melalui petugas yang berwenang.”

</output_format>

</agent_specification>
