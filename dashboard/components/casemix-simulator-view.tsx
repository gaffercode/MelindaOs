"use client";
import { ToolPageHeader } from "./tool-page-header";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CasemixPreset {
  name: string;
  serviceType: "ranap" | "rajal";
  careClass: "1" | "2" | "3";
  icd10Code: string;
  icd10Desc: string;
  icd9Code: string;
  icd9Desc: string;
  severity: "I" | "II" | "III";
  inaCbgCode: string;
  inaCbgTariff: number; // Tarif INA-CBG RS Khusus C Regional 1
  unitCostMedis: number;
  unitCostBmhp: number;
  unitCostObat: number;
  unitCostAkomodasi: number;
  unitCostPenunjang: number;
  disputeRisks: string[];
  fornasCompliant: boolean;
}

const CASEMIX_PRESETS: CasemixPreset[] = [
  {
    name: "Seksio Sesarea Elektif (SC ERACS) Tanpa Komplikasi",
    serviceType: "ranap",
    careClass: "3",
    icd10Code: "O82.0",
    icd10Desc: "Delivery by elective caesarean section",
    icd9Code: "74.1",
    icd9Desc: "Low cervical caesarean section",
    severity: "I",
    inaCbgCode: "O-6-10-I",
    inaCbgTariff: 5850000,
    unitCostMedis: 2200000,
    unitCostBmhp: 1150000,
    unitCostObat: 650000,
    unitCostAkomodasi: 550000,
    unitCostPenunjang: 450000,
    disputeRisks: [
      "Wajib lampirkan laporan operasi lengkap dengan jam mulai dan selesai insisi.",
      "Protokol ERACS: pastikan mobilisasi dini 6 jam pasca bedah terdokumentasi di CPPT perawat.",
      "Jika ada indikasi CPD (Cephalopelvic Disproportion), sertakan ukuran panggul klinis atau USG tafsiran berat janin (TBJ).",
    ],
    fornasCompliant: true,
  },
  {
    name: "Seksio Sesarea Cito dengan Preeklampsia Berat (PEB)",
    serviceType: "ranap",
    careClass: "3",
    icd10Code: "O14.1",
    icd10Desc: "Severe pre-eclampsia",
    icd9Code: "74.1",
    icd9Desc: "Low cervical caesarean section",
    severity: "II",
    inaCbgCode: "O-6-10-II",
    inaCbgTariff: 7620000,
    unitCostMedis: 2800000,
    unitCostBmhp: 1450000,
    unitCostObat: 950000,
    unitCostAkomodasi: 700000,
    unitCostPenunjang: 650000,
    disputeRisks: [
      "Wajib lampirkan rekam hasil laboratorium proteinuria (+2 / +3) atau dipstick positif.",
      "Lampirkan grafik rekam tensi berkala (tekanan sistolik >= 160 atau diastolik >= 110 mmHg).",
      "Pemberian MgSO4: pastikan protokol loading dose dan maintenance dose tercatat jelas dalam lembar monitoring infus.",
    ],
    fornasCompliant: true,
  },
  {
    name: "Persalinan Spontan Pervaginam (Normal Delivery)",
    serviceType: "ranap",
    careClass: "3",
    icd10Code: "O80.0",
    icd10Desc: "Spontaneous vertex delivery",
    icd9Code: "73.59",
    icd9Desc: "Other manually assisted delivery",
    severity: "I",
    inaCbgCode: "O-6-13-I",
    inaCbgTariff: 2850000,
    unitCostMedis: 1100000,
    unitCostBmhp: 450000,
    unitCostObat: 280000,
    unitCostAkomodasi: 350000,
    unitCostPenunjang: 250000,
    disputeRisks: [
      "Wajib menyertakan lembar Partograf terisi lengkap dari fase aktif pembukaan 4 cm hingga kala IV.",
      "Persalinan spontan tanpa penyulit di RS wajib memiliki alasan rujukan sah dari FKTP (Puskesmas/Klinik).",
    ],
    fornasCompliant: true,
  },
  {
    name: "Perawatan Bayi Baru Lahir dengan Asfiksia / RDS Ringan",
    serviceType: "ranap",
    careClass: "3",
    icd10Code: "P22.0",
    icd10Desc: "Respiratory distress syndrome of newborn",
    icd9Code: "93.96",
    icd9Desc: "Other oxygen enrichment / CPAP",
    severity: "I",
    inaCbgCode: "P-8-14-I",
    inaCbgTariff: 4420000,
    unitCostMedis: 1600000,
    unitCostBmhp: 850000,
    unitCostObat: 400000,
    unitCostAkomodasi: 600000,
    unitCostPenunjang: 450000,
    disputeRisks: [
      "Wajib lampirkan lembar skor Down Score berkala atau APGAR score menit ke-1 dan ke-5.",
      "Dokumentasikan pemakaian terapi oksigen / nasal CPAP dalam rekam medis perinatologi.",
    ],
    fornasCompliant: true,
  },
  {
    name: "Kuretase Abortus Inkomplit / Mola Hidatidosa",
    serviceType: "ranap",
    careClass: "3",
    icd10Code: "O03.4",
    icd10Desc: "Incomplete spontaneous abortion without complication",
    icd9Code: "69.02",
    icd9Desc: "Dilation and curettage following abortion",
    severity: "I",
    inaCbgCode: "O-6-12-I",
    inaCbgTariff: 3250000,
    unitCostMedis: 1300000,
    unitCostBmhp: 600000,
    unitCostObat: 350000,
    unitCostAkomodasi: 400000,
    unitCostPenunjang: 300000,
    disputeRisks: [
      "Wajib melampirkan hasil USG kandungan yang menunjukkan sisa konsepsi di kavum uteri.",
      "Wajib menyertakan formulir informed consent tindakan kuretase bertanda tangan suami/keluarga.",
      "Kirim jaringan hasil kuretase ke pemeriksaan Patologi Anatomi (PA) jika dicurigai mola.",
    ],
    fornasCompliant: true,
  },
];

