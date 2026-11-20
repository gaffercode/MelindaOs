import { describe, expect, it } from "vitest";
import { composeBrief } from "@/lib/composer/compose";
import { detectFacts } from "@/lib/composer/facts";
import type { Narrative } from "@/lib/composer/narrative";
import { parseMelindaBrief } from "@/lib/melinda/melinda-brief-contract";
import { snapshot } from "./fixtures/medify-snapshot";

const facts = detectFacts(snapshot({ bed: [46, 50] }));
const fullNarrative: Narrative = {
  serviceSummary: "Okupansi tinggi.", safetyQuality: "Mutu terjaga.", pharmacy: "Stok stabil.", staffing: "Tidak ada perubahan.",
  decisions: [{ kode: "K-0123abcd", keputusan: "Tinjau kapasitas.", rekomendasi: "Siapkan tempat tidur cadangan." }],
  conclusion: ["Perlu perhatian Direktur."],
};
const emptyNarrative: Narrative = { serviceSummary: null, safetyQuality: null, pharmacy: null, staffing: null, decisions: [], conclusion: [] };
const compose = (narrative: Narrative | null, openInstructions: { id: string; title: string; pic: string[] }[] = [], input = snapshot({})) =>
  composeBrief({ snapshot: input, facts, narrative, openInstructions });

