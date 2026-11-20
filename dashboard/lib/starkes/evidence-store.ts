import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authConfiguration, protectedDirectorMode } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";

export type EvidenceKindCode = "R" | "D" | "O" | "W" | "S";
export type EvidenceDecision = "pending" | "approved" | "rejected" | "withdrawn";

/** Metadata of one piece of evidence (a KB regulation or a Drive file); file contents are never stored. */
export type NewEvidence = {
  source: "kb" | "drive";
  ref: string;
  chapter_code: string;
  kind: EvidenceKindCode | null;
  ep_ids: string[];
  name: string | null;
  mime: string | null;
  web_link: string | null;
  modified_at: string | null;
  matched_by: "ai" | "director" | "rule" | null;
  confidence: number | null;
  phi_flag: boolean;
};
export type StarkesEvidence = NewEvidence & { id: string; status: EvidenceDecision; decided_at: string | null };

const RPC = "melinda_starkes_evidence";

async function callStore<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (protectedDirectorMode()) {
    const config = authConfiguration();
    if (!config) throw new DirectorStoreError(503, "configuration");
    return config.store.call<T>(command, args, RPC);
  }
  return fileCommand(command, args) as Promise<T>;
}

function evidenceFilePath(): string {
  return join(process.env.MELINDAOS_DIRECTOR_DATA_DIR || join(/*turbopackIgnore: true*/ process.cwd(), "data"), "starkes-evidence.json");
}

async function readRows(): Promise<StarkesEvidence[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(evidenceFilePath(), "utf8"));
    const rows = (parsed as { evidence?: unknown }).evidence;
    return Array.isArray(rows) ? (rows as StarkesEvidence[]) : [];
  } catch {
    return [];
  }
}

async function writeRows(evidence: StarkesEvidence[]): Promise<void> {
  const path = evidenceFilePath();
  await mkdir(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ path, ".."), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify({ evidence }, null, 2), "utf8");
  await rename(`${path}.tmp`, path);
}

/** Local-development mirror of public.melinda_starkes_evidence (same rules as the SQL function). */
async function fileCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  let rows = await readRows();
  if (command === "list") return { evidence: rows };

  if (command === "upsert_pending") {
    for (const item of args.rows as NewEvidence[]) {
      const existing = rows.find((r) => r.source === item.source && r.ref === item.ref);
      const renewed = !existing || existing.modified_at !== item.modified_at || existing.chapter_code !== item.chapter_code || existing.status === "withdrawn";
      const next: StarkesEvidence = {
        ...item,
        id: existing?.id ?? randomUUID(),
        status: renewed ? "pending" : existing.status,
        decided_at: renewed ? null : existing.decided_at,
      };
      rows = rows.filter((r) => r !== existing).concat(next);
    }
    await writeRows(rows);
    return { ok: true };
  }

  if (command === "decide_batch") {
    const ids = new Set(args.ids as string[]);
    const now = new Date().toISOString();
    let updated = 0;
    rows = rows.map((r) => {
      if (!ids.has(r.id) || r.status === "withdrawn") return r;
      updated += 1;
      return { ...r, status: args.status as EvidenceDecision, decided_at: now };
    });
    await writeRows(rows);
    return { updated };
  }

  if (command === "withdraw_missing") {
    const present = new Set(args.present_refs as string[]);
    const now = new Date().toISOString();
    let withdrawn = 0;
    rows = rows.map((r) => {
      if (r.source !== "drive" || r.chapter_code !== args.chapter_code || r.status === "withdrawn" || present.has(r.ref)) return r;
      withdrawn += 1;
      return { ...r, status: "withdrawn", decided_at: now };
    });
    await writeRows(rows);
    return { withdrawn };
  }

  throw new DirectorStoreError(503, "invalid_command");
}

export async function listEvidence(): Promise<StarkesEvidence[]> {
  const result = await callStore<{ evidence?: StarkesEvidence[] }>("list", {});
  return Array.isArray(result.evidence) ? result.evidence : [];
}

export async function upsertPending(rows: NewEvidence[]): Promise<void> {
  if (rows.length) await callStore("upsert_pending", { rows });
}

export async function decideBatch(ids: string[], status: "approved" | "rejected"): Promise<void> {
  await callStore("decide_batch", { ids, status });
}

export async function withdrawMissing(chapter: string, presentRefs: string[]): Promise<number> {
  const result = await callStore<{ withdrawn?: number }>("withdraw_missing", { chapter_code: chapter, present_refs: presentRefs });
  return result.withdrawn ?? 0;
}
