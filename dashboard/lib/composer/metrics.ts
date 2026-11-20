import { BOR_IDEAL_MAX } from "../melinda/briefing";

export type BriefSection = "serviceSummary" | "safetyQuality" | "claimsFinance" | "staffing";
export type MetricId = "bor" | "toi" | "bto" | "ndr" | "gdr" | "outpatient_visits" | "igd_visits" | "admissions" | "satusehat_sent_percent" | "satusehat_failed" | "staff_active" | "staff_left";
export type Threshold = { perhatian: number; kritis?: number; direction: "above" | "below" };
export type MetricDefinition = { id: MetricId; label: string; unit: string; section: BriefSection; threshold: Threshold | null };

export const METRICS: readonly MetricDefinition[] = [
  { id: "bor", label: "BOR", unit: "%", section: "serviceSummary", threshold: { perhatian: BOR_IDEAL_MAX, direction: "above" } },
  { id: "toi", label: "TOI", unit: "hari", section: "serviceSummary", threshold: null },
  { id: "bto", label: "BTO", unit: "kali", section: "serviceSummary", threshold: null },
  { id: "ndr", label: "NDR", unit: "‰", section: "safetyQuality", threshold: null },
  { id: "gdr", label: "GDR", unit: "‰", section: "safetyQuality", threshold: null },
  { id: "outpatient_visits", label: "Kunjungan rawat jalan", unit: "kunjungan", section: "serviceSummary", threshold: null },
  { id: "igd_visits", label: "Kunjungan IGD", unit: "kunjungan", section: "serviceSummary", threshold: null },
  { id: "admissions", label: "Pasien masuk rawat inap", unit: "pasien", section: "serviceSummary", threshold: null },
  // The limit the page already prints for SATUSEHAT ("di bawah 95%"); no critical level is set.
  { id: "satusehat_sent_percent", label: "SATUSEHAT terkirim", unit: "%", section: "safetyQuality", threshold: { perhatian: 95, direction: "below" } },
  { id: "satusehat_failed", label: "SATUSEHAT gagal kirim", unit: "data", section: "safetyQuality", threshold: null },
  { id: "staff_active", label: "Pegawai aktif", unit: "orang", section: "staffing", threshold: null },
  { id: "staff_left", label: "Pegawai keluar", unit: "orang", section: "staffing", threshold: null },
];

export function metric(id: MetricId): MetricDefinition {
  const found = METRICS.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown brief metric: ${id}`);
  return found;
}
