import type { BoardInstruction } from "./store";
import type { InstructionStatus } from "../director/director-instructions";

export type TaskForRules = {
  status: InstructionStatus | "ditunda" | "dibatalkan";
  /** "done" (Tandai selesai) records are always archived, never overdue, never reminded. */
  action: string;
  /** WIB wall-clock `YYYY-MM-DDTHH:mm`. */
  deadline: string | null;
  history: { status: string; at: string }[];
  remindersSent: number;
  lastReminderAt: string | null;
  lastReplyAt: string | null;
};

export const ARCHIVE_AFTER_MS = 7 * 86_400_000;
export const REMINDER_AFTER_MS = 24 * 3_600_000;
export const MAX_REMINDERS = 2;
const finalStatuses: readonly string[] = ["selesai", "ditunda", "dibatalkan"];
const forwardStatuses: readonly string[] = ["terkirim_ke_grokbot", "diteruskan"];

export const isFinal = (task: TaskForRules) => finalStatuses.includes(task.status);
const time = (value: string | null) => (value === null ? NaN : Date.parse(value));

/** The fields the rules read, from a board row. */
export const forRules = (item: BoardInstruction): TaskForRules => ({
  status: item.status, action: item.action, deadline: item.deadline, history: item.history,
  remindersSent: item.remindersSent, lastReminderAt: item.lastReminderAt, lastReplyAt: item.latestReply?.receivedAt ?? null,
});

export function isOverdue(task: TaskForRules, nowWib: string): boolean {
  return task.action !== "done" && !isFinal(task) && task.deadline !== null && task.deadline < nowWib;
}

export function reminderState(task: TaskForRules, now: Date): "none" | "due" | "escalated" {
  if (task.action === "done" || !forwardStatuses.includes(task.status)) return "none";
  let anchor = NaN;
  for (const entry of task.history) {
    const at = time(entry.at);
    if (forwardStatuses.includes(entry.status) && Number.isFinite(at) && !(at <= anchor)) anchor = at;
  }
  const reminder = time(task.lastReminderAt);
  if (Number.isFinite(reminder) && !(reminder <= anchor)) anchor = reminder;
  if (!Number.isFinite(anchor)) return "none";
  const reply = time(task.lastReplyAt);
  if (Number.isFinite(reply) && reply > anchor) return "none";
  if (now.getTime() - anchor < REMINDER_AFTER_MS) return "none";
  return task.remindersSent < MAX_REMINDERS ? "due" : "escalated";
}

export function bucket(task: TaskForRules, now: Date): "active" | "archive" {
  if (task.action === "done") return "archive";
  if (!isFinal(task)) return "active";
  const last = time(task.history.length ? task.history[task.history.length - 1].at : null);
  return Number.isFinite(last) && last < now.getTime() - ARCHIVE_AFTER_MS ? "archive" : "active";
}

export function boardSummary(tasks: TaskForRules[], now: Date, nowWib: string): { open: number; overdue: number; kendala: number; escalated: number } {
  const summary = { open: 0, overdue: 0, kendala: 0, escalated: 0 };
  for (const task of tasks) {
    if (bucket(task, now) !== "active" || isFinal(task)) continue;
    summary.open += 1;
    if (isOverdue(task, nowWib)) summary.overdue += 1;
    if (task.status === "terkendala") summary.kendala += 1;
    if (reminderState(task, now) === "escalated") summary.escalated += 1;
  }
  return summary;
}

export const HEARTBEAT_STALE_MS = 16 * 60 * 60 * 1000;

/** A producer is stale once its last heartbeat is more than 16 hours old (an unreadable timestamp counts as stale). Dash runs three times a day
 * (06.00, 11.00, 15.00 WIB); the longest normal gap is overnight, 15.00 to 06.00 = 15 hours. */
export function isStale(seenAt: string, now: Date): boolean {
  const seen = Date.parse(seenAt);
  return !Number.isFinite(seen) || now.getTime() - seen > HEARTBEAT_STALE_MS;
}
