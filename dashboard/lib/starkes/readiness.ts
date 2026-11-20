import { CHAPTERS, deriveEpStatus, type EpStatus } from "./ep-status";
import type { StarkesEvidence } from "./evidence-store";
import { chapterPassMark, type Kelulusan } from "./kelulusan-rules";
import type { OfficialRequirement } from "./requirements";
import { chapterPercent, predictPredicate, type EpScore, type Predicate } from "./scoring";

export type DirectorScore = { ep_id: string; score: 0 | 5 | 10; lock_state: string };
export type EpReadiness = OfficialRequirement & {
  status: EpStatus; score: EpScore; missingKinds: string[]; directorScore: 0 | 5 | 10 | null; evidence: StarkesEvidence[];
};
export type ChapterReadiness = { code: string; name: string; applicable: boolean; percent: number | null; eps: EpReadiness[] };
export type Readiness = {
  chapters: ChapterReadiness[];
  passMark: number;
  predicate: Predicate;
  blocking: string[];
  priorities: (EpReadiness & { gain: number })[];
};

/** Readiness of every chapter from the register, approved evidence and the Director's audit scores. */
export function computeReadiness(
  requirements: OfficialRequirement[],
  evidence: StarkesEvidence[],
  scores: DirectorScore[],
  rules: Kelulusan,
): Readiness {
  const passMark = chapterPassMark(rules);
  const director = new Map(scores.map((s) => [s.ep_id, s.score]));
  const chapters = Object.entries(CHAPTERS).map(([code, info]): ChapterReadiness => {
    const eps = requirements.filter((ep) => ep.chapterCode === code).map((ep): EpReadiness => {
      const directorScore = director.get(ep.id) ?? null;
      const derived = deriveEpStatus(ep, evidence, directorScore ?? undefined);
      return { ...ep, status: derived.status, score: derived.suggestedScore, missingKinds: derived.missingKinds, directorScore, evidence: evidence.filter((e) => e.ep_ids.includes(ep.id) && e.status !== "withdrawn") };
    });
    return { code, name: info.name, applicable: info.applicability === "required", percent: chapterPercent(eps.map((ep) => ep.score)), eps };
  });
  const { predicate, blocking } = predictPredicate(Object.fromEntries(chapters.map((c) => [c.code, c.percent])), rules, false);

  // Highest gain first: chapters closest below the pass mark (PROGNAS against 100), SKP and PROGNAS first among equals.
  const priorities = chapters.flatMap((c) => {
    const target = c.code === "PROGNAS" ? 100 : passMark;
    if (!c.applicable || c.percent === null || c.percent >= target) return [];
    const counted = c.eps.filter((ep) => ep.score !== "TDD").length;
    return c.eps.filter((ep) => ep.status !== "complete" && ep.status !== "not_applicable").map((ep) => ({
      ep: { ...ep, gain: ((Math.max(...ep.allowedScores) - (ep.score === "TDD" ? 0 : ep.score)) * 10) / counted }, distance: target - (c.percent ?? 0), key: c.code === "SKP" || c.code === "PROGNAS" ? 0 : 1,
    }));
  }).sort((a, b) => a.distance - b.distance || a.key - b.key || b.ep.gain - a.ep.gain).slice(0, 10).map((item) => item.ep);

  return { chapters, passMark, predicate, blocking, priorities };
}
