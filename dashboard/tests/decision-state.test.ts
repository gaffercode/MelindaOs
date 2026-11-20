import { describe, expect, it } from "vitest";
import { decisionReducer, initialDecisionState, validateDecision, type Decision } from "@/lib/decision/decision-state";

const base: Decision = {
  id: "d-1",
  title: "Review provider contract",
  priority: "high",
  owner: "Atlas",
  dueDate: "2026-10-01",
  recommendation: "Review scope and approve the next step.",
  status: "local_draft",
  resolutionReason: "",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

describe("decisionReducer", () => {
  it("rejects duplicate IDs", () => {
    const state = { decisions: [base], audit: [] };
    expect(decisionReducer(state, { type: "create", decision: base, eventId: "e", correlationId: "c" })).toBe(state);
  });

  it("preserves creation time and workflow status on edit", () => {
    const state = { decisions: [base], audit: [] };
    const edited = decisionReducer(state, { type: "edit", decision: { ...base, title: "Changed", createdAt: "2026-10-03T00:00:00.000Z", status: "locally_resolved" }, eventId: "e", correlationId: "c" });
    expect(edited.decisions[0]).toMatchObject({ title: "Changed", createdAt: base.createdAt, status: base.status });
    expect(edited.audit[0].before).toEqual(base);
  });

  it.each(["2026-02-30", "invalid", "2026-13-01"])("rejects invalid due date %s", (dueDate) => {
    expect(validateDecision({ ...base, dueDate })).not.toEqual([]);
  });
  it("creates, resolves, and reopens with audit evidence", () => {
    const created = decisionReducer(initialDecisionState, { type: "create", decision: base, eventId: "e-1", correlationId: "c-1" });
    const resolved = decisionReducer(created, { type: "resolve", id: base.id, reason: "Approved locally", at: "2026-09-29T01:00:00.000Z", eventId: "e-2", correlationId: "c-2" });
    const reopened = decisionReducer(resolved, { type: "reopen", id: base.id, at: "2026-09-29T02:00:00.000Z", eventId: "e-3", correlationId: "c-3" });
    expect(reopened.decisions[0].status).toBe("local_draft");
    expect(reopened.audit.map((item) => item.action)).toEqual(["reopen", "resolve", "create"]);
  });

  it("rejects resolve without a reason", () => {
    const created = decisionReducer(initialDecisionState, { type: "create", decision: base, eventId: "e-1", correlationId: "c-1" });
    expect(decisionReducer(created, { type: "resolve", id: base.id, reason: "", at: base.updatedAt, eventId: "e-2", correlationId: "c-2" })).toBe(created);
  });

  it("purges decisions and prior audit data", () => {
    const created = decisionReducer(initialDecisionState, { type: "create", decision: base, eventId: "e-1", correlationId: "c-1" });
    const purged = decisionReducer(created, { type: "purge", at: base.updatedAt, eventId: "e-2", correlationId: "c-2" });
    expect(purged.decisions).toEqual([]);
    expect(purged.audit).toHaveLength(1);
    expect(purged.audit[0].action).toBe("purge");
  });
});
