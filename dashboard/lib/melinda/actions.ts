import { DirectorApiError } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { wibDate } from "../director/director-data";
import { INSTRUCTION_ID, parseInstructionInput, validDeadline, type Instruction, type InstructionInput } from "../director/director-instructions";
import { canonicalHash, DirectorStoreError } from "../director/director-store";
import { logError } from "../log";
import { findPatientIdentifiers } from "../phi-guard";
import { replaceSchedule, setDirectorStatus, vaultLedger, type DirectorFinalStatus } from "../tasks/store";
import { STRUCTURAL_ROLES } from "../work-schedule/baseline-schedule";
import { buildEnrichedScheduleForRole, directorScheduleItems, submitVaultTaskFeedback, syncTodayAllPages } from "../work-schedule/sync-and-feedback";
import { formatFeedbackNote, resolveVaultTasks, type ResolvedVaultTask, type VaultTaskStatus } from "../work-schedule/task-vault";
import { parseScheduleChange, readScheduleOverrides, ScheduleChangeError, scheduleChangeSummary, storeScheduleOverride, type ScheduleChange } from "../work-schedule/schedule-overrides";

/**
 * A change Melinda prepares in chat. The tool stores it as a proposal and the Director confirms it with a button;
 * only `executeAction`, called from the confirm route, writes. The model never holds anything it could confirm with.
 */
export type ActionKind = "ganti_pic" | "status_tugas" | "tindak_lanjut" | "tugas_baru" | "sinkron" | "ubah_jadwal";
export type ActionProposal = { id: string; kind: ActionKind; summary: string; expiresAt: string };
export type ActionOutcome = { status: "executed" | "failed" | "cancelled"; message: string };

const RPC = "melinda_actions";
const INSTRUCTIONS_RPC = "melinda_director_instructions";
export const ACTION_ACTOR = "Direktur (via /melinda)";
export const ACTION_TTL_SECONDS = 900;
export const ARAHAN_FINAL_STATUSES: readonly DirectorFinalStatus[] = ["selesai", "ditunda", "dibatalkan"];
const VAULT_STATUSES: readonly VaultTaskStatus[] = ["selesai", "berjalan", "pending_pihak_ketiga", "butuh_keputusan_direktur", "menunggu_verifikasi_novia"];

export class ActionInputError extends Error { override readonly name = "ActionInputError"; }
const reject = (message: string): never => { throw new ActionInputError(message); };

type VaultRef = { target: "vault"; task: ResolvedVaultTask };
type ArahanRef = { target: "arahan"; instruction: Instruction };

type Payload =
  | { kind: "ganti_pic"; target: "vault"; taskId: string; title: string; status: VaultTaskStatus; thirdPartyName: string | null; urgent: boolean; before: string[]; pic: string[]; note: string }
  | { kind: "ganti_pic"; target: "arahan"; instructionId: string; input: InstructionInput; before: string[]; pic: string[]; note: string }
  | { kind: "status_tugas"; target: "vault"; taskId: string; status: VaultTaskStatus; thirdPartyName: string | null; note: string }
  | { kind: "status_tugas"; target: "arahan"; instructionId: string; status: DirectorFinalStatus; note: string }
  | { kind: "tindak_lanjut"; input: InstructionInput; vaultTaskId: string | null }
  | { kind: "tugas_baru"; input: InstructionInput }
  | { kind: "sinkron"; date: string }
  | { kind: "ubah_jadwal"; change: ScheduleChange };

function text(value: unknown, max: number, label: string, required = false): string {
  const written = typeof value === "string" ? value.trim() : "";
  if ((required && !written) || written.length > max || /[\u0000-\u001f\u007f]/.test(written)) reject(`${label} tidak valid.`);
  return written;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return reject("PIC harus 1 sampai 8 nama.");
  return [...new Set(value.map((name) => text(name, 60, "Nama PIC", true)))];
}

