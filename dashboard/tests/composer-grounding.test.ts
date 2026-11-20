import { describe, expect, it } from "vitest";
import { detectFacts, type Fact } from "@/lib/composer/facts";
import { allowedNumbers, decisionCode, isGrounded, numbersIn } from "@/lib/composer/grounding";
import { snapshot } from "./fixtures/medify-snapshot";

describe("numbersIn", () => {
  it("reads Indonesian number formats", () => {
    expect(numbersIn("BOR 87,5% dari 1.234 pasien, Rp 1.250.000")).toEqual([87.5, 1234, 1250000]);
  });
  it("reads a numeral with both separators and keeps floating point exact", () => {
    expect(numbersIn("1.234,5")).toEqual([1234.5]);
    expect(numbersIn("87,5")[0]).toBe(87.5);
    expect(numbersIn("5‰ dan 0,25‰")).toEqual([5, 0.25]);
  });
  it("skips codes and allows the numerals of quoted labels", () => {
    expect(numbersIn("O80.0-Spontaneous vertex delivery: 12 kasus di Kelas 1")).toEqual([12, 1]);
    expect(numbersIn("P03.4 - Fetus dan O63.0")).toEqual([]);
    expect(numbersIn("P03.4, O82 dan a09.9")).toEqual([]);
  });
  it("checks numerals glued to letters, which are not diagnosis codes", () => {
    expect(numbersIn("BOR88% di kelas2 dan VIP1")).toEqual([88, 2, 1]);
    expect(numbersIn("O80.123 dan H100")).toEqual([80123, 100]);
  });
  it("reads Rp glued to its amount", () => {
    expect(numbersIn("Rp1.250.000 dan RP500")).toEqual([1250000, 500]);
  });
  it("parses the magnitude and drops a trailing sentence dot", () => {
    expect(numbersIn("turun -12 poin")).toEqual([12]);
    expect(numbersIn("mencapai 85.")).toEqual([85]);
    expect(numbersIn("BOR 85,5.")).toEqual([85.5]);
  });
  it("reads a date as three numerals", () => {
    expect(numbersIn("per 2099-01-15")).toEqual([2099, 1, 15]);
  });
  it("counts a numeral followed, but not preceded, by a letter", () => {
    expect(numbersIn("naik 3x lipat, 30hari")).toEqual([3, 30]);
  });
  it("does not guess at ambiguous separators", () => {
    expect(numbersIn("0.125")).toEqual([0.125]);
    expect(numbersIn("1.2345")).toEqual([1.2345]);
    expect(numbersIn("1234.567")).toEqual([1234.567]);
    expect(numbersIn("Kelas 1,2,3")).toEqual([1, 2, 3]);
    expect(numbersIn("1.2.3")).toEqual([1, 2, 3]);
  });
});

describe("isGrounded", () => {
  it("rejects a wrong number glued to a letter", () => {
    expect(isGrounded("BOR88% melewati batas.", new Set([87.5, 85]))).toBe(false);
  });
  it("accepts text whose numbers are all in the facts", () => {
    const allowed = new Set([87.5, 85, 1234]);
    expect(isGrounded("BOR 87,5% melewati batas 85%.", allowed)).toBe(true);
    expect(isGrounded("BOR 88% melewati batas 85%.", allowed)).toBe(false);
    expect(isGrounded("Tidak ada angka.", allowed)).toBe(true);
  });
  it("tolerates floating point noise", () => {
    expect(isGrounded("BOR 0,3%", new Set([0.1 + 0.2]))).toBe(true);
    expect(isGrounded("BOR 0,31%", new Set([0.1 + 0.2]))).toBe(false);
  });
  it("rejects one wrong number among correct ones", () => {
    expect(isGrounded("BOR 87,5% dari 1.234 pasien, 86 di antaranya.", new Set([87.5, 1234]))).toBe(false);
  });
});

describe("allowedNumbers", () => {
  it("skips codes and allows the numerals of quoted labels", () => {
    const facts = [{ id: "penyumbang:inpatientMix.byWard", kind: "penyumbang", metric: null, section: "serviceSummary", severity: "info", values: [12], text: "Kelas 1: 12 pasien" }] as Fact[];
    const allowed = allowedNumbers(facts);
    expect(isGrounded("Kelas 1 menampung 12 pasien, terbanyak O80.0.", allowed)).toBe(true);
    expect(isGrounded("Kelas 2 menampung 12 pasien.", allowed)).toBe(false);
  });
  it("allows a label numeral glued to a letter when a fact quotes it", () => {
    const facts = [{ id: "penyumbang:inpatientMix.byWard", kind: "penyumbang", metric: null, section: "serviceSummary", severity: "info", values: [12], text: "VIP1: 12 pasien" }] as Fact[];
    expect(isGrounded("VIP1 menampung 12 pasien.", allowedNumbers(facts))).toBe(true);
    expect(isGrounded("VIP2 menampung 12 pasien.", allowedNumbers(facts))).toBe(false);
  });
  it("rejects a sentence that restates the date when no fact holds its numbers", () => {
    const facts = [{ id: "ambang:bor", kind: "ambang", metric: "bor", section: "serviceSummary", severity: "perhatian", values: [91.2, 85], text: "BOR hari lengkap terakhir 91,2%, di atas batas 85%." }] as Fact[];
    const allowed = allowedNumbers(facts);
    expect(isGrounded("BOR 91,2% di atas batas 85%.", allowed)).toBe(true);
    expect(isGrounded("Per 15 Januari, BOR 91,2%.", allowed)).toBe(false);
    expect(isGrounded("Ada 15 pasien baru.", allowed)).toBe(false);
    expect(isGrounded("Tahun 2099 BOR 91,2%.", allowed)).toBe(false);
  });
  it("accepts the text of every real fact", () => {
    const variants = [
      snapshot({}),
      snapshot({ bed: [46, 50] }),
      snapshot({ byClinic: [["Poli Sintetis A", 1300], ["Poli Sintetis B", 1234], ["Poli Sintetis C", 1250000]] }),
      snapshot({ outpatientDaily: [1000, 1020, 980, 1010, 990, 1000, 1500], nullSections: ["finance"], runUnavailable: ["pharmacy"] }),
    ];
    for (const variant of variants) {
      const facts = detectFacts(variant);
      const allowed = allowedNumbers(facts);
      for (const fact of facts) expect(isGrounded(fact.text, allowed), fact.text).toBe(true);
    }
    expect(detectFacts(variants[2]).some((fact) => fact.text.includes("1.300"))).toBe(true);
  });
});

describe("decisionCode", () => {
  it("gives one stable code per fact", () => {
    expect(decisionCode("ambang:bor")).toBe(decisionCode("ambang:bor"));
    expect(decisionCode("ambang:bor")).toMatch(/^K-[a-f0-9]{8}$/);
    expect(decisionCode("ambang:bor")).not.toBe(decisionCode("data:finance"));
  });
});
