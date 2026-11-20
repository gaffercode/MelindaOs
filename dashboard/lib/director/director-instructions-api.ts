import type { DirectorAuthConfiguration } from "./director-auth";
import { DirectorApiError, jsonResponse, rateLimit, readBoundedJson, requestKey, requireConfiguration, requireHuman } from "./director-api";
import { validReportDate } from "./director-data";
import { messageText, parseInstructionInput, type Instruction, type InstructionInput } from "./director-instructions";
import { canonicalHash, DirectorStoreError } from "./director-store";
import { logError } from "../log";

type Stored = { instruction: Instruction; replayed: boolean };
const rpc = "melinda_director_instructions";
export const OPEN_WINDOW_DEFAULT_DAYS = 14;

async function loadOfficials(config: DirectorAuthConfiguration): Promise<string[] | null> {
  return config.store.call<{ officials: string[] }>("list", {}, "melinda_director_officials")
    .then((result) => result.officials, (error: unknown) => { logError("officials_unavailable", error); return null; });
}

export const LINKED_IDS_MAX = 100;

/** Instructions referenced by `id` (a brief's carried follow-ups) that are not already in `known`; ids that no longer exist are skipped. */
async function linkedInstructions(config: DirectorAuthConfiguration, ids: string[], known: Instruction[]): Promise<Instruction[]> {
  const wanted = [...new Set(ids)].filter((id) => !known.some((instruction) => instruction.id === id));
  const found = await Promise.all(wanted.map((id) => config.store.call<Stored>("read", { id }, rpc).then((result) => result.instruction, (error: unknown) => {
    if (error instanceof DirectorStoreError && error.status === 404) return null;
    throw error;
  })));
  return found.filter((instruction): instruction is Instruction => instruction !== null);
}

export async function listInstructions(request: Request): Promise<Response> {
  const { config } = await requireHuman(request);
  const params = new URL(request.url).searchParams;
  const date = params.get("tanggal") ?? "";
  if (!validReportDate(date)) throw new DirectorApiError(400, "Tanggal tidak valid.");
  const ids = params.getAll("id");
  if (ids.length > LINKED_IDS_MAX || ids.some((id) => !/^IOC-\d{4,9}$/.test(id))) throw new DirectorApiError(400, "Format id arahan tidak valid.");
  const [{ instructions }, officials] = await Promise.all([config.store.call<{ instructions: Instruction[] }>("list", { date }, rpc), loadOfficials(config)]);
  const linked = ids.length ? await linkedInstructions(config, ids, instructions) : [];
  return jsonResponse({ configured: false, instructions: [...instructions, ...linked], officials: officials ?? [] });
}

function daysBefore(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

/**
 * Instructions not yet `selesai` and not marked done by the Director, report dates in the `days` ending on `to`,
 * oldest first: one `open` RPC call (migration `202610290002`); the filter here mirrors the SQL one. Each item
 * carries `messageText`, the text the Director can copy to staff.
 */
export async function openInstructions(config: DirectorAuthConfiguration, to: string, days: number): Promise<{ from: string; instructions: (Instruction & { messageText: string })[] }> {
  const from = daysBefore(to, days - 1);
  const { instructions } = await config.store.call<{ instructions: Instruction[] }>("open", { from, to }, rpc);
  // "Tandai selesai" is the Director closing the item; it must not come back as an open follow-up while staff confirm.
  return {
    from,
    instructions: instructions
      .filter((instruction) => instruction.status !== "selesai" && instruction.action !== "done")
      .map((instruction) => ({ ...instruction, messageText: messageText(instruction, instruction.id) })),
  };
}

/** "Tandai selesai" on a carried item closes the earlier instruction too. A missing id is left as is. `dibuat` and `gagal` can close because advance now allows them to reach `selesai`. */
async function closeLinked(config: DirectorAuthConfiguration, linkedId: string, reviewerId: string): Promise<void> {
  try {
    await config.store.call<Stored>("advance", { id: linkedId, status: "selesai", actor: reviewerId }, rpc);
  } catch (error) {
    if (error instanceof DirectorStoreError && (error.status === 409 || error.status === 404)) { logError("linked_close_skipped", { status: error.status }); return; }
    throw error;
  }
}

/** Rate limit, create RPC, then close the linked item for `done`. Shared by the Director form and the task decision route. */
export async function createInstructionAs(config: DirectorAuthConfiguration, reviewerId: string, key: string, input: InstructionInput): Promise<Response> {
  // Recipients are free text (roles, groups or officials).
  await rateLimit(config, `instruction:${reviewerId}`, 30, 3600);
  const { instruction, replayed } = await config.store.call<Stored>("create", { ...input, reviewerId, key, requestHash: canonicalHash(input) }, rpc);
  if (!replayed && input.action === "done" && input.linkedId) await closeLinked(config, input.linkedId, reviewerId);
  return jsonResponse({ instruction }, replayed ? 200 : 201);
}

export async function createInstruction(request: Request): Promise<Response> {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  const key = requestKey(request);
  const body = await readBoundedJson(request, 4096);
  let input;
  try { input = parseInstructionInput(body); } catch { throw new DirectorApiError(400, "Format arahan tidak valid."); }
  return createInstructionAs(config, reviewerId, key, input);
}
