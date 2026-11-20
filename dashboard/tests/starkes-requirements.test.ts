import { describe, expect, it } from "vitest";
import { loadRequirementRegister, validateRequirementRegister, scoreAllowed, type RequirementRegister } from "@/lib/starkes/requirements";

describe("Official accreditation requirements", () => {
  it("preserves_sub_EP_identity", () => {
    const r = loadRequirementRegister();
    expect(r.requirements.filter((e) => e.standardCode === "SKP 1").map((e) => e.epCode)).toEqual(["1", "2", "3", "4"]);
    expect(new Set(r.requirements.map((e) => e.id)).size).toBe(r.requirements.length);
    expect(r.requirements.find((e) => e.standardCode === "SKP 1")?.id).toBe("47104-2024:SKP:1:1");
  });
  it("committed_register_is_complete_and_valid", () => {
    expect(validateRequirementRegister(loadRequirementRegister())).toEqual([]);
    const incomplete = { ...loadRequirementRegister(), complete: false };
    expect(validateRequirementRegister(incomplete)).toContain("baseline_incomplete");
  });
  it("keeps_PPK_canonical", () => {
    const r = structuredClone(loadRequirementRegister()); r.requirements[0].chapterCode = "PANDU";
    expect(validateRequirementRegister(r)).toContain("chapter_invalid");
  });
  it("rejects_score_5_for_binary_EP", () => {
    const ep = loadRequirementRegister().requirements[0];
    expect(scoreAllowed({ ...ep, allowedScores: [0, 10] }, 5)).toBe(false);
    expect(scoreAllowed({ ...ep, allowedScores: [0, 10] }, 10)).toBe(true);
    expect(scoreAllowed(ep, 12)).toBe(false);
  });
  it("requires_six_PROGNAS_topics_when_complete", () => {
    const base = loadRequirementRegister();
    const r: RequirementRegister = { ...base, complete: true, requirements: base.requirements.filter((ep) => ep.chapterCode === "SKP") };
    expect(validateRequirementRegister(r)).toEqual(expect.arrayContaining(["chapters_incomplete", "prognas_incomplete"]));
  });
  it("retains_evidence_S_and_source_locator", () => {
    const ep = loadRequirementRegister().requirements.find((e) => e.id === "47104-2024:SKP:1:3");
    expect(ep?.evidenceKinds).toContain("S");
    expect(ep?.page).toBeGreaterThan(300);
    expect(ep?.sourceId).toBe("INSTRUMEN-47104-2024");
  });
  it("rejects_duplicate_ids_invalid_scores_and_missing_source", () => {
    const r = structuredClone(loadRequirementRegister());
    r.requirements.push(r.requirements[0]); r.requirements[0].sourceId = "";
    expect(validateRequirementRegister(r)).toEqual(expect.arrayContaining(["duplicate_id", "source_missing"]));
  });
});
