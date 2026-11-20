import { describe, expect, it } from "vitest";
import { detectFacts } from "@/lib/composer/facts";
import { parseMedifySnapshot } from "@/lib/medify/medify-snapshot-contract";
import { snapshot } from "./fixtures/medify-snapshot";

describe("brief fact detection", () => {
  it("builds a default fixture that passes the snapshot validator", () => {
    expect(() => parseMedifySnapshot(snapshot())).not.toThrow();
  });

  it("reads BOR from the bed census and flags it above the threshold", () => {
    const fact = detectFacts(snapshot({ bed: [46, 50] })).find((f) => f.id === "ambang:bor")!;
    expect(fact.severity).toBe("perhatian");
    expect(fact.values).toEqual([46, 50, 92, 85]);
    const calm = detectFacts(snapshot());
    expect(calm.some((f) => f.id === "ambang:bor")).toBe(false);
    expect(calm.find((f) => f.id === "keadaan:bed")!.values).toEqual([6, 10, 60]);
    expect(calm.find((f) => f.id === "penyumbang:bed.wards")!.text).toContain('"Ruang Sintetis A" 4 dari 4, "Ruang Sintetis B" 2 dari 6');
  });

  it("states no fact from the newest day of the daily BOR series, which Medify still revises", () => {
    const facts = detectFacts(snapshot({ borLatest: 2.4 }));
    expect(facts.some((f) => f.id === "perubahan:bor")).toBe(false);
    expect(facts.some((f) => f.text.includes("2,4"))).toBe(false);
  });

  it("marks month-to-date indicators as provisional and claims no direction", () => {
    const fact = detectFacts(snapshot()).find((f) => f.id === "bulanan:bor")!;
    expect(fact.text).toBe("BOR bulan berjalan 53,7% (angka sementara, masih berubah sampai bulan ditutup); bulan sebelumnya 44,92%.");
    expect(fact.text).not.toMatch(/naik|turun/);
  });

  it("flags SATUSEHAT below the limit the page prints, quoting Medify's figures", () => {
    const low = detectFacts(snapshot()).find((f) => f.id === "ambang:satusehat")!;
    expect([low.section, low.severity]).toEqual(["safetyQuality", "perhatian"]);
    expect(low.text).toBe("SATUSEHAT bulan berjalan menurut Medify 44,8%: 556 dari 561 resource terkirim, 0 gagal, 4 belum dikirim; di bawah batas 95%.");
    const fine = detectFacts(snapshot({ satusehatPercent: 99.1 }));
    expect(fine.some((f) => f.id === "ambang:satusehat")).toBe(false);
    expect(fine.find((f) => f.id === "keadaan:satusehat")!.severity).toBe("info");
  });

  it("reports staff counts and the mismatch the page shows", () => {
    const facts = detectFacts(snapshot());
    expect(facts.find((f) => f.id === "keadaan:staff_active")!.values).toEqual([69]);
    expect(facts.find((f) => f.id === "keadaan:staff_left")!.text).toBe("Pegawai keluar 1 orang dalam 2 bulan terakhir.");
    const mismatch = facts.find((f) => f.id === "data:staff.mismatch")!;
    expect([mismatch.kind, mismatch.section, mismatch.values]).toEqual(["data", "staffing", [61, 69]]);
  });

  it("reports uncategorised pharmacy items and depots without a stock value, never rupiah", () => {
    expect(detectFacts(snapshot()).some((f) => f.id.startsWith("data:pharmacy."))).toBe(false);
    const facts = detectFacts(snapshot({ pharmacyCategories: [["Fornas", 10], ["off", 5], [" - ", 5]], stockByUnit: [["Gudang Sintetis", 478945157], ["Depo Sintetis", null]] }));
    expect(facts.find((f) => f.id === "data:pharmacy.uncategorised")!.text).toBe("10 dari 20 item farmasi belum terkategori di Medify.");
    expect(facts.find((f) => f.id === "data:pharmacy.stockMissing")!.text).toBe("1 dari 2 depo farmasi belum memiliki nilai stok tercatat di Medify.");
    expect(facts.some((f) => f.text.includes("478"))).toBe(false);
  });

  it("gives every section of the brief at least one fact", () => {
    const sections = new Set<string>(detectFacts(snapshot()).map((f) => f.section));
    for (const section of ["serviceSummary", "safetyQuality", "claimsFinance", "staffing"]) expect(sections.has(section), section).toBe(true);
  });

  it("names the period of the outpatient lists in words", () => {
    const clinic = (overrides = {}) => detectFacts(snapshot(overrides)).find((f) => f.id === "penyumbang:outpatient.byClinic")!.text;
    expect(clinic()).toMatch(/^Poli rawat jalan dengan kunjungan terbanyak pada periode data Medify: /);
    expect(clinic({ outpatientPeriodStart: "2098-12-15" })).toMatch(/^Poli rawat jalan dengan kunjungan terbanyak dalam sebulan terakhir: /);
  });

  it("reports a change only above both floors", () => {
    expect(detectFacts(snapshot({ outpatientDaily: [100, 100, 100, 100, 100, 130] })).some((f) => f.id === "perubahan:outpatient_visits")).toBe(true);
    expect(detectFacts(snapshot({ outpatientDaily: [100, 100, 100, 100, 100, 110] })).some((f) => f.id === "perubahan:outpatient_visits")).toBe(false);
    expect(detectFacts(snapshot({ outpatientDaily: [4, 4, 4, 4, 4, 6] })).some((f) => f.id === "perubahan:outpatient_visits")).toBe(false);
  });

  it("produces no change fact from a short series", () => {
    const facts = detectFacts(snapshot({ outpatientDaily: [100, 300] }));
    expect(facts.some((f) => f.kind === "perubahan")).toBe(false);
    expect(facts.every((f) => f.values.every(Number.isFinite) && !f.text.includes("NaN"))).toBe(true);
  });

  it("turns null sections and failed run sections into data facts once each", () => {
    const facts = detectFacts(snapshot({ nullSections: ["finance", "pharmacy"], runUnavailable: ["pharmacy"] }));
    expect(facts.filter((f) => f.section === "dataLimitations").map((f) => f.id).sort()).toEqual(["data:finance", "data:pharmacy"]);
  });

  it("lists the top three contributors", () => {
    const fact = detectFacts(snapshot({ byClinic: [["A", 40], ["B", 30], ["C", 20], ["D", 10]] })).find((f) => f.id === "penyumbang:outpatient.byClinic")!;
    expect(fact.values).toEqual([40, 30, 20]);
  });

  it("quotes Medify labels unchanged", () => {
    const fact = detectFacts(snapshot({ topDiagnoses: [["O80.0-Spontaneous vertex delivery", 12]] })).find((f) => f.id === "penyumbang:inpatientMix.topDiagnoses")!;
    expect(fact.text).toContain("O80.0-Spontaneous vertex delivery");
    expect(fact.values).toEqual([12]);
  });
});
