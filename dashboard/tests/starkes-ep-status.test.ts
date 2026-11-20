import { describe, expect, it } from "vitest";
import { deriveEpStatus } from "../lib/starkes/ep-status";
import type { StarkesEvidence } from "../lib/starkes/evidence-store";
import type { OfficialRequirement } from "../lib/starkes/requirements";

const ep = (kinds: OfficialRequirement["evidenceKinds"], over: Partial<OfficialRequirement> = {}): OfficialRequirement => ({
  id: "47104-2024:SKP:1:2", chapterCode: "SKP", standardCode: "SKP 1", epCode: "2", text: "EP", evidenceKinds: kinds,
  allowedScores: [0, 5, 10], allowsTdd: false, sourceId: "INSTRUMEN-47104-2024", page: 380, disposition: "unmapped", documentIds: [], ...over,
});
const evidence = (kind: StarkesEvidence["kind"], status: StarkesEvidence["status"], epIds = ["47104-2024:SKP:1:2"]): StarkesEvidence => ({
  id: `${kind}-${status}`, source: "drive", ref: `${kind}-${status}`, chapter_code: "SKP", kind, ep_ids: epIds, name: null, mime: null,
  web_link: null, modified_at: null, matched_by: "ai", confidence: 0.9, phi_flag: false, status, decided_at: null,
});

describe("deriveEpStatus", () => {
  it("is missing with no evidence", () => {
    expect(deriveEpStatus(ep(["R", "D"]), [])).toEqual({ status: "missing", suggestedScore: 0, missingKinds: ["R", "D"] });
  });
  it("is partial with approved R only for an R+D EP", () => {
    expect(deriveEpStatus(ep(["R", "D"]), [evidence("R", "approved")])).toEqual({ status: "partial", suggestedScore: 5, missingKinds: ["D"] });
  });
  it("ignores rejected, pending and withdrawn evidence and evidence for other EPs", () => {
    const rows = [evidence("R", "rejected"), evidence("D", "pending"), evidence("D", "withdrawn"), evidence("R", "approved", ["47104-2024:SKP:1:1"])];
    expect(deriveEpStatus(ep(["R", "D"]), rows).status).toBe("missing");
  });
  it("is complete when every R/D/O kind has approved evidence; W does not block", () => {
    expect(deriveEpStatus(ep(["R", "D", "W"]), [evidence("R", "approved"), evidence("D", "approved")])).toEqual({ status: "complete", suggestedScore: 10, missingKinds: [] });
  });
  it("keeps the suggested score inside allowedScores", () => {
    expect(deriveEpStatus(ep(["R", "D"], { allowedScores: [0, 10] }), [evidence("R", "approved")]).suggestedScore).toBe(0);
  });
  it("needs the Director's score for W/S-only EPs, and that score overrides the suggestion", () => {
    expect(deriveEpStatus(ep(["W"]), []).status).toBe("missing");
    expect(deriveEpStatus(ep(["W"]), [], 5)).toEqual({ status: "complete", suggestedScore: 5, missingKinds: [] });
    expect(deriveEpStatus(ep(["R", "D"]), [], 10).suggestedScore).toBe(10);
  });
  it("is not applicable (TDD) in a not-applicable chapter", () => {
    expect(deriveEpStatus(ep(["R"], { chapterCode: "PPK", id: "47104-2024:PPK:1:1" }), [])).toEqual({ status: "not_applicable", suggestedScore: "TDD", missingKinds: [] });
  });
});
