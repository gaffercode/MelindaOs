import type { StarkesDossierData, StarkesEvidenceIndexEntry } from "../pdf/build-starkes-dossier";
import type { StarkesAuditScore } from "./audit-store";
import { CHAPTERS } from "./ep-status";
import { loadRequirementRegister } from "./requirements";

export function auditByEpId(scores: StarkesAuditScore[]): Map<string, StarkesAuditScore> {
  return new Map(scores.map((row) => [row.ep_id, row]));
}

export type StarkesLockStateSummary = "none" | "draft" | "submitted" | "partial" | "locked";

export function chapterLockSummary(epIds: string[], auditMap: Map<string, StarkesAuditScore>): StarkesLockStateSummary {
  const rows = epIds.map((id) => auditMap.get(id)?.lock_state).filter(Boolean);
  if (rows.length === 0) return "none";
  if (rows.every((state) => state === "locked")) return "locked";
  if (rows.some((state) => state === "locked")) return "partial";
  if (rows.some((state) => state === "submitted")) return "submitted";
  return "draft";
}

const mark = (needed: boolean) => (needed ? "Diperlukan" : "-");

/** Dossier of one chapter from the official register and the Director's audit scores (unscored EPs count 0). */
export function buildChapterDossierPayload(chapterCode: string, auditMap: Map<string, StarkesAuditScore>): StarkesDossierData {
  const info = CHAPTERS[chapterCode];
  const eps = loadRequirementRegister().requirements.filter((ep) => ep.chapterCode === chapterCode);
  const lockSummary = chapterLockSummary(eps.map((ep) => ep.id), auditMap);
  let currentScore = 0;
  const items = eps.map((ep) => {
    const audit = auditMap.get(ep.id);
    const score = audit?.score ?? 0;
    currentScore += score;
    const kinds = new Set(ep.evidenceKinds);
    return {
      code: `${ep.standardCode} EP ${ep.epCode}`, title: ep.text,
      r: mark(kinds.has("R")), d: mark(kinds.has("D")), o: mark(kinds.has("O")), w: mark(kinds.has("W")),
      score, evidence_status: audit?.evidence_status ?? "missing",
    };
  });
  const evidenceIndex: StarkesEvidenceIndexEntry[] = eps.map((ep) => {
    const audit = auditMap.get(ep.id);
    return {
      code: `${ep.standardCode} EP ${ep.epCode}`, title: ep.text, status: audit?.evidence_status ?? "missing",
      attachments: (audit?.attachment_refs ?? []).filter((ref): ref is string => typeof ref === "string").slice(0, 8),
      studio_presets: (info?.studioPresetCodes ?? []).filter((p) => p.includes(`(${ep.standardCode})`)),
    };
  });
  return {
    chapter_code: chapterCode,
    chapter_name: info?.name ?? chapterCode,
    chapter_group: info?.group ?? "",
    desc: info?.applicability === "not_applicable" ? "Tidak diterapkan di rumah sakit non-pendidikan." : "",
    target_score: eps.length * 10,
    current_score: currentScore,
    lock_state: lockSummary === "none" ? "draft" : lockSummary === "partial" ? "submitted" : lockSummary,
    evidence_index: evidenceIndex,
    watermark_text: lockSummary === "locked" ? undefined : "DRAF AUDIT — SKOR RESMI BELUM DIKUNCI DIREKTUR",
    items,
  };
}
