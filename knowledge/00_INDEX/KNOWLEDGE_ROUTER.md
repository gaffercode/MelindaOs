# KNOWLEDGE ROUTER

| Intent | Primary path | Secondary | Notes |
|---|---|---|---|
| Asuransi / TPA / guarantee | `knowledge/03_INSURANCE` | `knowledge/05_REFERRAL/private_insurance` | Pisahkan eligibility vs guarantee |
| BPJS | `knowledge/04_BPJS` | `knowledge/05_REFERRAL/bpjs` | Cek freshness tarif/rule |
| Rujukan | `knowledge/05_REFERRAL` | `knowledge/06_CLINICAL_SAFETY/referral` | Emergency red flags menang atas admin flow |
| Jadwal / layanan RS | `knowledge/01_HOSPITAL` | live source | Jadwal dianggap dynamic |
| Clinical safety | `knowledge/06_CLINICAL_SAFETY` | human escalation | Jangan infer diagnosis dari admin KB |
| Pengajuan / pemesanan obat (farmasi) | `knowledge/07_LEGAL_REGULATORY/pharmacy_policies/kb-klinis-alur-pelayanan-farmasi.md` | `knowledge/08_AGENT_POLICY/governance/agent-farmasi-pengajuan-obat-rules.prompt.md` | SSOT sejak 5 Nov 2026; matriks Bagian 4 wajib |
| Perizinan / regulasi | `knowledge/07_LEGAL_REGULATORY` | `knowledge/11_MACHINE_READABLE/licensing` | Cek verified-as-of |
| Agent behavior | `knowledge/08_AGENT_POLICY` | `knowledge/09_AGENT_ARCHITECTURE` | Bukan factual KB |
| Tool/action | `knowledge/10_TOOL_CONTRACTS` | `knowledge/11_MACHINE_READABLE` | Validasi schema |
| Audit/testing | `knowledge/12_GOVERNANCE` | `tests/`, `tools/governance/` | Verifier layer |
