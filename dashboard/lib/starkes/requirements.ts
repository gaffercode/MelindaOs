import baseline from "../../data/starkes/baseline.json";
import register from "../../data/starkes/requirements.json";

export type EvidenceKind = "R" | "D" | "O" | "W" | "S";
export type OfficialRequirement = {
  id: string; chapterCode: string; standardCode: string; epCode: string; text: string;
  evidenceKinds: EvidenceKind[]; allowedScores: (0 | 5 | 10)[]; allowsTdd: boolean;
  sourceId: string; page: number; disposition: "mapped" | "unmapped"; documentIds: string[];
};
export type RequirementRegister = { baselineId: string; verifiedAsOf: string; complete: boolean; requirements: OfficialRequirement[] };

export function loadRequirementRegister(): RequirementRegister {
  return structuredClone(register) as RequirementRegister;
}

export function scoreAllowed(ep: OfficialRequirement, score: number): boolean {
  return ep.allowedScores.some((allowed) => allowed === score);
}

export function validateRequirementRegister(value: RequirementRegister): string[] {
  const errors = new Set<string>();
  if (!value.complete) errors.add("baseline_incomplete");
  const ids = new Set<string>();
  for (const ep of value.requirements) {
    if (ids.has(ep.id)) errors.add("duplicate_id");
    ids.add(ep.id);
    if (!baseline.chapters.includes(ep.chapterCode)) errors.add("chapter_invalid");
    const standard = ep.standardCode.replace(new RegExp(`^${ep.chapterCode}\\s*`), "");
    if (ep.id !== `${value.baselineId}:${ep.chapterCode}:${standard}:${ep.epCode}`) errors.add("id_invalid");
    if (!baseline.sources.some((s) => s.id === ep.sourceId) || !Number.isInteger(ep.page) || ep.page < 1) errors.add("source_missing");
    if (!ep.allowedScores.length || ep.allowedScores.some((s) => ![0, 5, 10].includes(s))) errors.add("score_invalid");
    if (!ep.evidenceKinds.length || ep.evidenceKinds.some((k) => !["R", "D", "O", "W", "S"].includes(k))) errors.add("evidence_invalid");
  }
  if (value.complete) {
    if (baseline.chapters.some((c) => !value.requirements.some((ep) => ep.chapterCode === c))) errors.add("chapters_incomplete");
    if ([1, 2, 3, 4, 5, 6].some((n) => !value.requirements.some((ep) => ep.standardCode === `PROGNAS ${n}`))) errors.add("prognas_incomplete");
  }
  return [...errors];
}
