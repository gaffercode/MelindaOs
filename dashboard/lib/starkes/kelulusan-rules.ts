type Tier = { chapters_min_80?: "all_applicable_except_prognas"; chapters_min_80_range?: [number, number]; skp_min?: number; prognas_min: number };
type Rules = { paripurna: Tier; utama: Tier; madya: Tier };
/** STARKES 2024 pass/fail criteria (plan 02 Task 1), the only source of accreditation thresholds. */
export type Kelulusan = { non_teaching: Rules; teaching: Rules };

/** Chapter pass mark, read from the rule key ("chapters_min_80") so no threshold lives in code. */
export function chapterPassMark(rules: Kelulusan): number {
  const key = Object.keys(rules.non_teaching.paripurna).find((k) => /^chapters_min_\d+$/.test(k));
  if (!key) throw new Error("starkes-kelulusan-2024.json: paripurna has no chapters_min_<mark> rule");
  return Number(key.slice("chapters_min_".length));
}
