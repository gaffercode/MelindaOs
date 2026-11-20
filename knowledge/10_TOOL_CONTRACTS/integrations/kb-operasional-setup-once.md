---
doc_id: "SOP-OPS-SETUP-ONCE"
title: "Setup Once — Autonomous Access Fabric"
domain: "Operasional"
department: "Humas & Digital"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "humas-digital", "integrations", "setup-once"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Setup Once — Autonomous Access Fabric

Tujuan setup ini adalah **satu kali authorization + lifecycle automation**, bukan login manual berulang.

## 1. Klien agent / MCP

- Gunakan klien agent kelas enterprise untuk production controls (MCP allowlist, network controls, audit/action recording sesuai entitlement).
- Pisahkan user/computer credential domains untuk Executive, Clinical, Finance, HR, Verification.
- Tambahkan Custom MCP endpoint MAAF per trust domain.

## 2. Meta: Facebook + Instagram + Threads

- Buat Meta app milik organisasi, bukan developer pribadi.
- Hubungkan business/page/professional account yang benar.
- Minta hanya permission yang diperlukan untuk publishing/insights/moderation.
- Exchange/refresh token menggunakan lifecycle yang didukung masing-masing API; MAAF Token Health memonitor expiry/invalidasi dan mencoba renewal sebelum eskalasi.
- **Jangan** menyimpan token Meta di klien agent atau n8n workflow JSON.
- Bila Meta memaksa re-consent/2FA/CAPTCHA, DIR meminta satu takeover minimum lalu automation melanjutkan.

## 3. LinkedIn Company Page

- Buat LinkedIn developer app organisasi dan asosiasikan dengan Company Page.
- Untuk posting organisasi gunakan akses `w_organization_social`; read/analytics sesuai permission yang disetujui LinkedIn.
- Gunakan API versi terbaru saat deployment; LinkedIn versioned APIs memiliki sunset cadence.
- Programmatic refresh token hanya bila app memperoleh entitlement/approval yang diperlukan. Jika tidak, jadwalkan reauthorization sebelum access token expiry dan eskalasi satu kali.

## 4. YouTube

- Buat Google Cloud project organisasi + OAuth client server-side.
- Request scope minimum yang diperlukan (`youtube.upload` untuk upload-only; scope lebih luas hanya jika dibutuhkan).
- Gunakan `access_type=offline` agar refresh token tersedia untuk unattended refresh.
- Simpan refresh token di Vault; MAAF memperoleh access token baru otomatis.

## 5. X

- Buat X developer project/app organisasi.
- Gunakan OAuth 2.0 Authorization Code + PKCE dengan `offline.access` untuk refresh token.
- Gunakan Manage Posts / media endpoints sesuai kebutuhan dan tier API.
- Simpan refresh token di Vault, bukan di klien agent.

## 6. Email

`hai@melinda.co.id` diperlakukan sebagai primary official mailbox/API identity. Adapter dipilih sesuai provider aktual (Google Workspace, Microsoft 365, SMTP/API provider, atau custom mail API). OAuth/service credential disimpan di Vault. `melinda.rsia@yahoo.com` diperlakukan sebagai alternate/fallback mailbox; gunakan OAuth/provider-supported mechanism atau app-specific credential hanya bila diperlukan, tetap di Vault.

## 7. Website melinda.co.id

Prioritas: CMS REST API / signed webhook / deployment API. Bila CMS tidak menyediakan API, gunakan controlled browser automation sebagai fallback sementara dan buat adapter API secepat mungkin.

## 8. Token Health Routine

Setiap provider mempunyai state: `healthy`, `expiring`, `refreshing`, `degraded`, `reauth_required`, `revoked`.
Urutan recovery: refresh → renew/exchange → reconnect adapter → retry with backoff → fallback session (jika policy allow) → human reauth.

## 9. Definition of done

Bapak tidak lagi diminta login untuk operasi normal. Human auth hanya muncul bila provider memang mewajibkan re-consent/2FA/CAPTCHA/recovery yang tidak dapat diotomatisasi secara sah.
