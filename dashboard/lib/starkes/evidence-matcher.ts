import { callClaude } from "../claude-client";
import { findPatientIdentifiers } from "../phi-guard";
import type { DriveFile } from "./drive-source";
import type { OfficialRequirement } from "./requirements";

export type FileMatch = { epIds: string[]; kind: "D" | "O" | "R" | "S"; confidence: number; phiFlag: boolean };

const KINDS = ["D", "O", "R", "S"] as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["epIds", "kind", "confidence"],
  properties: {
    epIds: { type: "array", items: { type: "string" }, maxItems: 5 },
    kind: { type: "string", enum: [...KINDS] },
    confidence: { type: "number" },
  },
};
const system = [
  "Kamu membantu Tim Mutu RSIA Melinda DHAI memetakan berkas bukti akreditasi STARKES ke elemen penilaian (EP).",
  "Pilih hanya id EP dari daftar yang diberikan yang benar-benar dibuktikan oleh berkas ini; kosongkan bila tidak ada.",
  "kind: R regulasi (SK, kebijakan, pedoman, panduan, SPO), D dokumen bukti pelaksanaan, O foto atau bukti observasi, S bukti simulasi.",
  "confidence: 0 sampai 1, seberapa yakin pemetaan ini benar.",
].join("\n");

/**
 * Suggests the EPs one Drive file proves, within the file's own chapter only. Text containing patient identifiers is
 * not sent: the match then uses the file name alone and phiFlag is set. Returns null when no chapter EP remains.
 */
export async function matchFile(file: DriveFile, text: string, chapterEps: OfficialRequirement[]): Promise<FileMatch | null> {
  const phiFlag = findPatientIdentifiers(`${file.name}\n${text}`).length > 0;
  const allowed = new Set(chapterEps.map((ep) => ep.id));
  const user = [
    `Bab: ${file.chapterCode}`,
    `Nama berkas: ${phiFlag ? "(disembunyikan, memuat data pasien)" : file.name}`,
    phiFlag || !text ? "Isi berkas: (tidak dikirim)" : `Isi berkas (awal):\n${text}`,
    "Daftar EP:",
    ...chapterEps.map((ep) => `${ep.id}: ${ep.text.slice(0, 220)}`),
  ].join("\n");
  const reply = await callClaude({ event: "ai_starkes_match", system, user, maxTokens: 400, schema });
  let parsed: unknown = null;
  try { parsed = reply ? JSON.parse(reply) : null; } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const { epIds, kind, confidence } = parsed as { epIds?: unknown; kind?: unknown; confidence?: unknown };
  const kept = Array.isArray(epIds) ? [...new Set(epIds.filter((id): id is string => typeof id === "string" && allowed.has(id)))] : [];
  const knownKind = KINDS.find((k) => k === kind);
  if (!kept.length || !knownKind) return null;
  return { epIds: kept, kind: knownKind, confidence: typeof confidence === "number" ? Math.min(1, Math.max(0, confidence)) : 0, phiFlag };
}
