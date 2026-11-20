/*
 * Tim Akreditasi STARKES 2027 RSIA Melinda DHAI: panitia and one working group (pokja) per chapter.
 * The names live in the private Supabase bucket `hrd` (lib/starkes/starkes-team.ts), never in source. Structure from the
 * accreditation meeting of 4 Nov 2026, not yet enacted by a Director's decree; PMKP lead and the vice-chair role decided
 * by the Director on 5 Nov 2026.
 */

export interface StarkesTeamRole {
  role: string;
  names: string[];
}

export interface StarkesChapterTeam {
  /** Chapter lead; null while the Director has not decided. */
  lead: string | null;
  /** Candidates shown while `lead` is null. */
  leadCandidates?: string[];
  members: string[];
}

/** Keyed by StarkesChapter.id (lowercase code). PPK (not applicable to a non-teaching hospital) has no working group. */
export type StarkesChapterTeams = Record<string, StarkesChapterTeam>;

export const STARKES_TEAM_SOURCE =
  "Struktur rapat akreditasi 4 November 2026, belum ditetapkan dengan SK Direktur. Ejaan nama mengikuti data induk karyawan 2026 bila cocok.";

/** One-line lead label for a chapter: the lead, the open choice, or the committee for PPK. */
export function chapterLeadLabel(teams: StarkesChapterTeams | null, chapterId: string): string {
  if (!teams) return "Data tim belum tersedia";
  const team = teams[chapterId];
  if (!team) return "Panitia akreditasi";
  if (team.lead) return team.lead;
  return `Belum diputuskan: ${(team.leadCandidates ?? []).join(" atau ")}`;
}
