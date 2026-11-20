import { createHash } from "node:crypto";
import { requirePermission } from "../access/access-api";
import { hasPermission } from "../access/access-control";
import { apiBoundary, DirectorApiError, jsonResponse, rateLimit, readBoundedJson } from "./director-api";
import { wibDate } from "./director-data";
import { createInstructionAs } from "./director-instructions-api";
import { parseInstructionInput, type Instruction } from "./director-instructions";
import { DirectorStoreError } from "./director-store";
import { ContractError } from "../tasks/contract";
import { parseDecision, type Decision } from "../tasks/decision";
import { setDirectorStatus, type DirectorFinalStatus } from "../tasks/store";

const statusKinds: Record<string, DirectorFinalStatus> = { tunda: "ditunda", batal: "dibatalkan", selesai: "selesai" };

async function readOriginal(config: Parameters<typeof setDirectorStatus>[0], id: string): Promise<Instruction> {
  try {
    return (await config.store.call<{ instruction: Instruction }>("read", { id }, "melinda_director_instructions")).instruction;
  } catch (error) {
    if (error instanceof DirectorStoreError && error.status === 404) throw new DirectorApiError(404, "Arahan tidak ditemukan.");
    throw error;
  }
}

/** Deterministic key: a double tap of the same decision on the same day replays the stored instruction. */
function decisionKey(id: string, kind: string, date: string, note: string, pic: string[]): string {
  return `decision:${id}:${kind}:${createHash("sha256").update(JSON.stringify([date, note, pic])).digest("hex").slice(0, 16)}`;
}

function linkedNote(decision: Decision, id: string): string {
  if (decision.kind === "hubungi_saya") return `Mohon segera menghubungi Direktur terkait arahan ${id}.`;
  return decision.note ?? `Arahan ${id} dialihkan oleh Direktur.`;
}

export const directorDecision = (request: Request, id: string) => apiBoundary(async () => {
  const { config, principal, reviewerId } = await requirePermission(request, "executive.view", true);
  if (!/^IOC-\d{4,9}$/.test(id)) throw new DirectorApiError(400, "Format id arahan tidak valid.");
  const body = await readBoundedJson(request, 2048);
  let decision: Decision;
  try { decision = parseDecision(body); } catch (error) {
    if (error instanceof ContractError) throw new DirectorApiError(400, error.message);
    throw error;
  }
  const finalStatus = statusKinds[decision.kind];
  // Spec section 7 (ruling R7): closing a task is executive work, but a decision that creates a new instruction is "Beri arahan".
  if (!finalStatus && !hasPermission(principal, "instructions.send")) throw new DirectorApiError(403, "Akses tidak sesuai peran.");
  await rateLimit(config, `decision:${reviewerId}`, 60, 3600);
  if (finalStatus) {
    const { instruction } = await setDirectorStatus(config, { id, status: finalStatus, actor: reviewerId, ...(decision.note ? { note: decision.note } : {}) });
    return jsonResponse({ instruction });
  }
  const original = await readOriginal(config, id);
  const date = wibDate();
  const pic = decision.kind === "alihkan" ? decision.pic! : original.pic;
  const note = linkedNote(decision, id);
  if (pic.length === 0) throw new DirectorApiError(400, "Arahan asal belum punya PIC. Gunakan Alihkan dan pilih PIC.");
  let input;
  try {
    input = parseInstructionInput({ reportDate: date, section: "umum", itemId: original.itemId, itemTitle: original.itemTitle, urgent: false, action: "assign", deadline: null, pic, note, decisionOptionId: null, decisionLabel: null, linkedId: id });
  } catch { throw new DirectorApiError(400, "Format arahan tidak valid."); }
  return createInstructionAs(config, reviewerId, decisionKey(id, decision.kind, date, note, input.pic), input);
});
