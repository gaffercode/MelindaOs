---
doc_id: "SOP-OPS-X"
title: "X Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "x"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# X Automation
**Primary path:** X API v2 Manage Posts + media endpoints.

Gunakan OAuth 2.0 Authorization Code + PKCE dan scope `offline.access` agar refresh token tersedia. Access token pendek tidak boleh membuat Bapak login ulang; MAAF melakukan refresh dan retry otomatis.

API tier/rate limits harus dicatat sebagai provider metadata dan dipantau saat production.
