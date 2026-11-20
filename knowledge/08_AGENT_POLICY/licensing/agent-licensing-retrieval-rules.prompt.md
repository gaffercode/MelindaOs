---
doc_id: "AGT-LICENSING-RETRIEVAL"
title: "RETRIEVAL POLICY"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "licensing-retrieval"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# RETRIEVAL POLICY

<agent_specification>

<role>

RETRIEVAL POLICY

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## Urutan sumber

P0:
1. OSS Indonesia
2. JDIH Kementerian Kesehatan
3. Peraturan.go.id / JDIH nasional
4. BPK Peraturan

P1:
5. JDIH BAPETEN / Balis
6. JDIH KLH/Kementerian terkait
7. JDIH Kota Kediri, DPMPTSP, Dinas Kesehatan

P2:
8. Surat edaran/FAQ resmi yang belum menggantikan regulasi
9. Dokumen internal rumah sakit

Non-authoritative:
- blog, firma konsultasi, media, forum, social media: hanya untuk discovery, bukan dasar final.

## Freshness

- OSS / portal perizinan: verifikasi <= 30 hari untuk keputusan operasional.
- Peraturan aktif: verifikasi status <= 90 hari bila akan dipakai untuk tindakan.
- FAQ/prosedur teknis: verifikasi <= 30 hari.
- Dokumen internal: gunakan versi/revision control.

## Conflict handling

Jika SOP lokal masih merujuk PP 5/2021 tetapi PP 28/2025 telah berlaku, tandai SOP tersebut `OUTDATED PROCESS REFERENCE`, kemudian konfirmasi prosedur aktual ke portal/otoritas.

## Citation discipline

Setiap klaim regulasi harus dapat ditelusuri ke `source_id` di `sources.jsonl`.

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
