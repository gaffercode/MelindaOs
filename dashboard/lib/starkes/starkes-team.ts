import type { StarkesChapterTeam, StarkesChapterTeams } from "@/components/starkes-team-data";
import { loadPrivateJson, type PrivateJsonSource } from "@/lib/storage/private-json";

export const STARKES_TEAM_OBJECT = "starkes-team.json";

const names = (value: unknown): value is string[] => Array.isArray(value) && value.every((name) => typeof name === "string");

function team(value: unknown): StarkesChapterTeam | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { lead, leadCandidates, members } = value as Record<string, unknown>;
  if (!(lead === null || typeof lead === "string") || !names(members)) return null;
  if (leadCandidates !== undefined && !names(leadCandidates)) return null;
  return leadCandidates === undefined ? { lead, members } : { lead, leadCandidates, members };
}

/** The working groups per chapter, or null when any entry has the wrong shape. */
export function parseStarkesTeams(value: unknown): StarkesChapterTeams | null {
  if (typeof value !== "object" || value === null) return null;
  const chapters = (value as { chapters?: unknown }).chapters;
  if (typeof chapters !== "object" || chapters === null || Array.isArray(chapters)) return null;
  const entries = Object.entries(chapters).map(([id, entry]) => [id, team(entry)] as const);
  if (entries.some(([, entry]) => entry === null)) return null;
  return Object.fromEntries(entries) as StarkesChapterTeams;
}

type Options = { env?: NodeJS.ProcessEnv; transport?: typeof fetch; dataDir?: string };

/** Server-side only: the STARKES working groups from the private bucket (see lib/storage/private-json.ts). */
export async function loadStarkesTeams(options: Options = {}): Promise<{ teams: StarkesChapterTeams; source: PrivateJsonSource } | null> {
  const loaded = await loadPrivateJson({ object: STARKES_TEAM_OBJECT, sample: "starkes-team.json", parse: parseStarkesTeams, ...options });
  return loaded ? { teams: loaded.value, source: loaded.source } : null;
}