describe("composeBrief", () => {
  it("passes the brief contract with and without a narrative", () => {
    for (const narrative of [null, fullNarrative, emptyNarrative]) expect(() => parseMelindaBrief(compose(narrative))).not.toThrow();
  });

  it("accepts a composer stamp and keeps older payloads valid", () => {
    const brief = compose(fullNarrative);
    brief.composer = { outcome: "stored", at: "2026-10-23T22:30:00.000Z", modelCalled: true, facts: 3, decisions: 1 };
    expect(parseMelindaBrief(brief).composer).toEqual({ outcome: "stored", at: "2026-10-23T22:30:00.000Z", modelCalled: true, facts: 3, decisions: 1 });
    delete brief.composer;
    expect(parseMelindaBrief(brief).composer).toBeUndefined();
  });

  it("rejects an impossible composer outcome", () => {
    const bad = { ...compose(fullNarrative), composer: { outcome: "skipped", at: "2026-10-23T22:30:00.000Z", modelCalled: false, facts: 0, decisions: 0 } } as unknown;
    expect(() => parseMelindaBrief(bad)).toThrow();
  });

  it("marks the brief without analysis and says so", () => {
    const brief = compose(null);
    expect(brief.status).toBe("Otomatis, tanpa analisis");
    expect(brief.catatanStatus).toBe("Analisis belum tersedia.");
    expect(brief.serviceSummary.content).toBe("Analisis belum tersedia.");
    expect(brief.conclusion.paragraphs).toEqual(["Analisis belum tersedia."]);
  });

  it("writes the narrative into its sections and marks the brief automatic", () => {
    const brief = compose(fullNarrative);
    expect(brief.status).toBe("Otomatis");
    expect(brief.catatanStatus).toBe("");
    expect(brief.serviceSummary.content).toBe("Okupansi tinggi.");
    expect(brief.safetyQuality.analisis).toBe("Mutu terjaga.");
    expect(brief.claimsFinance.analisis).toBe("Stok stabil.");
    expect(brief.staffing.analisis).toBe("Tidak ada perubahan.");
    expect([brief.safetyQuality.catatan, brief.claimsFinance.catatan, brief.staffing.catatan]).toEqual(["", "", ""]);
    expect(brief.decisions.items).toEqual([{ kode: "K-0123abcd", keputusan: "Tinjau kapasitas.", rekomendasi: "Siapkan tempat tidur cadangan.", batas: "" }]);
    expect(brief.conclusion.paragraphs).toEqual(["Perlu perhatian Direktur."]);
  });

  it("shows a missing paragraph as if there were no narrative, and a missing conclusion by name", () => {
    const brief = compose({ ...emptyNarrative, pharmacy: "Stok stabil." });
    expect(brief.status).toBe("Otomatis");
    expect(brief.serviceSummary.content).toBe("Analisis belum tersedia.");
    expect(brief.claimsFinance.analisis).toBe("Stok stabil.");
    expect("analisis" in brief.staffing).toBe(false);
    expect(brief.conclusion.paragraphs).toEqual(["Kesimpulan belum tersedia."]);
  });

  it("treats a narrative that holds nothing as no narrative", () => {
    const brief = compose(emptyNarrative);
    expect(brief.status).toBe("Otomatis, tanpa analisis");
    expect(brief.catatanStatus).toBe("Analisis belum tersedia.");
    expect(brief.conclusion.paragraphs).toEqual(["Analisis belum tersedia."]);
  });

  it("counts a decision as analysis", () => {
    expect(compose({ ...emptyNarrative, decisions: fullNarrative.decisions }).status).toBe("Otomatis");
    expect(compose(emptyNarrative).status).toBe("Otomatis, tanpa analisis");
  });

  it("never shows finance and always lists it as a limitation", () => {
    const brief = compose(fullNarrative, [], snapshot({ finance: { cashToday: 123456789 } }));
    expect(JSON.stringify(brief)).not.toContain("123456789");
    expect(brief.dataLimitations.items.some((item) => item.startsWith("Angka keuangan Medify belum ditampilkan"))).toBe(true);
    expect(brief.dataLimitations.items.at(-1)).toBe("Klaim per kasus belum punya sumber otomatis.");
  });

  it("carries open instructions into follow-ups with their ids", () => {
    const brief = compose(null, [{ id: "IOC-0001", title: "Evaluasi vendor", pic: ["A", "B"] }, { id: "IOC-0002", title: "Cek stok", pic: [] }]);
    expect(brief.followUps.items).toEqual([
      { no: 1, item: "Evaluasi vendor", pemilikAgent: "A / B", instructionId: "IOC-0001" },
      { no: 2, item: "Cek stok", pemilikAgent: "-", instructionId: "IOC-0002" },
    ]);
  });

  it("carries at most 20 open instructions", () => {
    const open = Array.from({ length: 25 }, (_, index) => ({ id: `IOC-${String(index + 1).padStart(4, "0")}`, title: `Tugas ${index + 1}`, pic: ["A"] }));
    expect(compose(null, open).followUps.items).toHaveLength(20);
  });

  it("leaves out a row that looks like patient data and still passes the contract", () => {
    const brief = compose(null, [
      { id: "IOC-0001", title: "Tindak lanjut Ny. Sintetis", pic: ["A"] },
      { id: "IOC-0002", title: "Evaluasi vendor", pic: ["B"] },
    ]);
    expect(brief.followUps.items).toEqual([{ no: 1, item: "Evaluasi vendor", pemilikAgent: "B", instructionId: "IOC-0002" }]);
    expect(brief.dataLimitations.items).toContain("1 baris disembunyikan karena menyerupai data pasien.");
    expect(() => parseMelindaBrief(brief)).not.toThrow();
  });

  it("leaves out a row that is too long for the contract without counting it as hidden", () => {
    const brief = compose(null, [{ id: "IOC-0001", title: "x".repeat(2001), pic: ["A"] }, { id: "IOC-0002", title: "Evaluasi vendor", pic: ["B"] }]);
    expect(brief.followUps.items.map((item) => item.instructionId)).toEqual(["IOC-0002"]);
    expect(brief.dataLimitations.items.some((item) => item.includes("disembunyikan"))).toBe(false);
    expect(() => parseMelindaBrief(brief)).not.toThrow();
  });

  it("omits the service rows so the page derives them live", () => {
    expect("items" in compose(fullNarrative).serviceSummary).toBe(false);
  });

  it("writes the source, the pharmacy stock and the staff counts as plain text", () => {
    const brief = compose(null);
    expect(brief.sources).toBe("Medify");
    expect(compose(null, [], snapshot({ runUnavailable: [] })).sources).toBe("Medify, tarikan 09.31 WIB");
    expect(brief.date).toBe("Kamis, 15 Januari 2099");
    // Section 02's heading is its name; the long date stays in the masthead.
    expect(brief.serviceSummary.dateLabel).toBe("Ringkasan layanan");
    expect(brief.nomorVersi).toBe("MB-2099-01-15");
    expect(brief.claimsFinance.items).toEqual([{ pos: "Gudang Sintetis", nilaiStatus: "Rp 478.945.157", catatan: "" }]);
    expect(brief.staffing.items).toEqual([{ pos: "Tetap", status: "40 orang" }, { pos: "Kontrak", status: "28 orang" }]);
    expect(JSON.stringify(brief)).not.toContain(" ");
  });

  it("lists a section that failed to pull as a system finding, by its readable name", () => {
    const failed = snapshot({ nullSections: ["bed"], runUnavailable: ["bed", "inpatientMix"] });
    const brief = composeBrief({ snapshot: failed, facts: detectFacts(failed), narrative: null, openInstructions: [] });
    expect(brief.systemFindings.items).toEqual([{ temuan: "Tarikan tempat tidur gagal", keterangan: "request_failed" }, { temuan: "Tarikan komposisi rawat inap gagal", keterangan: "request_failed" }]);
    expect(brief.dataLimitations.items.some((item) => item.startsWith("Data tempat tidur tidak tersedia"))).toBe(true);
  });
});
