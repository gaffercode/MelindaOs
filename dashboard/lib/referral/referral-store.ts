import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { parseReferralPayload } from "./referral-contract";
import type { ReferralDraft, ReferralReceipt, ReferralStatus, StoredReferral } from "./referral-types";

const RPC = "melinda_referrals" as const;

type StoreRow = {
  id: string;
  reference: string;
  receivedAt: string;
  status: ReferralStatus;
  payload: unknown;
  note: string | null;
  handledBy: string | null;
  handledAt: string | null;
};

/** A stored row with a validated payload; a corrupt row is dropped instead of rendered. */
function toStored(row: StoreRow): StoredReferral | null {
  try {
    return { ...row, payload: parseReferralPayload(row.payload) };
  } catch {
    return null;
  }
}

export async function submitReferral(
  config: DirectorAuthConfiguration,
  input: { key: string; payload: ReferralDraft },
): Promise<ReferralReceipt> {
  return config.store.call<ReferralReceipt>("submit", { key: input.key, payload: input.payload }, RPC);
}

export async function listReferrals(
  config: DirectorAuthConfiguration,
  args: { status?: ReferralStatus; limit?: number } = {},
): Promise<StoredReferral[]> {
  const { referrals } = await config.store.call<{ referrals: StoreRow[] }>(
    "list",
    { ...(args.status ? { status: args.status } : {}), limit: args.limit ?? 50 },
    RPC,
  );
  return referrals.map(toStored).filter((row): row is StoredReferral => row !== null);
}

const OPEN_STATUSES: readonly ReferralStatus[] = ["baru", "dihubungi", "diterima"];

/**
 * The inbox list. One RPC list is capped at 100 rows, so the newest 100 alone would hide an unhandled referral behind
 * newer ones; each open status is therefore read on its own and merged in, newest first.
 */
export async function listInboxReferrals(config: DirectorAuthConfiguration): Promise<StoredReferral[]> {
  const lists = await Promise.all([
    listReferrals(config, { limit: 100 }),
    ...OPEN_STATUSES.map((status) => listReferrals(config, { status, limit: 100 })),
  ]);
  const byId = new Map(lists.flat().map((row) => [row.id, row]));
  return [...byId.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id));
}

export async function updateReferralStatus(
  config: DirectorAuthConfiguration,
  input: { id: string; status: ReferralStatus; note: string; actor: string },
): Promise<StoredReferral> {
  const { referral } = await config.store.call<{ referral: StoreRow }>("update", input, RPC);
  const parsed = toStored(referral);
  if (!parsed) throw new Error("referral_invalid");
  return parsed;
}
