import type { ValidationSnapshot } from "./contracts";
import type { Decision } from "./decision/decision-state";

export interface BriefingPreview {
  generatedAt: string;
  title: string;
  limitation: string;
  validationLine: string;
  decisions: Decision[];
}

export function createBriefingPreview(
  validation: ValidationSnapshot,
  decisions: Decision[],
  generatedAt: string,
): BriefingPreview {
  const active = decisions
    .filter((item) => item.status === "local_draft")
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 5);
  const validationLine = validation.status === "available"
    ? `${validation.passed} dari ${validation.total} dokumen lolos validasi format dan governance.`
    : "Validasi format dan governance belum tersedia.";

  return {
    generatedAt,
    title: "Director briefing preview",
    limitation: "Preview lokal — bukan briefing operasional dan tidak memuat data SIMRS live.",
    validationLine,
    decisions: active,
  };
}