/** Patient identifiers never reach the instruction ledger or the schedule, whoever typed them. */
function assertNoPatientData(value: unknown): void {
  const strings: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  if (strings.some((item) => findPatientIdentifiers(item).length > 0)) reject("Usulan memuat data pasien; data itu tidak boleh dicatat di sini.");
}

/** Officials known to the dashboard: the structural roles and the officials list of the instruction form. */
export async function knownOfficials(config: DirectorAuthConfiguration): Promise<{ name: string; role: string | null }[]> {
  const fromRoles = STRUCTURAL_ROLES.map((role) => ({ name: role.officialName, role: role.title }));
  const listed = await config.store.call<{ officials: string[] }>("list", {}, "melinda_director_officials")
    .then((result) => result.officials, (error: unknown) => { logError("melinda_officials_unavailable", error); return [] as string[]; });
  const seen = new Set(fromRoles.map((item) => item.name.toLowerCase()));
  return [...fromRoles, ...listed.filter((name) => !seen.has(name.toLowerCase())).map((name) => ({ name, role: null }))];
}

async function findTask(config: DirectorAuthConfiguration, now: Date, id: string): Promise<VaultRef | ArahanRef> {
  if (INSTRUCTION_ID.test(id)) {
    try {
      const { instruction } = await config.store.call<{ instruction: Instruction }>("read", { id }, INSTRUCTIONS_RPC);
      return { target: "arahan", instruction };
    } catch (error) {
      if (error instanceof DirectorStoreError && error.status === 404) reject(`Arahan ${id} tidak ditemukan.`);
      throw error;
    }
  }
  const instructions = await vaultLedger(config, { now: now.toISOString() });
  const task = resolveVaultTasks(instructions, true).find((item) => item.id === id);
  return task ? { target: "vault", task } : reject(`Tugas ${id} tidak ditemukan di Task Vault atau Arahan.`);
}

const list = (items: readonly string[]) => (items.length ? items.join(", ") : "belum ada PIC");
/** Every text the change writes is in the summary, so the Director confirms exactly what is stored. */
const withNote = (summary: string, note: string) => (note ? `${summary} Catatan: "${note}".` : summary);

/** The vault task as it stands now; a proposal can be up to 15 minutes old when it is confirmed. */
async function currentVaultTask(config: DirectorAuthConfiguration, id: string): Promise<ResolvedVaultTask | undefined> {
  return resolveVaultTasks(await vaultLedger(config, { now: new Date().toISOString() }), true).find((item) => item.id === id);
}

