import { DirectorApiError } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import type { Instruction } from "../director/director-instructions";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";
import type { ScheduleItemInput, StaffReplyInput } from "./contract";

const rpc = "melinda_director_tasks";

/** An instruction as `melinda_director_tasks` returns it: the base shape plus the task columns added in migration 202611080001. */
export type TaskInstruction = Instruction & { linkedId: string | null; scheduleItemId: string | null; remindersSent: number; lastReminderAt: string | null };
export type StaffReply = {
  id: string; instructionId: string; key: string; receivedAt: string; fromName: string; originalText: string;
  attachments: { url: string; mime: string }[]; summary: string | null; needs: string | null;
  classifiedStatus: StaffReplyInput["classifiedStatus"]; confidence: number | null; producer: string; createdAt: string;
};
export type ScheduleRow = {
  id: string; date: string; position: number; start: string; end: string | null; title: string; place: string | null;
  pic: string[]; topic: string | null; producer: string; createdAt: string; taskIds: string[];
};
export type BoardInstruction = TaskInstruction & { latestReply: StaffReply | null };
export type DirectorFinalStatus = "ditunda" | "dibatalkan" | "selesai";
export type ArchiveArgs = { now: string; from?: string; to?: string; q?: string; pic?: string; status?: string; offset: number; all?: boolean };

/**
 * One call to the tasks RPC. `SupabaseDirectorStore.call` throws `DirectorStoreError(status, code)` where the status is
 * 409/404/503 and the code is the RPC's errorCode; here the code decides: conflict 409, not_found 404, invalid_input and invalid_status 400
 * (a `DirectorApiError`, so the response carries a request-error message), anything else 503 with the code logged.
 */
async function call<T>(config: DirectorAuthConfiguration, command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await config.store.call<T>(command, args, rpc);
  } catch (error) {
    if (!(error instanceof DirectorStoreError)) throw error;
    if (error.code === "conflict") throw new DirectorStoreError(409, error.code);
    if (error.code === "not_found") throw new DirectorStoreError(404, error.code);
    if (error.code === "invalid_input" || error.code === "invalid_status") throw new DirectorApiError(400, "Format permintaan tidak valid.");
    logError(`tasks_store_${/^[a-z_]{1,40}$/.test(error.code) ? error.code : "unknown"}`, error);
    throw new DirectorStoreError(503, error.code);
  }
}

export const replaceSchedule = (config: DirectorAuthConfiguration, args: { date: string; items: ScheduleItemInput[]; producer: string }) =>
  call<{ date: string; count: number }>(config, "schedule_replace", args);
export const listSchedule = (config: DirectorAuthConfiguration, args: { date: string }) =>
  call<{ date: string; items: ScheduleRow[] }>(config, "schedule_list", args);

export async function addReply(config: DirectorAuthConfiguration, instructionId: string, reply: StaffReplyInput, producer: string): Promise<{ reply: StaffReply; statusApplied: boolean | null; replayed: boolean }> {
  const result = await call<{ reply: StaffReply; statusApplied: boolean | null; replayed: boolean }>(config, "reply_add", {
    ...reply, key: `reply:${instructionId}:${reply.kattMessageId}`, instructionId, producer,
  });
  return { reply: result.reply, statusApplied: result.statusApplied, replayed: result.replayed };
}
export const listReplies = (config: DirectorAuthConfiguration, args: { instructionIds: string[] }) =>
  call<{ replies: StaffReply[] }>(config, "replies_list", args);
export const setDirectorStatus = (config: DirectorAuthConfiguration, args: { id: string; status: DirectorFinalStatus; actor: string; note?: string }) =>
  call<{ instruction: TaskInstruction }>(config, "director_status", args);
export const markReminderSent = (config: DirectorAuthConfiguration, args: { id: string; at: string }) =>
  call<{ instruction: TaskInstruction }>(config, "reminder_sent", args);
export const heartbeat = (config: DirectorAuthConfiguration, args: { producer: string }) =>
  call<{ heartbeats: { producer: string; seenAt: string }[] }>(config, "heartbeat", args);
export const health = (config: DirectorAuthConfiguration) =>
  call<{ heartbeats: { producer: string; seenAt: string }[] }>(config, "health");
export const board = (config: DirectorAuthConfiguration, args: { now: string }) =>
  call<{ instructions: BoardInstruction[] }>(config, "board", args);
export const archive = (config: DirectorAuthConfiguration, args: ArchiveArgs) =>
  call<{ instructions: BoardInstruction[]; offset: number; pageSize: number; hasMore: boolean }>(config, "archive", args);
