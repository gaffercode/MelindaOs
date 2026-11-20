import type { EvaluationContext, StudioDocument, StudioIssue } from "./contracts";
import { blockText, REQUIRED_SECTIONS, UNFINISHED_COPY, validDocumentDate } from "./rules";

/** Structural checks assist a revision-specific human review; they do not certify clinical content. */
export function evaluateDocument(doc: StudioDocument, context: EvaluationContext): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const add = (code: string, field: string, message: string) => issues.push({ code, field, message, documentId: doc.id, severity: context.phase === "final" ? "blocker" : "warning" });
  for (const field of ["id", "title", "unit", "revision", "number", "issueDate"] as const) {
    if (!doc[field]?.trim()) add("publication_missing", field, "Lengkapi identitas penerbitan dokumen.");
  }
  if (doc.issueDate && !validDocumentDate(doc.issueDate)) add("publication_invalid", "issueDate", "Tanggal penerbitan tidak valid.");
  if (context.phase === "final" && doc.authority !== (context.actorAuthority ?? "director")) add("authority_mismatch", "authority", "Pengesahan memerlukan pejabat yang berwenang.");
  for (const id of REQUIRED_SECTIONS[doc.kind]) {
    if (!doc.sections.some((s) => s.id === id)) add("structure_missing", id, "Bagian wajib belum tersedia.");
  }
  const seen = new Set<string>();
  for (const section of doc.sections) {
    if (seen.has(section.id)) add("structure_duplicate", section.id, "Identitas bagian harus unik.");
    seen.add(section.id);
    if (!section.blocks.length || !section.blocks.some((b) => blockText(b).some((t) => t.trim()))) add("section_empty", section.id, "Isi bagian belum lengkap.");
    for (const block of section.blocks) {
      if (block.type === "table" && (!block.headers.length || !block.rows.length || block.rows.some((r) => r.length !== block.headers.length))) add("table_invalid", section.id, "Kolom dan isi tabel harus lengkap.");
      for (const text of [section.heading, ...blockText(block)]) {
        if (UNFINISHED_COPY.test(text)) add("placeholder", section.id, "Selesaikan catatan penyusunan sebelum finalisasi.");
      }
    }
  }
  for (const text of [doc.title, doc.unit, doc.revision, doc.number ?? ""]) {
    if (UNFINISHED_COPY.test(text)) add("placeholder", "metadata", "Identitas dokumen masih memuat catatan penyusunan.");
  }
  if (["form", "monitoring"].includes(doc.kind) && !doc.sections.some((s) => s.blocks.some((b) => b.type === "input" || (b.type === "table" && b.rows.length > 0)))) add("structure_missing", "fields", "Formulir memerlukan kolom operasional.");
  if (!doc.sources.length) add("source_missing", "sources", "Dokumen belum mempunyai sumber.");
  for (const source of doc.sources) {
    if (source.status !== "verified" || !source.locator.trim() || !/^\w{64}$/.test(source.sha256) || !Number.isFinite(Date.parse(source.reviewedAt))) add("source_unverified", source.id, "Sumber belum terverifikasi.");
    if (context.sourceHashes[source.id] !== source.sha256) add("source_changed", source.id, "Sumber berubah; periksa kembali isi dokumen.");
  }
  for (const id of doc.relatedDocumentIds) {
    if (!context.knownDocumentIds.includes(id)) add("reference_missing", id, "Dokumen rujukan belum tersedia.");
  }
  if (!doc.requirementIds.length) add("requirement_missing", "requirements", "Kebutuhan dokumen belum dipetakan.");
  for (const id of doc.requirementIds) {
    if (!context.applicability[id] || context.applicability[id] === "unresolved") add("applicability_unresolved", id, "Penerapan kebutuhan belum dipastikan.");
  }
  return issues;
}
