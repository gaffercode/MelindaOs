---
doc_id: "SOP-OPS-EMAIL"
title: "Email Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "email"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Email Automation

Primary official identity: `hai@melinda.co.id`. Alternate: `melinda.rsia@yahoo.com`.

Adapter final ditentukan dari provider aktual. Prioritas: provider API/OAuth atau service identity; SMTP/app-specific credential hanya jika API yang lebih baik tidak tersedia. Semua credential tetap di Vault.

External email adalah L3: kelas template rutin dapat dipreapprove server-side; email sensitif, complaint escalation, legal, HR, atau clinical communication mengikuti authority matrix.
