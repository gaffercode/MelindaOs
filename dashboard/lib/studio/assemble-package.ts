import { randomUUID } from "node:crypto";
import { canonicalHash } from "../director/director-store";
import type { RequirementRegister } from "../starkes/requirements";
import type { Applicability, StudioIssue, StudioPackage } from "./contracts";
import { evaluateDocument } from "./evaluate-document";
import { packageDefinition } from "./package-catalog";
import type { SourceSnapshot } from "./source-snapshot";

export function packageRevisionHash(pkg: StudioPackage): string {
  return canonicalHash({ documents: pkg.documents, baselineId: pkg.baselineId, snapshotHash: pkg.snapshotHash,
    applicabilityHash: pkg.applicabilityHash, applicability: pkg.applicability, requiredFactKeys: pkg.requiredFactKeys });
}

export function assemblePackage(input: { packageKey: string; source: SourceSnapshot; register: RequirementRegister; applicability: Record<string, Applicability> }): StudioPackage {
  const definition = packageDefinition(input.packageKey);
  const docs = new Map(definition.documents.map(({ sourceIds, ...doc }) => [doc.id, { ...doc, sources: sourceIds.flatMap((id) => input.source.sources.filter((s) => s.id === id)) }]));
  const pkg: StudioPackage = {
    id: randomUUID(), packageKey: input.packageKey, revision: 1, status: "draft", baselineId: input.register.baselineId,
    snapshotHash: input.source.hash, applicabilityHash: canonicalHash(input.applicability), applicability: structuredClone(input.applicability),
    documents: [...docs.values()], requiredFactKeys: definition.requiredFactKeys, issues: [], review: null,
  };
  pkg.issues = evaluatePackage(pkg, input.source, input.register);
  return pkg;
}

export function evaluatePackage(pkg: StudioPackage, source: SourceSnapshot, register: RequirementRegister): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const add = (code: string, field: string, message: string) => issues.push({ code, field, message, severity: "blocker", documentId: pkg.id } as StudioIssue);
  if (pkg.snapshotHash !== source.hash) add("source_changed", "snapshotHash", "Sumber paket berubah; susun ulang dan review kembali.");
  if (pkg.baselineId !== register.baselineId) add("baseline_changed", "baselineId", "Baseline kebutuhan berubah.");
  if (pkg.applicabilityHash !== canonicalHash(pkg.applicability)) add("applicability_changed", "applicability", "Penerapan kebutuhan berubah.");
  const finalizedReview = pkg.finalizedHash === packageRevisionHash(pkg) && pkg.finalization?.reviewHash === pkg.review?.hash;
  if (pkg.review && pkg.review.hash !== packageRevisionHash(pkg) && !finalizedReview) add("review_stale", "review", "Review tidak sesuai revisi saat ini.");
  for (const key of pkg.requiredFactKeys) {
    if (!source.facts.some((f) => f.key === key && f.status === "verified")) add("fact_missing", key, "Fakta institusi belum diselesaikan dari sumber.");
  }
  const required = new Set(pkg.documents.flatMap((d) => d.requirementIds));
  for (const id of required) {
    const requirement = register.requirements.find((r) => r.id === id);
    if (!requirement) add("requirement_unknown", id, "EP belum ditemukan pada baseline resmi.");
    else if (requirement.disposition !== "mapped" || requirement.documentIds.some((docId) => !pkg.documents.some((d) => d.id === docId))) add("requirement_unmapped", id, "Dokumen wajib dalam paket belum lengkap.");
  }
  if (new Set(pkg.documents.map((d) => d.id)).size !== pkg.documents.length) add("duplicate_document", "documents", "ID dokumen paket harus unik.");
  for (const doc of pkg.documents) issues.push(...evaluateDocument(doc, {
    sourceHashes: Object.fromEntries(source.sources.map((s) => [s.id, s.sha256])), knownDocumentIds: pkg.documents.map((d) => d.id),
    applicability: pkg.applicability, phase: "final", reviewedRevisionHash: pkg.review?.hash ?? null, actorAuthority: "director",
  }));
  return issues;
}
