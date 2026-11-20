# MELINDA KNOWLEDGE OS v1.0

**Status:** Canonical restructured knowledge package  
**Built:** 2026-09-08 (Asia/Jakarta)  
**Principle:** Fact → Knowledge; Rule → Policy; Action → Tool Contract; Reasoning → Agent Architecture; Dynamic state → Live Source; Obsolete/foreign scope → Archive.

## Tujuan
Paket ini menata ulang resource Melinda menjadi domain yang retrieval-friendly tanpa mengubah isi sumber asli. Setiap file memiliki provenance di `knowledge/11_MACHINE_READABLE/manifest/file_mapping.csv`.

## Routing Utama
- `knowledge/01_HOSPITAL` — fakta/profil/organisasi/jadwal dan reference rumah sakit.
- `knowledge/02_PATIENT_ACCESS` — registrasi, appointment, routing dan handoff pasien.
- `knowledge/03_INSURANCE` — eligibility, TPA, guarantee, COB, insurance scenarios.
- `knowledge/04_BPJS` — maternal, pediatric/neonatal, referral, tarif, dispute.
- `knowledge/05_REFERRAL` — patient routing, FKTP, BPJS/private referral.
- `knowledge/06_CLINICAL_SAFETY` — red flags, restricted clinical content, safety checks.
- `knowledge/07_LEGAL_REGULATORY` — licensing dan regulatory knowledge.
- `knowledge/08_AGENT_POLICY` — rules/permissions/confirmation/security; bukan fakta pasien.
- `knowledge/09_AGENT_ARCHITECTURE` — prompts, agents, orchestration (runtime code: `runtime/`).
- `knowledge/10_TOOL_CONTRACTS` — schemas/interfaces/integrations/MCP contracts.
- `knowledge/11_MACHINE_READABLE` — machine schemas, taxonomy, config, provenance.
- `knowledge/12_GOVERNANCE` — readiness, audit, research logs (tests: `tests/`).
- `knowledge/99_ARCHIVE` — source docs, historical/quarantined.

## Guardrail Retrieval
1. Dynamic data (jadwal, availability, live status) harus diverifikasi ke live source bila tersedia.
2. Regulatory knowledge harus memeriksa freshness/verified-as-of sebelum dijadikan keputusan final.
3. Clinical restricted content harus mengikuti escalation/safety policy.
4. Policy dan agent instructions tidak boleh diperlakukan sebagai fakta operasional eksternal.
5. Jangan gunakan `knowledge/99_ARCHIVE/duplicates`; versi aktif setiap dokumen tercantum di `knowledge/99_ARCHIVE/duplicates/README.md`.

## Statistik Build
- File terpetakan: **227**
- Canonical ZIP inputs: **8**
- Duplicate excluded: **Knowledge(1).zip** (duplikat `Knowledge.zip`)