export function CasemixSimulatorView() {
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

  // Form Inputs
  const [serviceType, setServiceType] = useState<"ranap" | "rajal">(CASEMIX_PRESETS[0].serviceType);
  const [careClass, setCareClass] = useState<"1" | "2" | "3">(CASEMIX_PRESETS[0].careClass);
  const [icd10, setIcd10] = useState(CASEMIX_PRESETS[0].icd10Code);
  const [icd10Desc, setIcd10Desc] = useState(CASEMIX_PRESETS[0].icd10Desc);
  const [icd9, setIcd9] = useState(CASEMIX_PRESETS[0].icd9Code);
  const [icd9Desc, setIcd9Desc] = useState(CASEMIX_PRESETS[0].icd9Desc);
  const [severity, setSeverity] = useState<"I" | "II" | "III">(CASEMIX_PRESETS[0].severity);
  const [inaCbgCode, setInaCbgCode] = useState(CASEMIX_PRESETS[0].inaCbgCode);
  const [inaCbgTariff, setInaCbgTariff] = useState(CASEMIX_PRESETS[0].inaCbgTariff);

  // Unit Cost Components
  const [costMedis, setCostMedis] = useState(CASEMIX_PRESETS[0].unitCostMedis);
  const [costBmhp, setCostBmhp] = useState(CASEMIX_PRESETS[0].unitCostBmhp);
  const [costObat, setCostObat] = useState(CASEMIX_PRESETS[0].unitCostObat);
  const [costAkomodasi, setCostAkomodasi] = useState(CASEMIX_PRESETS[0].unitCostAkomodasi);
  const [costPenunjang, setCostPenunjang] = useState(CASEMIX_PRESETS[0].unitCostPenunjang);

  const [disputeRisks, setDisputeRisks] = useState<string[]>(CASEMIX_PRESETS[0].disputeRisks);
  const [isFornas, setIsFornas] = useState(CASEMIX_PRESETS[0].fornasCompliant);
  const [copiedSummary, setCopiedSummary] = useState(false);

  function applyPreset(idx: number) {
    setSelectedPresetIdx(idx);
    const p = CASEMIX_PRESETS[idx];
    setServiceType(p.serviceType);
    setCareClass(p.careClass);
    setIcd10(p.icd10Code);
    setIcd10Desc(p.icd10Desc);
    setIcd9(p.icd9Code);
    setIcd9Desc(p.icd9Desc);
    setSeverity(p.severity);
    setInaCbgCode(p.inaCbgCode);
    setInaCbgTariff(p.inaCbgTariff);
    setCostMedis(p.unitCostMedis);
    setCostBmhp(p.unitCostBmhp);
    setCostObat(p.unitCostObat);
    setCostAkomodasi(p.unitCostAkomodasi);
    setCostPenunjang(p.unitCostPenunjang);
    setDisputeRisks(p.disputeRisks);
    setIsFornas(p.fornasCompliant);
  }

  // Financial Calculations
  const totalUnitCost = costMedis + costBmhp + costObat + costAkomodasi + costPenunjang;
  const netMargin = inaCbgTariff - totalUnitCost;
  const marginPercentage = inaCbgTariff > 0 ? Math.round((netMargin / inaCbgTariff) * 100) : null;

  const isHealthyMargin = netMargin > 0 && marginPercentage !== null && marginPercentage >= 15;
  const isTightMargin = netMargin >= 0 && marginPercentage !== null && marginPercentage < 15;
  const isDeficit = netMargin < 0;

  function copySimulation() {
    let text = `=== SIMULASI CASEMIX & KLAIM BPJS RSIA MELINDA DHAI ===\n`;
    text += `Diagnosis: ${icd10} (${icd10Desc})\n`;
    text += `Prosedur: ${icd9} (${icd9Desc})\n`;
    text += `Kode INA-CBG: ${inaCbgCode} (Tingkat Keparahan ${severity})\n`;
    text += `Tarif Klaim BPJS (INA-CBG): Rp ${new Intl.NumberFormat("id-ID").format(inaCbgTariff)}\n`;
    text += `Total Unit Cost Riil: Rp ${new Intl.NumberFormat("id-ID").format(totalUnitCost)}\n`;
    text += `Margin Rumah Sakit: Rp ${new Intl.NumberFormat("id-ID").format(netMargin)} (${marginPercentage === null ? "Tarif belum diisi" : `${marginPercentage}%`})\n`;
    text += `Status Keuangan: ${isHealthyMargin ? "Margin sehat" : isTightMargin ? "Margin ketat" : "Defisit / potensi rugi"}\n\n`;
    text += `Peringatan Dini Dispute Klaim:\n`;
    disputeRisks.forEach((r, i) => {
      text += `  ${i + 1}. ${r}\n`;
    });

    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  }

  return (
    <article className="swiss-report-sheet melinda-management-sheet tool-workspace tool-casemix" aria-label="Kalkulator Casemix & Pencegahan Dispute Klaim BPJS">
      {/* ── RUNNING TOP HEADER ── */}
      <div className="melinda-running-header flex justify-between items-center text-slate-500 border-b border-slate-200 pb-2 mb-6">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)]" />
          <span>RSIA Melinda DHAI Kediri</span>
        </div>
        <span className="text-[var(--type-ui)]">Casemix simulator</span>
      </div>

      {/* ── MASTHEAD ── */}
      <ToolPageHeader title="Casemix Simulator" description="Bandingkan tarif klaim dengan biaya pelayanan dan tinjau kebutuhan dokumen.">

        <div className="swiss-masthead-right melinda-brief-meta">
          <dl className="swiss-meta-dl melinda-meta-dl">
            <div className="swiss-meta-item">
              <dt>Status kepatuhan Fornas</dt>
              <dd className={`font-medium ${isFornas ? "text-[var(--accent)]" : "text-[var(--orange-ink)]"}`}>{isFornas ? "Sesuai Fornas" : "Perlu review Fornas"}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Evaluasi margin</dt>
              <dd className={`font-medium ${isHealthyMargin ? "text-[var(--accent)]" : isTightMargin ? "text-[var(--warn)]" : "text-[var(--orange-ink)]"}`}>{marginPercentage === null ? "Isi tarif terlebih dahulu" : isHealthyMargin ? "Margin Sehat" : isTightMargin ? "Margin ketat" : "Risiko rugi"}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Tarif klaim acuan</dt>
              <dd className="font-mono text-xs">Tarif INA-CBG Regional 1 Jawa Timur</dd>
            </div>
          </dl>
        </div>
      </ToolPageHeader>
      <p className="tool-page-notice"><strong>Contoh simulasi.</strong> Tarif dan biaya awal perlu disesuaikan dengan data RS. Perubahan kode tidak menghitung tarif otomatis.</p>

      {/* ════════════════════════════════════════════════
          01 / PRESET KASUS KEBIDANAN & ANAK TERBANYAK
      ════════════════════════════════════════════════ */}
      <section className="swiss-section" aria-labelledby="section-casemix-01">
        <div className="melinda-tool-section-head">
          <h2 id="section-casemix-01" className="swiss-section-heading">
            <span className="swiss-section-num">01</span><span className="swiss-section-title">Preset kasus kebidanan &amp; anak terbanyak</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copySimulation}
              className="button-secondary text-xs"
            >
              {copiedSummary ? <Check className="size-3.5 text-slate-900" /> : <Copy className="size-3.5 text-slate-500" />}
              <span>{copiedSummary ? "Simulasi Disalin" : "Salin Resume Finansial"}</span>
            </button>
          </div>
        </div>

        <label htmlFor="casemix-preset" className="tool-field-label">Pilih contoh kasus</label>
        <select id="casemix-preset" aria-label="Pilih contoh kasus" className="tool-preset-select" value={selectedPresetIdx} onChange={(event) => applyPreset(Number(event.target.value))}>
          {CASEMIX_PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}
        </select>
        <p className="tool-field-help">Memilih contoh akan mengganti parameter dan biaya di bawah.</p>
      </section>

      {/* ════════════════════════════════════════════════
          02 / PARAMETER KODING, BIAYA RIIL & KALKULASI MARGIN
      ════════════════════════════════════════════════ */}
      <section className="swiss-section" aria-labelledby="section-casemix-02">
        <div className="melinda-tool-section-head">
          <h2 id="section-casemix-02" className="swiss-section-heading">
            <span className="swiss-section-num">02</span><span className="swiss-section-title">Parameter koding, biaya riil &amp; kalkulasi margin</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            INA-CBG &amp; UNIT COST RSIA MELINDA DHAI
          </span>
        </div>

        {/* SIMRS-CHART-GRID WITH AUTHENTIC RSIA MELINDA CARDS */}
        <div className="simrs-chart-grid mb-6">
          {/* Card 1: Tarif INA-CBG vs Total Biaya Riil */}
          <div className="simrs-chart-card">
            <div className="simrs-chart-header">
              <div className="simrs-chart-kicker">Analisis casemix klaim BPJS</div>
              <div className="simrs-chart-title">Tarif INA-CBG vs Biaya Riil</div>
              <span
                className={`simrs-chart-badge melinda-tool-plain-status ${
                  !isDeficit ? "is-ok" : "is-warn"
                }`}
              >
                {!isDeficit ? "Surplus" : "Defisit"}
              </span>
            </div>
            <div className="simrs-chart-body">
              <div className="flex justify-between items-baseline border-b border-slate-100 pb-2 mb-2">
                <span className="text-xs text-slate-500">Tarif Klaim INA-CBG:</span>
                <span className="tool-metric-value font-mono text-base font-bold text-slate-900">
                  Rp {new Intl.NumberFormat("id-ID").format(inaCbgTariff)}
                </span>
              </div>
              <div className="flex justify-between items-baseline border-b border-slate-100 pb-2 mb-2">
                <span className="text-xs text-slate-500">Total Unit Cost Riil:</span>
                <span className="font-mono text-sm font-semibold text-slate-700">
                  Rp {new Intl.NumberFormat("id-ID").format(totalUnitCost)}
                </span>
              </div>
              {/* Cost to Tariff Ratio Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-[var(--type-ui)] text-slate-500 mb-1">
                  <span>Rasio Biaya : Tarif</span>
                  <span>{inaCbgTariff > 0 ? ((totalUnitCost / inaCbgTariff) * 100).toFixed(1) : 0}%</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all melinda-tool-progress-fill ${
                      isDeficit ? "!bg-[var(--orange-ink)]" : ""
                    }`}
                    style={{
                      width: `${Math.min(100, inaCbgTariff > 0 ? (totalUnitCost / inaCbgTariff) * 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Net Hospital Margin & Rentabilitas */}
          <div className="simrs-chart-card">
            <div className="simrs-chart-header">
              <div className="simrs-chart-kicker">Evaluasi margin unit layanan</div>
              <div className="simrs-chart-title">Kalkulasi Margin Rumah Sakit</div>
              <span
                className={`simrs-chart-badge melinda-tool-plain-status ${
                  isHealthyMargin ? "is-ok" : isTightMargin ? "is-attention" : "is-warn"
                }`}
              >
                {marginPercentage === null ? "Isi tarif terlebih dahulu" : isHealthyMargin ? "Margin sehat" : isTightMargin ? "Margin ketat" : "Risiko rugi"}
              </span>
            </div>
            <div className="simrs-chart-body">
              <div className="flex justify-between items-baseline border-b border-slate-100 pb-2 mb-2">
                <span className="text-xs text-slate-500">Nominal Margin Bersih:</span>
                <span
                  className={`tool-metric-value font-mono text-base font-bold ${
                    !isDeficit ? "text-slate-900" : "text-orange-700"
                  }`}
                >
                  Rp {new Intl.NumberFormat("id-ID").format(netMargin)}
                </span>
              </div>
              <div className="flex justify-between items-baseline border-b border-slate-100 pb-2 mb-2">
                <span className="text-xs text-slate-500">Persentase Margin:</span>
                <span
                  className={`font-mono text-sm font-semibold ${
                    !isDeficit ? "text-slate-900" : "text-orange-700"
                  }`}
                >
                  {marginPercentage === null ? "Tarif belum diisi" : marginPercentage >= 0 ? `+${marginPercentage}%` : `${marginPercentage}%`}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 pt-1 leading-relaxed">
                {!isDeficit
                  ? "Pelayanan efisien, berada di bawah batas plafon tarif paket INA-CBG Regional 1."
                  : "Biaya tindakan melebihi plafon tarif INA-CBG. Evaluasi BMHP dan peresepan obat non-Fornas."}
              </p>
            </div>
          </div>
        </div>

        {/* INPUTS STRUCTURED AS SWISS TABLE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Table 1: Parameter Koding & Administrasi (6 Cols) */}
          <div className="lg:col-span-6 space-y-4">
            <div tabIndex={0} className="swiss-table-wrap">
              <table className="swiss-table tool-input-table">
                <thead>
                  <tr>
                    <th scope="col" className="text-left w-1/3">Parameter koding</th>
                    <th scope="col" className="text-left w-2/3">Input data rekam medis &amp; SIMRS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold text-slate-800">Jenis Pelayanan</td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setServiceType("ranap")}
                          aria-pressed={serviceType === "ranap"}
                          className={`px-2.5 py-1 text-xs rounded border transition ${
                            serviceType === "ranap"
                              ? "melinda-tool-segment is-active"
                              : "melinda-tool-segment"
                          }`}
                        >
                          Rawat Inap
                        </button>
                        <button
                          type="button"
                          onClick={() => setServiceType("rajal")}
                          aria-pressed={serviceType === "rajal"}
                          className={`px-2.5 py-1 text-xs rounded border transition ${
                            serviceType === "rajal"
                              ? "melinda-tool-segment is-active"
                              : "melinda-tool-segment"
                          }`}
                        >
                          Rawat Jalan
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Kelas Perawatan</td>
                    <td>
                      <div className="flex gap-2">
                        {(["3", "2", "1"] as const).map((cls) => (
                          <button
                            key={cls}
                            type="button"
                            onClick={() => setCareClass(cls)}
                            aria-pressed={careClass === cls && serviceType === "ranap"}
                            disabled={serviceType === "rajal"}
                            className={`melinda-tool-segment ${
                              careClass === cls && serviceType === "ranap" ? "is-active" : ""
                            } disabled:opacity-40`}
                          >
                            Kelas {cls}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Diagnosis (ICD-10)</td>
                    <td>
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          aria-label="Kode ICD-10"
                          value={icd10}
                          onChange={(e) => setIcd10(e.target.value)}
                          className="melinda-tool-input font-mono font-medium"
                          placeholder="Kode ICD-10"
                        />
                        <input
                          type="text"
                          aria-label="Deskripsi diagnosis"
                          value={icd10Desc}
                          onChange={(e) => setIcd10Desc(e.target.value)}
                          className="melinda-tool-input"
                          placeholder="Deskripsi Diagnosis"
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Prosedur (ICD-9-CM)</td>
                    <td>
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          aria-label="Kode ICD-9-CM"
                          value={icd9}
                          onChange={(e) => setIcd9(e.target.value)}
                          className="melinda-tool-input font-mono font-medium"
                          placeholder="Kode ICD-9"
                        />
                        <input
                          type="text"
                          aria-label="Deskripsi prosedur"
                          value={icd9Desc}
                          onChange={(e) => setIcd9Desc(e.target.value)}
                          className="melinda-tool-input"
                          placeholder="Deskripsi Prosedur Tindakan"
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Severity Level</td>
                    <td>
                      <div className="flex gap-2">
                        {(["I", "II", "III"] as const).map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setSeverity(sev)}
                            aria-pressed={severity === sev}
                            className={`px-2.5 py-1 text-xs rounded border transition ${
                              severity === sev
                                ? "melinda-tool-segment is-active"
                                : "melinda-tool-segment"
                            }`}
                          >
                            Tingkat {sev}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Kode &amp; Tarif INA-CBG</td>
                    <td>
                      <div className="tool-tariff-fields">
                        <input
                          type="text"
                          aria-label="Kode INA-CBG"
                          value={inaCbgCode}
                          onChange={(e) => setInaCbgCode(e.target.value)}
                          className="w-24 melinda-tool-input font-mono font-medium"
                        />
                        <input
                          type="number"
                          aria-label="Tarif INA-CBG"
                          value={inaCbgTariff}
                          onChange={(e) => setInaCbgTariff(Number(e.target.value) || 0)}
                          className="flex-1 melinda-tool-input font-mono font-medium text-right"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Rincian Unit Cost Riil (6 Cols) */}
          <div className="lg:col-span-6 space-y-4">
            <div tabIndex={0} className="swiss-table-wrap">
              <table className="swiss-table tool-input-table">
                <thead>
                  <tr>
                    <th scope="col" className="text-left w-1/2">
                      Rincian Unit Cost Riil Pelayanan RSIA Melinda DHAI
                    </th>
                    <th scope="col" className="text-right w-1/2">Biaya satuan (Rp)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold text-slate-800">Jasa Medis &amp; Paramedis</td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label="Biaya jasa medis"
                        value={costMedis}
                        onChange={(e) => setCostMedis(Number(e.target.value) || 0)}
                        className="w-36 melinda-tool-input font-mono text-right font-medium"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Bahan Medis Habis Pakai (BMHP)</td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label="Biaya BMHP"
                        value={costBmhp}
                        onChange={(e) => setCostBmhp(Number(e.target.value) || 0)}
                        className="w-36 melinda-tool-input font-mono text-right font-medium"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">
                      <div>Obat-obatan &amp; Farmasi</div>
                      <label className="inline-flex items-center gap-1.5 mt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isFornas}
                          onChange={(e) => setIsFornas(e.target.checked)}
                          className="rounded text-[var(--accent)] focus:ring-[var(--accent)]"
                        />
                        <span className="text-[var(--type-ui)] text-slate-500 font-normal">Kepatuhan Fornas KMK 1199/2025</span>
                      </label>
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label="Biaya obat"
                        value={costObat}
                        onChange={(e) => setCostObat(Number(e.target.value) || 0)}
                        className="w-36 melinda-tool-input font-mono text-right font-medium"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Akomodasi &amp; Rawat Inap</td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label="Biaya akomodasi"
                        value={costAkomodasi}
                        onChange={(e) => setCostAkomodasi(Number(e.target.value) || 0)}
                        className="w-36 melinda-tool-input font-mono text-right font-medium"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-slate-800">Penunjang (Laborat &amp; USG)</td>
                    <td className="text-right">
                      <input
                        type="number"
                        aria-label="Biaya penunjang"
                        value={costPenunjang}
                        onChange={(e) => setCostPenunjang(Number(e.target.value) || 0)}
                        className="w-36 melinda-tool-input font-mono text-right font-medium"
                      />
                    </td>
                  </tr>
                  <tr className="bg-slate-50/70 font-medium border-t border-[var(--line)]">
                    <td className="text-slate-900 font-medium">Total unit cost riil</td>
                    <td className="text-right font-mono text-slate-900 text-sm">
                      Rp {new Intl.NumberFormat("id-ID").format(totalUnitCost)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          03 / PENCEGAHAN SENGKETA KLAIM BPJS (EARLY DISPUTE WARNING)
      ════════════════════════════════════════════════ */}
      <section className="swiss-section" aria-labelledby="section-casemix-03">
        <div className="melinda-tool-section-head">
          <h2 id="section-casemix-03" className="swiss-section-heading">
            <span className="swiss-section-num">03</span><span className="swiss-section-title">Early Dispute Warning (Verifikator BPJS Shield)</span>
          </h2>
          <span className="melinda-section-meta text-slate-500">
            Checklist verifikator BPJS Kesehatan
          </span>
        </div>

        <div className="swiss-callout mb-4">
          Pencegahan sengketa klaim (dispute) wajib berpedoman pada Berita Acara Kesepakatan Bersama DJSN-BPJS dan Permenkes No. 6 Tahun 2026. Lengkapi bukti klinis berikut di Rekam Medis Elektronik Medify sebelum berkas klaim diunggah ke e-Klaim INA-CBG.
        </div>

        <p className="melinda-tool-table-scroll-hint">Geser ke kanan untuk melihat kolom status syarat.</p>
        <div tabIndex={0} className="swiss-table-wrap">
          <table className="swiss-table melinda-tool-dispute-table">
            <thead>
              <tr>
                <th scope="col" className="text-left w-12">No</th>
                <th scope="col" className="text-left w-2/5">Poin verifikasi kelayakan klaim</th>
                <th scope="col" className="text-left w-2/5">Acuan regulasi &amp; bukti rekam medis</th>
                <th scope="col" className="text-left min-w-[7.5rem] whitespace-nowrap">Status syarat</th>
              </tr>
            </thead>
            <tbody>
              {disputeRisks.map((risk, idx) => (
                <tr key={idx}>
                  <td className="font-mono text-slate-400">{idx + 1}</td>
                  <td className="font-medium text-slate-800 leading-relaxed">{risk}</td>
                  <td className="text-slate-600 leading-relaxed">
                    Lampiran Rekam Medis Elektronik (Medify) bertanda tangan DPJP dan teregistrasi SIMRS.
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-[var(--accent)] font-medium">Wajib terlampir</span>
                  </td>
                </tr>
              ))}
              {!isFornas && (
                <tr className="bg-orange-50/50">
                  <td className="font-mono text-orange-600 font-bold">!</td>
                  <td className="font-medium text-orange-900 leading-relaxed">
                    Penggunaan obat di luar Formularium Nasional (KMK 1199/2025).
                  </td>
                  <td className="text-orange-800 leading-relaxed">
                    Wajib melampirkan Formulir Khusus Rekomendasi Komite Medik bertanda tangan Ketua Komite Medik.
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-[var(--orange-ink)] font-medium">Risiko dispute tinggi</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
  </article>
  );
}
