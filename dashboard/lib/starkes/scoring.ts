import { chapterPassMark, type Kelulusan } from "./kelulusan-rules";

export type EpScore = 0 | 5 | 10 | "TDD";
export type Predicate = "paripurna" | "utama" | "madya" | "tidak_terakreditasi";

/** Σ scores / (10 × non-TDD EPs) × 100, rounded down to one decimal; null when every EP is TDD. */
export function chapterPercent(scores: EpScore[]): number | null {
  const counted = scores.filter((s): s is 0 | 5 | 10 => s !== "TDD");
  if (!counted.length) return null;
  const sum = counted.reduce<number>((total, s) => total + s, 0);
  return Math.floor((sum * 1000) / (counted.length * 10)) / 10;
}

/**
 * Predicted survey result. Chapters with a null percent (all TDD, or PPK at a non-teaching hospital) do not count;
 * PROGNAS is judged on its own. `blocking` lists what stands between this result and paripurna.
 */
export function predictPredicate(
  chapters: Record<string, number | null>,
  rules: Kelulusan,
  teaching: boolean,
): { predicate: Predicate; passedChapters: string[]; blocking: string[] } {
  const tiers = teaching ? rules.teaching : rules.non_teaching;
  const mark = chapterPassMark(rules);
  const applicable = Object.entries(chapters).filter(
    (entry): entry is [string, number] => entry[0] !== "PROGNAS" && entry[1] !== null && (teaching || entry[0] !== "PPK"),
  );
  const passedChapters = applicable.filter(([, v]) => v >= mark).map(([code]) => code);
  const skp = chapters.SKP ?? null;
  const prognas = chapters.PROGNAS ?? null;
  const prognasOk = (min: number) => prognas !== null && prognas >= min;
  const reaches = (tier: typeof tiers.utama) =>
    passedChapters.length >= (tier.chapters_min_80_range?.[0] ?? Infinity) && skp !== null && skp >= (tier.skp_min ?? Infinity) && prognasOk(tier.prognas_min);

  let predicate: Predicate = "tidak_terakreditasi";
  if (applicable.length && passedChapters.length === applicable.length && prognasOk(tiers.paripurna.prognas_min)) predicate = "paripurna";
  else if (reaches(tiers.utama)) predicate = "utama";
  else if (reaches(tiers.madya)) predicate = "madya";

  const blocking = applicable.filter(([, v]) => v < mark).map(([code]) => code);
  if (!prognasOk(tiers.paripurna.prognas_min)) blocking.push("PROGNAS");
  return { predicate, passedChapters, blocking };
}
