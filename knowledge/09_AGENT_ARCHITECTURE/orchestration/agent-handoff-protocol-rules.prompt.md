---
doc_id: "AGT-HANDOFF-PROTOCOL"
title: "Handoff Protocol"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "handoff-protocol"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Handoff Protocol

<agent_specification>

<role>

Handoff Protocol

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

Setiap handoff harus memiliki satu owner yang jelas dan satu expected output.

Format:
- `request_id`
- `from_agent`
- `to_agent`
- `purpose`
- `facts/provenance`
- `risk_class`
- `deadline/SLA`
- `expected_output`
- `authority_required`

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## Rules

1. Agent penerima tidak boleh mengubah tujuan handoff tanpa alasan yang dicatat.
2. Jika data tidak cukup, agent meminta data dari source system melalui tool, bukan menebak.
3. Jika action high-risk, routine pemilik topik menyiapkan verification packet dan KATT meneruskannya ke human approval (pemilik verifikasi khusus belum ditetapkan pada roster).
4. KATT hanya menerima summary + unresolved exception, bukan seluruh transcript kerja.

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
