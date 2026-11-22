import { describe, expect, it } from "vitest";
import { ClinicalValidationError, parseClinicalDraft, parseClinicalPayload } from "@/lib/clinical/clinical-contract";

const handover = {
  kind: "handover",
  date: "2026-11-22",
  shift: "malam",
  unit: "Rawat inap",
  payload: { patient: "Ny. Pasien QA", rm: "123456", room: "Aster 2", situation: "Demam 3 hari", background: "", assessment: "", recommendation: "Pantau suhu", pending: "Cek lab pagi", from: "Ns. A", to: "Ns. B" },
};
const roster = { kind: "roster", date: "2026-11-22", shift: "pagi", unit: "IGD", payload: { people: [{ name: "dr. A", role: "DPJP" }, { name: "Ns. B", role: "" }], notes: "" } };
const incident = {
  kind: "insiden",
  date: "2026-11-22",
  shift: null,
  unit: "Rawat inap",
  payload: { time: "14:05", place: "Aster", type: "KNC", grade: "hijau", chronology: "Obat hampir tertukar.", followUp: "", progress: "baru", reporter: "Ns. C" },
};

describe("clinical contract", () => {
  it.each([handover, roster, incident])("accepts a valid $kind entry and keeps its kind", (draft) => {
    expect(parseClinicalDraft(draft).kind).toBe(draft.kind);
  });

  it("trims text and treats optional fields as empty strings", () => {
    const parsed = parseClinicalDraft({ ...handover, unit: "  Rawat inap  ", payload: { ...handover.payload, background: undefined } });
    expect(parsed.unit).toBe("Rawat inap");
    expect(parsed.kind === "handover" && parsed.payload.background).toBe("");
  });

  it.each([
    ["an unknown kind", { ...handover, kind: "lain" }, "kind"],
    ["a calendar-invalid date", { ...handover, date: "2026-02-30" }, "date"],
    ["a handover without a shift", { ...handover, shift: null }, "shift"],
    ["an unknown shift", { ...roster, shift: "subuh" }, "shift"],
    ["a missing unit", { ...handover, unit: "   " }, "unit"],
    ["a handover without a patient", { ...handover, payload: { ...handover.payload, patient: "" } }, "payload.patient"],
    ["an over-long situation", { ...handover, payload: { ...handover.payload, situation: "x".repeat(1001) } }, "payload.situation"],
    ["an empty roster", { ...roster, payload: { people: [], notes: "" } }, "payload.people"],
    ["a roster over 40 people", { ...roster, payload: { people: Array.from({ length: 41 }, (_, i) => ({ name: `P${i}`, role: "" })), notes: "" } }, "payload.people"],
    ["an incident with a bad time", { ...incident, payload: { ...incident.payload, time: "25:00" } }, "payload.time"],
    ["an incident with an unknown grade", { ...incident, payload: { ...incident.payload, grade: "ungu" } }, "payload.grade"],
    ["a non-object draft", "bukan objek", "draft"],
  ])("rejects %s and names only the field", (_label, draft, path) => {
    expect(() => parseClinicalDraft(draft)).toThrow(ClinicalValidationError);
    try {
      parseClinicalDraft(draft);
    } catch (error) {
      expect((error as ClinicalValidationError).path).toBe(path);
      expect((error as Error).message).toBe(path);
    }
  });

  it("allows an incident without a shift but not a handover or roster", () => {
    expect(parseClinicalDraft(incident).shift).toBeNull();
    expect(() => parseClinicalDraft({ ...roster, shift: null })).toThrow(ClinicalValidationError);
  });

  it("validates a stored payload against its own kind", () => {
    expect(parseClinicalPayload("roster", roster.payload).people).toHaveLength(2);
    expect(() => parseClinicalPayload("insiden", roster.payload)).toThrow(ClinicalValidationError);
  });
});