/** Checks the model's input against the stored state and returns the exact payload and a summary written by the server. */
async function prepare(config: DirectorAuthConfiguration, now: Date, kind: ActionKind, input: Record<string, unknown>): Promise<{ payload: Payload; summary: string }> {
  const today = wibDate(now);
  if (kind === "ganti_pic") {
    const ref = await findTask(config, now, text(input.task_id, 80, "ID tugas", true));
    const pic = names(input.pic);
    const note = text(input.catatan, 200, "Catatan");
    if (ref.target === "vault") {
      const { task } = ref;
      return {
        payload: { kind, target: "vault", taskId: task.id, title: task.title.slice(0, 140), status: task.status, thirdPartyName: task.thirdPartyName ?? null, urgent: task.priority === "P0", before: [...task.pic], pic, note },
        summary: withNote(`Ganti PIC ${task.id} "${task.title.slice(0, 80)}": ${list(task.pic)} → ${list(pic)}. Status tetap ${task.status}.`, note),
      };
    }
    const { instruction } = ref;
    const carried: InstructionInput = {
      reportDate: today, section: instruction.section, itemId: instruction.itemId, itemTitle: instruction.itemTitle, urgent: instruction.urgent,
      action: "assign", deadline: null, pic, note: note || `Dialihkan dari ${list(instruction.pic)}.`, decisionOptionId: null, decisionLabel: null, linkedId: instruction.id,
    };
    return {
      payload: { kind, target: "arahan", instructionId: instruction.id, input: parseInstructionInput(carried), before: [...instruction.pic], pic, note },
      summary: withNote(`Ganti PIC arahan ${instruction.id} "${instruction.itemTitle.slice(0, 80)}": ${list(instruction.pic)} → ${list(pic)}. Arahan lama ditutup sebagai dialihkan.`, note),
    };
  }
  if (kind === "status_tugas") {
    const ref = await findTask(config, now, text(input.task_id, 80, "ID tugas", true));
    const note = text(input.catatan, 200, "Catatan");
    if (ref.target === "vault") {
      const status = VAULT_STATUSES.find((item) => item === input.status) ?? reject("Status Task Vault tidak dikenal.");
      const thirdPartyName = text(input.pihak_ketiga, 80, "Pihak ke-3") || null;
      return {
        payload: { kind, target: "vault", taskId: ref.task.id, status, thirdPartyName, note },
        summary: withNote(`Status ${ref.task.id} "${ref.task.title.slice(0, 80)}": ${ref.task.status} → ${status}${thirdPartyName ? ` (pihak ke-3: ${thirdPartyName})` : ""}.`, note),
      };
    }
    const status = ARAHAN_FINAL_STATUSES.find((item) => item === input.status) ?? reject("Status arahan hanya selesai, ditunda, atau dibatalkan.");
    return {
      payload: { kind, target: "arahan", instructionId: ref.instruction.id, status, note },
      summary: withNote(`Status arahan ${ref.instruction.id} "${ref.instruction.itemTitle.slice(0, 80)}": ${ref.instruction.status} → ${status}.`, note),
    };
  }
  if (kind === "tindak_lanjut") {
    const deadline = text(input.tenggat, 16, "Tenggat", true);
    if (!validDeadline(deadline)) reject("Tenggat harus berbentuk YYYY-MM-DDTHH:MM.");
    const pic = names(input.pic);
    const note = text(input.catatan, 200, "Catatan");
    const taskId = text(input.task_id, 80, "ID tugas");
    const ref = taskId ? await findTask(config, now, taskId) : null;
    const itemTitle = ref?.target === "vault" ? ref.task.title : ref?.target === "arahan" ? ref.instruction.itemTitle : text(input.judul, 300, "Judul", true);
    const parsed = parseInstructionInput({
      reportDate: today, section: "followUps", itemId: ref?.target === "vault" ? ref.task.id : ref?.target === "arahan" ? ref.instruction.itemId : `MEL-${now.getTime()}`,
      itemTitle, urgent: false, action: "request_update", deadline, pic, note, decisionOptionId: null, decisionLabel: null,
      linkedId: ref?.target === "arahan" ? ref.instruction.id : null,
    });
    return { payload: { kind, input: parsed, vaultTaskId: ref?.target === "vault" ? ref.task.id : null }, summary: withNote(`Tindak lanjut "${itemTitle.slice(0, 80)}" ke ${list(pic)}, tenggat ${deadline.replace("T", " ")} WIB.`, note) };
  }
  if (kind === "tugas_baru") {
    const deadline = text(input.tenggat, 16, "Tenggat") || null;
    if (deadline && !validDeadline(deadline)) reject("Tenggat harus berbentuk YYYY-MM-DDTHH:MM.");
    const pic = names(input.pic);
    const itemTitle = text(input.judul, 300, "Judul", true);
    // A deadline is only allowed on request_update and escalate; a new task with a deadline asks for an update by then.
    const parsed = parseInstructionInput({
      reportDate: today, section: "umum", itemId: `MEL-${now.getTime()}`, itemTitle, urgent: input.mendesak === true,
      action: deadline ? "request_update" : "assign", deadline, pic, note: text(input.catatan, 200, "Catatan"), decisionOptionId: null, decisionLabel: null, linkedId: null,
    });
    return { payload: { kind, input: parsed }, summary: withNote(`Tugas baru "${itemTitle.slice(0, 80)}" untuk ${list(pic)}${deadline ? `, tenggat ${deadline.replace("T", " ")} WIB` : ""}${parsed.urgent ? ", mendesak" : ""}.`, parsed.note) };
  }
  if (kind === "sinkron") {
    const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
    return { payload: { kind, date }, summary: `Sinkronkan jadwal, Task Vault, Morning Brief, Arahan, dan Warta untuk ${date}.` };
  }
  const change = parseScheduleChange(input, today);
  const overrides = await readScheduleOverrides(config, change.date, change.role);
  const slots = buildEnrichedScheduleForRole(change.date, change.role, [], overrides).slots;
  return { payload: { kind, change }, summary: scheduleChangeSummary(change, slots) };
}

