import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { parseClinicalPayload } from "./clinical-contract";
import type { ClinicalDraft, ClinicalKind, ClinicalStatus, PayloadFor, Shift, StoredClinicalEntry } from "./clinical-types";

const RPC = "melinda_clinical" as const;

type StoreRow = {
  id: string;
  kind: ClinicalKind;
  date: string;
  shift: Shift | null;
  unit: string;
  payload: unknown;
  status: ClinicalStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

/** A stored row with a validated payload; a corrupt row is dropped instead of rendered or served. */
function toStored(row: StoreRow): StoredClinicalEntry | null {
  try {
    return { ...row, payload: parseClinicalPayload(row.kind, row.payload) } as StoredClinicalEntry;
  } catch {
    return null;
  }
}

export async function createClinicalEntry(
  config: DirectorAuthConfiguration,
  input: { key: string; draft: ClinicalDraft; actor: string },
): Promise<{ id: string; createdAt: string; replayed: boolean }> {
  const { draft } = input;
  return config.store.call(
    "create",
    { key: input.key, kind: draft.kind, date: draft.date, shift: draft.shift, unit: draft.unit, payload: draft.payload, actor: input.actor },
    RPC,
  );
}

export type ClinicalListArgs = { kind?: ClinicalKind; from?: string; to?: string; status?: ClinicalStatus; limit?: number };

export async function listClinicalEntries(config: DirectorAuthConfiguration, args: ClinicalListArgs = {}): Promise<StoredClinicalEntry[]> {
  const { entries } = await config.store.call<{ entries: StoreRow[] }>(
    "list",
    {
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      ...(args.status ? { status: args.status } : {}),
      limit: args.limit ?? 100,
    },
    RPC,
  );
  return entries.map(toStored).filter((row): row is StoredClinicalEntry => row !== null);
}

export type ClinicalUpdate<K extends ClinicalKind = ClinicalKind> = {
  id: string;
  revision: number;
  actor: string;
  kind: K;
  status?: ClinicalStatus;
  unit?: string;
  shift?: Shift | null;
  payload?: PayloadFor[K];
};

export async function updateClinicalEntry(config: DirectorAuthConfiguration, input: ClinicalUpdate): Promise<StoredClinicalEntry> {
  const { entry } = await config.store.call<{ entry: StoreRow }>("update", input, RPC);
  const parsed = toStored(entry);
  if (!parsed) throw new Error("clinical_invalid");
  return parsed;
}

/** One audit row per MCP read: every MCP caller shares one identity, so this is the only record of who read patient data. */
export async function auditClinicalRead(
  config: DirectorAuthConfiguration,
  input: { kind: ClinicalKind; reader: string; count: number; detail: { from: string; to: string; limit: number; ids: string[] } },
): Promise<void> {
  await config.store.call("audit_read", input, RPC);
}
