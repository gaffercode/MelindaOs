import { describe, expect, it, vi } from "vitest";
import { readDecisionState, STORAGE_KEY } from "@/lib/decision/decision-storage";
import { initialDecisionState, type Decision } from "@/lib/decision/decision-state";

export const sampleDecision: Decision = {
  id: "test-1", title: "Review integration", owner: "OPS", priority: "high",
  dueDate: "2026-10-05", recommendation: "Validate read-only scope.",
  status: "local_draft", resolutionReason: "",
  createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z",
};

describe("readDecisionState", () => {
  it("loads valid saved state and accepts an explicitly empty state", () => {
    for (const state of [initialDecisionState, { decisions: [sampleDecision], audit: [] }]) {
      const getItem = vi.fn(() => JSON.stringify(state));
      expect(readDecisionState({ getItem }, initialDecisionState)).toEqual({ state, writable: true, error: "" });
      expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    }
  });
  it("uses defaults only when no stored value exists", () => {
    expect(readDecisionState({ getItem: () => null }, initialDecisionState).writable).toBe(true);
  });
  it.each(["{", "null", '{"decisions":null,"audit":[]}', '{"decisions":[],"audit":[{}]}', ""]) (
    "preserves malformed storage and falls back without allowing writes: %s", (saved) => {
      const fallback = { decisions: [sampleDecision], audit: [] };
      const result = readDecisionState({ getItem: () => saved }, fallback);
      expect(result.state).toBe(fallback);
      expect(result.writable).toBe(false);
      expect(result.error).not.toBe("");
    },
  );
  it.each([{ dueDate: "not-a-date" }, { dueDate: "2026-02-30" }, { priority: "urgent" }, { createdAt: "invalid" }])(
    "rejects persisted fields that would break rendering: %s", (fields) => {
      const saved = JSON.stringify({ decisions: [{ ...sampleDecision, ...fields }], audit: [] });
      expect(readDecisionState({ getItem: () => saved }, initialDecisionState).writable).toBe(false);
    },
  );
  it("handles blocked browser storage", () => {
    expect(readDecisionState({ getItem: () => { throw new Error("Blocked"); } }, initialDecisionState).writable).toBe(false);
  });
});
