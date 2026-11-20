import { describe, expect, it, vi } from "vitest";
import { saveDecisionForm } from "@/lib/decision/decision-form";
import { decisionReducer, initialDecisionState, type Decision } from "@/lib/decision/decision-state";
import { readDecisionState, STORAGE_KEY } from "@/lib/decision/decision-storage";

const at = "2026-10-03T00:00:00.000Z";
function validForm(): FormData {
  const form = new FormData();
  Object.entries({ title: "  Review scope  ", owner: "OPS", priority: "high", dueDate: "2026-10-05", recommendation: "Validate read-only access." }).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("decision form → reducer → persisted state", () => {
  it("saves trimmed fields, writes an audit entry and survives reload", () => {
    let state = initialDecisionState;
    const errors = saveDecisionForm(validForm(), undefined, at, "d-1", (decision) => {
      state = decisionReducer(state, { type: "create", decision, eventId: "e-1", correlationId: "c-1" });
    });
    expect(errors).toEqual([]);
    expect(state.decisions[0].title).toBe("Review scope");
    expect(state.audit[0].action).toBe("create");
    const storage = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
    expect(readDecisionState({ getItem: (key) => storage.get(key) ?? null }, initialDecisionState).state).toEqual(state);
  });
  it.each(["title", "owner", "dueDate", "recommendation"])("rejects missing %s without calling save", (field) => {
    const form = validForm();
    form.set(field, "");
    const save = vi.fn();
    expect(saveDecisionForm(form, undefined, at, "d", save).length).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps the existing identity on edit", () => {
    const save = vi.fn<(decision: Decision) => void>();
    saveDecisionForm(validForm(), undefined, at, "original", save);
    const original = save.mock.calls[0][0];
    saveDecisionForm(validForm(), original, "2026-10-04T00:00:00.000Z", "ignored", save);
    expect(save.mock.calls[1][0]).toMatchObject({ id: "original", createdAt: at, updatedAt: "2026-10-04T00:00:00.000Z" });
  });
});
