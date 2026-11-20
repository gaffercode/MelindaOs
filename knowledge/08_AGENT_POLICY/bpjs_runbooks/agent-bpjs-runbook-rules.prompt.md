---
doc_id: "AGT-BPJS-RUNBOOK"
title: "RSIA MELINDA: AGENT OPERATIONAL RUNBOOK & LOOKUP CHEATSHEET"
version: "1.0"
last_reviewed: "2026-09-28"
tags: ["agent", "bpjs-runbook"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# RSIA MELINDA: AGENT OPERATIONAL RUNBOOK & LOOKUP CHEATSHEET

<agent_specification>

<role>

RSIA MELINDA: AGENT OPERATIONAL RUNBOOK & LOOKUP CHEATSHEET

</role>

<context>

RSIA Melinda DHAI adalah rumah sakit ibu dan anak di Kediri, Jawa Timur. Dokumen ini bagian dari MelindaOS, sumber kebenaran tunggal untuk agent rumah sakit.

</context>

<safety_guardrails>

Dokumen sumber tidak memuat batasan khusus. Batas global tetap berlaku: `knowledge/08_AGENT_POLICY/communications/agent-global-conduct-rules.prompt.md` dan tindakan klinis L5 hanya oleh klinisi (`knowledge/09_AGENT_ARCHITECTURE/orchestration/authority_matrix.yaml`).

</safety_guardrails>

<instructions>

## 1. AGENT DECISION TREE: PERSALINAN SC VS SPONTAN

```text
Apakah Pasien Datang dengan Rujukan Terencana FKTP atau Kasus Emergensi IGD?
│
├── [EMERGENSI IGD / PONEK]
│    ├── Periksa tanda kegawatdaruratan:
│    │    ├── Pendarahan aktif hebat? -> YA: Kode O44.1 / O45 -> SC Emergency (74.1)
│    │    ├── Fetal Distress (DJJ abnormal + CTG deselerasi)? -> YA: Kode O68.0 -> SC Emergency (74.1)
│    │    ├── Preeklampsia Berat / Eklampsia? -> YA: Kode O14.1 / O15.0 -> Protokol MgSO4 -> Terminasi
│    │    └── KPD > 24 jam dengan infeksi intrauterin? -> YA: Kode O42.1 + O85 -> SC
│    └── Jika TIDAK memenuhi kriteria gawat darurat Permenkes -> Beri rekomendasi rawat jalan/rujuk balik ke FKTP.
│
└── [RUJUKAN TERENCANA FKTP (POLI SP.OG)]
     ├── Periksa masa berlaku rujukan di V-Claim (< 90 hari) & Fingerprint aktif.
     ├── Evaluasi Indikasi Medis SC:
     │    ├── Riwayat SC >= 2x? -> Valid (O34.2)
     │    ├── Malpresentasi janin (Sungsang / Lintang >= 36 minggu)? -> Valid (O64.0 / O64.1)
     │    ├── Plasenta Previa Totalis terbukti USG? -> Valid (O44.0)
     │    └── Panggul sempit CPD terbukti pelvimetri? -> Valid (O33.9)
     └── Bila SC dilakukan karena partus gagal kemajuan:
          └── WAJIB konfirmasi keberadaan Partograf WHO lengkap melewati garis bertindak!
```

## 2. PANDUAN PENGUNGKIT TINGKAT KEPARAHAN (SEVERITY LEVEL CC/MCC)

Tingkat keparahan INA-CBG (Level I = Ringan, Level II = Sedang/CC, Level III = Berat/MCC) melipatgandakan klaim RS secara legal sesuai utilisasi sumber daya rumah sakit:

- **Contoh Kasus SC**:
  - SC Tanpa Komplikasi (Level I: **O-6-10-I**): Tarif terendah.
  - SC dengan Komorbiditas Sedang (Level II: **O-6-10-II**): Misalnya disertai Preeklampsia Ringan (**O14.0**), Diabetes Gestasional diet (**O24.4**), Asma Ringan.
  - SC dengan Komorbiditas Mayor / Komplikasi Berat (Level III: **O-6-10-III**): Disertai Preeklampsia Berat (**O14.1**), Perdarahan Masif dengan Anemia Akut Posthemoragik (**D62**), Gagal Ginjal Akut (**N17.9**), atau Sepsis (**O85**).

*Agent Rules:* Jangan biarkan klaim SC dengan komorbiditas terdokumentasi ter-grouping pada Level I karena kelalaian koder tidak memasukkan kode sekunder di SIMRS/E-Klaim.

---

## 3. CHEATSHEET CEPAT KODE KASUS KIA TERBANYAK

| Kasus Klinis | ICD-10 Utama | ICD-10 Sekunder Wajib | ICD-9-CM |
| :--- | :--- | :--- | :--- |
| SC Bekas SC 2x + PEB | O34.2 | O14.1 | 74.1, 88.78 |
| SC Partus Macet Kala 1 Fase Aktif | O63.0 | O68.0 (bila fetal distress) | 74.1, 73.4 (bila sempat induksi) |
| Kuretase Abortus Inkomplit | O03.4 | D62 (bila Hb turun akibat perdarahan) | 69.02, 88.78 |
| KPD preterm dengan induksi gagal | O42.0 | O60.1, O62.0 | 74.1, 73.4 |
| Bayi Prematur RDS + Asfiksia | P22.0 | P07.3, P07.1, P21.1 | 93.90, 99.83 |
| Bayi Ikterus Fototerapi | P59.0 | P07.1 (bila BBLR) | 99.83 |
| Bronkopneumonia Anak | J18.0 | E44.0 (bila gizi kurang) | 87.44, 93.94 |
| GEA Dehidrasi Sedang Anak | A09 | E86 | 99.18 (IV fluid infusion) |

</instructions>

<output_format>

Tidak diatur dalam dokumen sumber.

</output_format>

</agent_specification>
