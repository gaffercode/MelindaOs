import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authConfiguration, protectedDirectorMode, type DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError, SupabaseDirectorStore } from "../director/director-store";
export type EvidenceStatus = "missing" | "draft" | "linked" | "verified" | "not_applicable";

export type StarkesLockState = "draft" | "submitted" | "locked";

export type StarkesAuditScore = {
  ep_id: string;
  chapter_code: string;
  score: 0 | 5 | 10;
  note: string;
  evidence_status: EvidenceStatus;
  lock_state: StarkesLockState;
  updated_by: string;
  updated_at: string;
  locked_by?: string | null;
  locked_at?: string | null;
  attachment_refs: unknown[];
};

type AuditFile = { scores: StarkesAuditScore[] };

const RPC = "melinda_starkes_audit";

function auditFilePath(): string {
  const base = process.env.MELINDAOS_DIRECTOR_DATA_DIR || join(/*turbopackIgnore: true*/ process.cwd(), "data");
  return join(base, "starkes-audit.json");
}

async function readFileScores(): Promise<StarkesAuditScore[]> {
  try {
    const raw = await readFile(auditFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AuditFile).scores)) return [];
    return (parsed as AuditFile).scores;
  } catch {
    return [];
  }
}

async function writeFileScores(scores: StarkesAuditScore[]): Promise<void> {
  const path = auditFilePath();
  await mkdir(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify({ scores }, null, 2), "utf8");
  await rename(temp, path);
}

function supabaseStore(config: DirectorAuthConfiguration): SupabaseDirectorStore {
  return config.store;
}

async function callStore<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (protectedDirectorMode()) {
    const config = authConfiguration();
    if (!config) throw new DirectorStoreError(503, "configuration");
    return supabaseStore(config).call<T>(command, args, RPC);
  }
  return fileCommand(command, args) as Promise<T>;
}

async function fileCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  let scores = await readFileScores();
  if (command === "list") return { scores };

  if (command === "upsert_draft") {
    const epId = String(args.ep_id ?? "");
    const existing = scores.find((row) => row.ep_id === epId);
    if (existing?.lock_state === "locked") throw new DirectorStoreError(409, "conflict");
    const now = new Date().toISOString();
    const next: StarkesAuditScore = {
      ep_id: epId,
      chapter_code: String(args.chapter_code ?? ""),
      score: Number(args.score) as 0 | 5 | 10,
      note: String(args.note ?? ""),
      evidence_status: args.evidence_status as EvidenceStatus,
      lock_state: existing?.lock_state === "submitted" ? "submitted" : "draft",
      updated_by: String(args.updated_by ?? ""),
      updated_at: now,
      locked_by: existing?.locked_by ?? null,
      locked_at: existing?.locked_at ?? null,
      attachment_refs: Array.isArray(args.attachment_refs) ? args.attachment_refs : [],
    };
    scores = scores.filter((row) => row.ep_id !== epId).concat(next);
    await writeFileScores(scores);
    return { score: next };
  }

  if (command === "submit_chapter") {
    const chapter = String(args.chapter_code ?? "");
    scores = scores.map((row) =>
      row.chapter_code === chapter && row.lock_state === "draft"
        ? { ...row, lock_state: "submitted", updated_by: String(args.updated_by ?? row.updated_by), updated_at: new Date().toISOString() }
        : row
    );
    await writeFileScores(scores);
    return { ok: true };
  }

  if (command === "lock") {
    if (args.actorRole !== "director") throw new DirectorStoreError(503, "forbidden");
    const chapter = String(args.chapter_code ?? "");
    const now = new Date().toISOString();
    scores = scores.map((row) =>
      row.chapter_code === chapter && (row.lock_state === "draft" || row.lock_state === "submitted")
        ? { ...row, lock_state: "locked", locked_by: String(args.updated_by ?? ""), locked_at: now, updated_by: String(args.updated_by ?? ""), updated_at: now }
        : row
    );
    await writeFileScores(scores);
    return { ok: true };
  }

  if (command === "unlock") {
    if (args.actorRole !== "director") throw new DirectorStoreError(503, "forbidden");
    const chapter = String(args.chapter_code ?? "");
    scores = scores.map((row) =>
      row.chapter_code === chapter && row.lock_state === "locked"
        ? { ...row, lock_state: "draft", locked_by: null, locked_at: null, updated_by: String(args.updated_by ?? ""), updated_at: new Date().toISOString() }
        : row
    );
    await writeFileScores(scores);
    return { ok: true };
  }

  throw new DirectorStoreError(503, "invalid_command");
}

export async function listStarkesAuditScores(): Promise<StarkesAuditScore[]> {
  const result = await callStore<{ scores: StarkesAuditScore[] }>("list", {});
  return Array.isArray(result.scores) ? result.scores : [];
}

export async function starkesAuditCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  return callStore(command, args);
}
