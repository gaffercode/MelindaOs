---
doc_id: "SOP-OPS-LINKEDIN"
title: "LinkedIn Company Automation"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "linkedin"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# LinkedIn Company Automation

**Primary path:** LinkedIn versioned Posts API untuk organisasi.

Current verified capability (7 Sep 2026): `w_organization_social` mendukung post/comment/like atas nama organization untuk role yang memenuhi syarat. Posts API version harus dipilih yang masih supported karena versi Marketing API mempunyai sunset cadence.

Programmatic refresh token hanya digunakan jika app mempunyai entitlement/approval yang diperlukan; jika tidak, scheduler membuat reauthorization window sebelum expiry agar tidak terjadi surprise outage.
