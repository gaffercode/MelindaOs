---
doc_id: "SOP-OPS-YOUTUBE"
title: "YouTube Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "youtube"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# YouTube Automation
**Primary path:** YouTube Data API v3 + OAuth server-side `access_type=offline`.

Gunakan scope minimum: upload-only bila hanya upload; perluas hanya jika fitur memang membutuhkan. Refresh token disimpan di Vault dan digunakan MAAF untuk memperoleh access token baru tanpa Bapak hadir.

Video publishing tetap melalui content policy dan approval class yang sesuai.
