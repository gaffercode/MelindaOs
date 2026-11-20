import { describe, expect, it } from "vitest";
import { createBriefingPreview } from "@/lib/briefing";
import type { ValidationSnapshot } from "@/lib/contracts";
import type { Decision } from "@/lib/decision/decision-state";

const validation: ValidationSnapshot = {
  status: "available",
  scannedAt: "2026-09-29T00:00:00.000Z",
  counts: [],
  passed: 293,
  total: 293,
  limitation: "Format only",
};

describe("createBriefingPreview", () => {
  it("includes at most five active decisions ordered by due date", () => {
    const decisions = Array.from({ length: 7 }, (_, index): Decision => ({
      id: `d-${index}`,
      title: `Decision ${index}`,
      priority: "medium",
      owner: "Atlas",
      dueDate: `2026-10-${String(10 - index).padStart(2, "0")}`,
      recommendation: "Review",
      status: index === 0 ? "locally_resolved" : "local_draft",
      resolutionReason: index === 0 ? "Done" : "",
      createdAt: validation.scannedAt,
      updatedAt: validation.scannedAt,
    }));
    const preview = createBriefingPreview(validation, decisions, validation.scannedAt);
    expect(preview.decisions).toHaveLength(5);
    expect(preview.decisions[0].dueDate).toBe("2026-10-04");
    expect(preview.limitation).toContain("bukan briefing operasional");
  });
});
