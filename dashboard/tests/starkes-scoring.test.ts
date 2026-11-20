import { beforeAll, describe, expect, it } from "vitest";
import { loadKelulusan, type Kelulusan } from "../lib/starkes/kelulusan";
import { chapterPercent, predictPredicate } from "../lib/starkes/scoring";

const NON_PROGNAS = ["TKRS", "KPS", "MFK", "PMKP", "MRMIK", "PPI", "AKP", "HPK", "PP", "PAP", "PAB", "PKPO", "KE", "SKP"];

function chapters(passing: number, overrides: Record<string, number | null> = {}): Record<string, number | null> {
  const result: Record<string, number | null> = { PPK: null, PROGNAS: 100 };
  NON_PROGNAS.forEach((code, i) => { result[code] = i < passing ? 80 : 50; });
  return { ...result, ...overrides };
}

let rules: Kelulusan;
beforeAll(async () => { rules = await loadKelulusan(); });

describe("chapterPercent", () => {
  it("excludes TDD and rounds down to one decimal", () => {
    expect(chapterPercent([10, 5, 0, "TDD"])).toBe(50);
    expect(chapterPercent(["TDD"])).toBeNull();
    expect(chapterPercent([10, 10, 5])).toBe(83.3);
  });
});

describe("predictPredicate (non-teaching)", () => {
  it("paripurna when all 14 applicable chapters pass and PROGNAS is 100", () => {
    expect(predictPredicate(chapters(14), rules, false).predicate).toBe("paripurna");
  });
  it("utama with 12 chapters passing and SKP 85", () => {
    const skpFirst = chapters(0, Object.fromEntries(["SKP", ...NON_PROGNAS.slice(0, 11)].map((c) => [c, 80])));
    expect(predictPredicate({ ...skpFirst, SKP: 85 }, rules, false).predicate).toBe("utama");
  });
  it("madya with 12 chapters passing but SKP 75", () => {
    const result = predictPredicate(chapters(12, { SKP: 75 }), rules, false);
    expect(result.predicate).toBe("madya");
    expect(result.blocking).toContain("SKP");
  });
  it("tidak_terakreditasi when PROGNAS is below 100", () => {
    const result = predictPredicate(chapters(14, { PROGNAS: 95 }), rules, false);
    expect(result.predicate).toBe("tidak_terakreditasi");
    expect(result.blocking).toContain("PROGNAS");
  });
  it("tidak_terakreditasi with only 6 chapters passing", () => {
    expect(predictPredicate(chapters(6), rules, false).predicate).toBe("tidak_terakreditasi");
  });
});
