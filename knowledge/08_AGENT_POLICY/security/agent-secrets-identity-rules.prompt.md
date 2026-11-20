---
doc_id: "AGT-SECRETS-IDENTITY"
title: "Secrets & Identity"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "secrets-identity"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Secrets & Identity

<agent_specification>

<role>

Secrets & Identity

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## Non-negotiable

- Provider token/password/API key tidak pernah masuk prompt, Bot memory, Git, n8n workflow JSON, atau chat.
- MCP server menerima identitas workload/trust-domain, bukan role yang dipilih model.
- Provider secret hanya dibaca oleh MAAF backend/token broker dari Vault atau cloud secret manager.
- Gunakan short-lived workload credential bila platform mendukung.

## Vault layout

- `secret/data/melinda/prod/social/facebook`
- `secret/data/melinda/prod/social/instagram`
- `secret/data/melinda/prod/social/threads`
- `secret/data/melinda/prod/social/linkedin`
- `secret/data/melinda/prod/social/youtube`
- `secret/data/melinda/prod/social/x`
- `secret/data/melinda/prod/email/primary`
- `secret/data/melinda/prod/website/cms`

## Rotation

Token broker mencatat metadata expiry, last_refresh, next_refresh_at, scope hash, dan last_failure tanpa mencatat secret value.

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
