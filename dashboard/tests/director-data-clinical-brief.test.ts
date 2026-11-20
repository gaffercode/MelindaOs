import { describe, expect, it } from "vitest";
import { parseDirectorDay } from "@/lib/director/director-data";

// `clinicalBrief` is an optional section of the v2 submission contract. The pages that rendered it
// moved to balowerti-os; the parser stays so stored rows that carry the section still parse.
const section = { updatedAt: "2099-01-15T07:16:00+07:00", source: "synthetic", items: [] };
const base = {
  schemaVersion: 1,
  date: "2099-01-15",
  schedule: section, agenda: section, priorities: section, decisions: section, followUps: section,
  dailyReport: { updatedAt: "2099-01-15T07:16:00+07:00", source: "synthetic", visits: 15, bpjsSubmitted: 14, bpjsPending: 0, revenue: null, expenses: null },
};
const clinicalBrief = {
  facility: "FASILITAS SINTETIS",
  docType: "CLINICAL MORNING BRIEF",
  title: "Clinical Morning Brief",
  date: "Kamis, 15 Januari 2099",
  time: "07.16 WIB",
  source: "sintetis",
  status: "Snapshot pagi · 4 pasien",
  queueSummary: {
    rooms: [{ room: "DEWASA", total: 4, completed: 0, waiting: 4, newPatient: 0, bpjs: 4, general: 0 }],
    total: { total: 4, completed: 0, waiting: 4, newPatient: 0, bpjs: 4, general: 0 },
    note: "Catatan antrean",
  },
  clinicalPriorities: {
    highlight: "PRIORITAS REVIEW Pasien Sintetis",
    patients: [{ queueNumber: "GA-9005", name: "Pasien Sintetis", age: 72, room: "LANSIA", chronicTag: "DM", prb: "DM", prolanis: "DM" }],
    note: "Catatan prioritas",
  },
  chronicPatientsOtherRooms: [{ queueNumber: "AC-9001", name: "Pasien Lain Sintetis", age: 48, room: "DEWASA", tag: "HT", note: "Tidak" }],
  administrativeFindings: [{ id: "adm-1", text: "Temuan 1", actionRequired: true }],
  dataLimitations: ["Limit 1"],
  followUps: ["Follow up 1"],
  conclusion: ["Kesimpulan 1"],
  disclaimer: "Disclaimer 1",
};

describe("parseDirectorDay clinicalBrief section", () => {
  it("parses an optional clinicalBrief and keeps it absent when not sent", () => {
    const parsed = parseDirectorDay({ ...base, clinicalBrief }, "2099-01-15");
    expect(parsed.clinicalBrief?.facility).toBe("FASILITAS SINTETIS");
    expect(parsed.clinicalBrief?.queueSummary.rooms[0].room).toBe("DEWASA");
    expect(parsed.clinicalBrief?.clinicalPriorities.patients[0].age).toBe(72);
    expect(parsed.clinicalBrief?.chronicPatientsOtherRooms[0].tag).toBe("HT");
    expect(parsed.clinicalBrief?.administrativeFindings[0].actionRequired).toBe(true);
    expect(parseDirectorDay(base, "2099-01-15").clinicalBrief).toBeUndefined();
  });

  it("rejects a clinicalBrief with a bad age or an unknown patient key", () => {
    const badAge = { ...base, clinicalBrief: { ...clinicalBrief, clinicalPriorities: { ...clinicalBrief.clinicalPriorities, patients: [{ ...clinicalBrief.clinicalPriorities.patients[0], age: "tua" }] } } };
    expect(() => parseDirectorDay(badAge, "2099-01-15")).toThrow();
    const unknownKey = { ...base, clinicalBrief: { ...clinicalBrief, chronicPatientsOtherRooms: [{ ...clinicalBrief.chronicPatientsOtherRooms[0], nik: "3506011234567890" }] } };
    expect(() => parseDirectorDay(unknownKey, "2099-01-15")).toThrow();
  });
});
