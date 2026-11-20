import { wibTime } from "@/lib/director/director-data";
import { statusLabels, type InstructionAction, type InstructionInput } from "@/lib/director/director-instructions";
import type { BoardInstruction, ScheduleRow } from "@/lib/tasks/store";

/*
 * Client-side helpers for the Director task board (/arahan) and archive (/arahan/arsip): response shapes,
 * labels, request bodies and the one POST helper. Pure, so the tests can drive them without a DOM.
 */

export type BoardTask = BoardInstruction & { overdue: boolean; reminder: "none" | "due" | "escalated" };
export type BoardSummaryCounts = { open: number; overdue: number; kendala: number; escalated: number };
export type BoardData = { summary: BoardSummaryCounts; schedule: ScheduleRow[]; tasks: BoardTask[] };
export type TaskFilter = "terbuka" | "terlambat" | "kendala" | "tanpa_balasan";
export const taskFilters: readonly TaskFilter[] = ["terbuka", "terlambat", "kendala", "tanpa_balasan"];

export const taskStatusLabels: Record<string, string> = statusLabels;
const finalStatuses = new Set(["selesai", "ditunda", "dibatalkan"]);

/** `19.40 WIB` — Indonesian dot time. */
export function clockWib(iso: string): string {
  return wibTime(iso).replace(":", ".");
}
/** `09:00` → `09.00`. */
export const dotTime = (value: string) => value.slice(0, 5).replace(":", ".");

/** Only https links are rendered; anything else from a staff reply is dropped at render time. */
export function httpsAttachments<T extends { url: string }>(files: T[]): T[] {
  return files.filter((file) => file.url.startsWith("https://"));
}

export function filterTasks(tasks: BoardTask[], filter: TaskFilter): BoardTask[] {
  const open = tasks.filter((task) => !finalStatuses.has(task.status) && task.action !== "done");
  if (filter === "terlambat") return open.filter((task) => task.overdue);
  if (filter === "tanpa_balasan") return open.filter((task) => task.reminder === "escalated");
  if (filter === "kendala") return open.filter((task) => task.status === "terkendala");
  return open;
}

/** The newest task created from a decision on `id` (its `linkedId` points back), if the board still carries one. */
export function newestLinked(tasks: BoardTask[], id: string): BoardTask | undefined {
  return tasks.filter((task) => task.linkedId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** The instruction a schedule-row button creates (section `umum`, keyed on the schedule item). */
export function scheduleInstruction(item: ScheduleRow, action: Extract<InstructionAction, "approve" | "defer" | "assign">, note = ""): InstructionInput {
  return {
    reportDate: item.date, section: "umum", itemId: item.id, itemTitle: item.title, urgent: false, action,
    deadline: null, pic: item.pic, note: note.trim(), decisionOptionId: null, decisionLabel: null, linkedId: null, scheduleItemId: item.id,
  };
}

export type QuickKind = "putuskan" | "alihkan" | "tunda" | "hubungi_saya" | "selesai";
export type DecisionBody = { kind: QuickKind; note?: string; pic?: string[] };

/** Validates a kendala quick action before anything is posted. */
export function decisionBody(kind: QuickKind, note: string, picText: string): { body: DecisionBody } | { error: string } {
  const written = note.trim();
  if (kind === "putuskan") return written ? { body: { kind, note: written } } : { error: "Tulis keputusannya dulu." };
  if (kind === "alihkan") {
    const pic = [...new Set(picText.split(",").map((name) => name.trim()).filter(Boolean))];
    if (!pic.length) return { error: "Tulis minimal satu PIC." };
    if (pic.length > 8 || pic.some((name) => name.length > 60)) return { error: "Maksimal 8 PIC, masing-masing 60 karakter." };
    return { body: { kind, pic, ...(written ? { note: written } : {}) } };
  }
  return { body: { kind } };
}

export async function readJson<T>(response: Response, fallback = "Layanan tugas belum tersedia."): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}

/** POST with the session CSRF header (and an Idempotency-Key when given); throws the API's own error message. */
export async function postJson<T>(url: string, body: unknown, csrf: string, key?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-CSRF-Token": csrf, ...(key ? { "Idempotency-Key": key } : {}) };
  return readJson<T>(await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }));
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;
const HIDDEN_KEY = "melindaos.tasks.hiddenReplies";
const memoryHidden = new Set<string>();
const browserStorage = (): KeyValueStorage | undefined => { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } };

/** Replies the Director marked "Sudah dibaca": localStorage when it works, memory otherwise. */
export const hiddenReplies = {
  read(storage: KeyValueStorage | undefined = browserStorage()): Set<string> {
    const ids = new Set(memoryHidden);
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(HIDDEN_KEY) ?? "[]");
      if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string") ids.add(id);
    } catch { /* storage blocked or corrupt: memory only */ }
    return ids;
  },
  add(id: string, storage: KeyValueStorage | undefined = browserStorage()): void {
    memoryHidden.add(id);
    try { storage?.setItem(HIDDEN_KEY, JSON.stringify([...this.read(storage)].slice(-200))); } catch { /* memory only */ }
  },
};

export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
