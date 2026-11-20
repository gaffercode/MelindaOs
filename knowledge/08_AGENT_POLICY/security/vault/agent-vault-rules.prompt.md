---
doc_id: "AGT-VAULT"
title: "Vault deployment note"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "vault"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Vault deployment note

<agent_specification>

<role>

Vault deployment note

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

Gunakan AppRole/workload identity khusus MAAF dengan policy sempit. Jangan gunakan root token untuk runtime. SecretID harus short-lived/response-wrapped bila AppRole dipakai. Untuk production lebih baik gunakan workload/Kubernetes/cloud auth bila tersedia.

Contoh setup harus dijalankan oleh security operator; repository ini sengaja **tidak** berisi RoleID, SecretID, token, unseal key, atau credential lainnya.

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

Tidak diatur dalam dokumen sumber.

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
