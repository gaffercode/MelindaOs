---
doc_id: "SOP-OPS-WEBSITE"
title: "melinda.co.id Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "website"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# melinda.co.id Automation
**Primary path:** CMS REST API, deployment API, atau signed webhook. Controlled browser automation hanya fallback sementara.

Target tool: `melinda.website.publish` / `update` / `media_upload`. Semua write idempotent dan mempunyai source content ID sehingga koreksi/rollback dapat dilakukan tanpa mengedit manual halaman satu per satu.