/** Stores a proposal. Input errors come back as `ActionInputError`, so the model can say what is wrong. */
export async function proposeAction(config: DirectorAuthConfiguration, { owner, conversationId, now, kind, input }: { owner: string; conversationId: string | null; now: Date; kind: ActionKind; input: Record<string, unknown> }): Promise<ActionProposal> {
  let prepared: { payload: Payload; summary: string };
  try { prepared = await prepare(config, now, kind, input); }
  catch (error) {
    if (error instanceof ActionInputError) throw error;
    if (error instanceof ScheduleChangeError) throw new ActionInputError(error.message);
    if (error instanceof Error && error.message === "Format arahan tidak valid.") throw new ActionInputError(error.message);
    throw error;
  }
  assertNoPatientData(prepared.payload);
  const { action } = await config.store.call<{ action: ActionProposal }>("propose", {
    owner, conversationId, kind, summary: prepared.summary, payload: prepared.payload, payloadHash: canonicalHash(prepared.payload), ttlSeconds: ACTION_TTL_SECONDS,
  }, RPC);
  return { id: action.id, kind: action.kind, summary: action.summary, expiresAt: action.expiresAt };
}

async function createInstruction(config: DirectorAuthConfiguration, actionId: string, input: InstructionInput): Promise<Instruction> {
  const { instruction } = await config.store.call<{ instruction: Instruction }>("create", { ...input, reviewerId: ACTION_ACTOR, key: `melinda-action-${actionId}`, requestHash: canonicalHash(input) }, INSTRUCTIONS_RPC);
  return instruction;
}

async function run(config: DirectorAuthConfiguration, actionId: string, payload: Payload, today: string): Promise<string> {
  switch (payload.kind) {
    case "ganti_pic": {
      if (payload.target === "arahan") {
        const created = await createInstruction(config, actionId, payload.input);
        await setDirectorStatus(config, { id: payload.instructionId, status: "dibatalkan", actor: ACTION_ACTOR, note: `Dialihkan ke ${list(payload.pic)} (${created.id}).` });
        return `PIC diganti ke ${list(payload.pic)}; arahan baru ${created.id}.`;
      }
      // The status is read again here: a staff report in the meantime must not be overwritten by the proposal's copy.
      const current = await currentVaultTask(config, payload.taskId);
      const created = await createInstruction(config, actionId, parseInstructionInput({
        reportDate: today, section: "followUps", itemId: payload.taskId, itemTitle: payload.title, urgent: payload.urgent, action: "assign", deadline: null, pic: payload.pic,
        note: formatFeedbackNote({ status: current?.status ?? payload.status, thirdPartyName: (current ? current.thirdPartyName : payload.thirdPartyName) ?? undefined, text: payload.note || `Dialihkan ke ${list(payload.pic)}.`, executive: true }),
        decisionOptionId: null, decisionLabel: null, linkedId: null,
      }));
      return `PIC ${payload.taskId} sekarang ${list(payload.pic)} (${created.id}).`;
    }
    case "status_tugas": {
      if (payload.target === "arahan") {
        await setDirectorStatus(config, { id: payload.instructionId, status: payload.status, actor: ACTION_ACTOR, ...(payload.note ? { note: payload.note } : {}) });
        return `Arahan ${payload.instructionId} sekarang ${payload.status}.`;
      }
      const result = await submitVaultTaskFeedback(config, {
        date: today, taskId: payload.taskId, status: payload.status, thirdPartyName: payload.thirdPartyName ?? undefined, note: payload.note || undefined, actorRole: "DIRECTOR", actorLabel: ACTION_ACTOR,
      });
      return `Status ${payload.taskId} sekarang ${result.resolvedStatus} (${result.instructionId}).`;
    }
    case "tindak_lanjut": {
      let input = payload.input;
      // On a vault task the follow-up row becomes its latest record, so it carries the task's current status.
      const current = payload.vaultTaskId ? await currentVaultTask(config, payload.vaultTaskId) : undefined;
      if (current) input = { ...input, note: formatFeedbackNote({ status: current.status, thirdPartyName: current.thirdPartyName, text: input.note || "Minta update.", executive: true }) };
      const created = await createInstruction(config, actionId, input);
      return `Tercatat sebagai arahan ${created.id} untuk ${list(input.pic)}.`;
    }
    case "tugas_baru": {
      const created = await createInstruction(config, actionId, payload.input);
      return `Tercatat sebagai arahan ${created.id} untuk ${list(payload.input.pic)}.`;
    }
    case "sinkron": {
      const result = await syncTodayAllPages(config, payload.date);
      return `Halaman ${result.date} disinkronkan.`;
    }
    case "ubah_jadwal": {
      const { change } = payload;
      await storeScheduleOverride(config, { change, key: `melinda-action-${actionId}`, producer: "melinda-chat" });
      if (change.role !== "direktur") return `Jadwal ${change.role} ${change.date} diperbarui.`;
      // The Director's day is also stored as rows (home page, /arahan); rewrite them so they show the change now.
      const instructions = await vaultLedger(config, { now: new Date().toISOString() });
      const overrides = await readScheduleOverrides(config, change.date, "direktur");
      const { slots } = buildEnrichedScheduleForRole(change.date, "direktur", instructions, overrides);
      await replaceSchedule(config, { date: change.date, items: directorScheduleItems(slots), producer: "melinda-chat" });
      return `Jadwal Direktur ${change.date} diperbarui (${slots.length} agenda).`;
    }
  }
}

