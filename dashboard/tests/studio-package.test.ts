import { describe, expect, it } from "vitest";
import { assemblePackage, evaluatePackage, packageRevisionHash } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import type { SourceSnapshot } from "@/lib/studio/source-snapshot";
import { makeDocument } from "./fixtures/studio-package";

export const source: SourceSnapshot = { hash: "snapshot-a", sources: [
  { ...makeDocument().sources[0], id: "org-2026" }, { ...makeDocument().sources[0], id: "identifikasi" },
], facts: [{ key: "director.name", value: "Director Test", sourceIds: ["org-2026"], status: "verified", usage: "static", effectiveFrom: null, effectiveUntil: null }] };
export const register = loadRequirementRegister();
export const applicability = Object.fromEntries(register.requirements.map((r) => [r.id, "applicable" as const]));
export const pilot = () => assemblePackage({ packageKey: "identifikasi-pasien", source, register, applicability });

describe("Source-grounded Studio packages", () => {
  it("deduplicates_shared_document_ids", () => {
    const p = pilot();
    expect(p.documents.map((d) => d.id)).toEqual(["sk-skp", "spo-identifikasi", "form-audit-identifikasi", "materi-identifikasi", "monitoring-identifikasi"]);
    expect(p.status).toBe("draft"); expect(p.documents.every((d) => d.number === null)).toBe(true);
  });
  it("blocks_broken_cross_reference", () => {
    const p = pilot(); p.documents[0].relatedDocumentIds.push("absent");
    expect(evaluatePackage(p, source, register).some((i) => i.code === "reference_missing")).toBe(true);
  });
  it("leaves_missing_facts_in_issues_not_final_prose", () => {
    const missing = { ...source, facts: [] };
    const p = assemblePackage({ packageKey: "identifikasi-pasien", source: missing, register, applicability });
    expect(p.issues.some((i) => i.code === "fact_missing")).toBe(true);
    expect(JSON.stringify(p.documents)).not.toMatch(/\[ISI\]|\[CEK\]|\{\{/);
  });
  it("source_change_invalidates_review", () => {
    const p = pilot(); p.review = { hash: packageRevisionHash(p), reviewerId: "mutu", reviewedAt: "2026-11-05" };
    expect(evaluatePackage(p, { ...source, hash: "changed" }, register).some((i) => i.code === "source_changed")).toBe(true);
    p.documents[0].title = "Changed title";
    expect(evaluatePackage(p, source, register).some((i) => i.code === "review_stale")).toBe(true);
  });
  it("does_not_treat_template_as_execution", () => {
    const p = pilot();
    const form = p.documents.find((d) => d.kind === "form")!;
    expect(form.sections.some((s) => s.blocks.some((b) => b.type === "input"))).toBe(true);
    expect(JSON.stringify(form)).not.toContain("100%");
    expect(evaluatePackage({ ...p, applicability: {} }, source, register).some((i) => i.code === "applicability_unresolved")).toBe(true);
  });
  it("rejects_unknown_package_and_requirement_ids", () => {
    expect(() => assemblePackage({ packageKey: "unknown", source, register, applicability })).toThrow();
    const p = pilot(); p.documents[0].requirementIds.push("unknown");
    expect(evaluatePackage(p, source, register).some((i) => i.code === "requirement_unknown")).toBe(true);
  });
});
