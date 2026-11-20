import chapterMap from "../../data/starkes/chapter-map.json";
import type { StarkesEvidence } from "./evidence-store";
import type { OfficialRequirement } from "./requirements";
import type { EpScore } from "./scoring";

export type EpStatus = "missing" | "partial" | "complete" | "not_applicable";
export type ChapterInfo = { name: string; group: string; kbRef: string; studioPresetCodes: string[]; applicability: "required" | "not_applicable" };

export const CHAPTERS = chapterMap as Record<string, ChapterInfo>;

/** Kinds proven by files; W (interview) and S (simulation) are judged by the Director during the audit. */
const FILE_KINDS = new Set(["R", "D", "O"]);

/**
 * EP status from approved evidence only. complete: every R/D/O kind of the EP has approved evidence; partial: some do.
 * An EP with only W/S kinds is complete once the Director has scored it. The Director's score overrides the suggestion.
 */
export function deriveEpStatus(
  ep: OfficialRequirement,
  evidence: StarkesEvidence[],
  directorScore?: 0 | 5 | 10,
): { status: EpStatus; suggestedScore: EpScore; missingKinds: string[] } {
  if (CHAPTERS[ep.chapterCode]?.applicability === "not_applicable") return { status: "not_applicable", suggestedScore: "TDD", missingKinds: [] };
  const needed = ep.evidenceKinds.filter((k) => FILE_KINDS.has(k));
  const approved = new Set(evidence.filter((e) => e.status === "approved" && e.ep_ids.includes(ep.id)).map((e) => e.kind));
  const missingKinds = needed.filter((k) => !approved.has(k));

  let status: EpStatus;
  if (!needed.length) status = directorScore === undefined ? "missing" : "complete";
  else if (!missingKinds.length) status = "complete";
  else status = missingKinds.length < needed.length ? "partial" : "missing";

  const target = status === "complete" ? 10 : status === "partial" ? 5 : 0;
  const best = ep.allowedScores.filter((s) => s <= target).reduce<0 | 5 | 10>((top, s) => (s > top ? s : top), 0);
  const suggestedScore = directorScore ?? best;
  return { status, suggestedScore, missingKinds };
}
