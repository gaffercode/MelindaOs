import type { EvaluationContext, StudioDocument } from "@/lib/studio/contracts";

export function makeDocument(overrides: Partial<StudioDocument> = {}): StudioDocument {
  return {
    id: "spo-identifikasi", kind: "spo", title: "Identifikasi Pasien", unit: "Keperawatan",
    authority: "director", revision: "00", number: "001/TEST/2026", issueDate: "2026-11-05",
    sections: ["pengertian", "tujuan", "ruang_lingkup", "kebijakan", "tanggung_jawab", "unit_terkait", "prosedur", "dokumen_terkait", "riwayat_revisi"].map((id) => ({
      id, heading: id, blocks: [{ type: "text", text: "Petugas memverifikasi dua identitas pasien sebelum pelayanan dan mencatat hasilnya." }],
    })),
    sources: [{ id: "source-1", path: "knowledge/01_HOSPITAL/test.md", locator: "Prosedur", sha256: "a".repeat(64), reviewedAt: "2026-11-05", status: "verified" }],
    requirementIds: ["baseline:SKP:1:a"], relatedDocumentIds: [], ...overrides,
  };
}

export function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return { sourceHashes: { "source-1": "a".repeat(64) }, knownDocumentIds: ["spo-identifikasi"],
    applicability: { "baseline:SKP:1:a": "applicable" }, phase: "final", reviewedRevisionHash: "reviewed",
    actorAuthority: "director", ...overrides };
}
