---
doc_id: "SOP-OPS-FACEBOOK"
title: "Facebook Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "facebook"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Facebook Automation

**Primary path:** Meta Graph API melalui MAAF. Browser hanya fallback.

## One-time setup

1. Meta app organisasi + Business Manager/Page ownership yang benar.
2. App Review/permissions sesuai fungsi yang dibutuhkan.
3. Credential/token disimpan di Vault; MAAF memonitor validitas dan melakukan renewal/exchange yang didukung.

## Runtime

Klien agent (MCP client) → MCP `social.publish` → policy → MAAF → Meta adapter → audit. Bila token invalid, recovery otomatis berjalan sebelum DIR menerima escalation.

## Production note

Meta permission names/lifecycle dapat berubah; verifikasi ulang di dokumentasi Meta pada go-live.