/** The Director's click: claims the proposal once, checks it was not altered, runs it, and records the outcome. */
export async function decideAction(config: DirectorAuthConfiguration, { owner, id, decision, now }: { owner: string; id: string; decision: "confirm" | "cancel"; now: Date }): Promise<ActionOutcome> {
  const failWith = (error: unknown): never => {
    if (error instanceof DirectorStoreError && error.code === "not_found") throw new DirectorApiError(404, "Usulan tidak ditemukan.");
    if (error instanceof DirectorStoreError && error.code === "expired") throw new DirectorApiError(409, "Usulan sudah kedaluwarsa. Minta Melinda menyiapkannya lagi.");
    if (error instanceof DirectorStoreError && error.code === "conflict") throw new DirectorApiError(409, "Usulan ini sudah diputuskan.");
    throw error;
  };
  if (decision === "cancel") {
    await config.store.call("cancel", { owner, id }, RPC).catch(failWith);
    return { status: "cancelled", message: "Usulan dibatalkan." };
  }
  const { action } = await config.store.call<{ action: { id: string; payload: Payload; payloadHash: string } }>("claim", { owner, id }, RPC).catch(failWith);
  if (canonicalHash(action.payload) !== action.payloadHash) {
    await config.store.call("finish", { owner, id, outcome: "failed", result: { reason: "payload_hash_mismatch" } }, RPC);
    throw new DirectorApiError(409, "Usulan berubah setelah disiapkan; tidak dijalankan.");
  }
  try {
    const message = await run(config, action.id, action.payload, wibDate(now));
    await config.store.call("finish", { owner, id, outcome: "executed", result: { message } }, RPC).catch((error: unknown) => logError("melinda_action_finish", error));
    return { status: "executed", message };
  } catch (error) {
    logError("melinda_action_run", error);
    await config.store.call("finish", { owner, id, outcome: "failed", result: { reason: "run_failed" } }, RPC).catch((finishError: unknown) => logError("melinda_action_finish", finishError));
    return { status: "failed", message: "Perubahan gagal disimpan. Data tidak berubah atau hanya sebagian; periksa halaman terkait." };
  }
}
