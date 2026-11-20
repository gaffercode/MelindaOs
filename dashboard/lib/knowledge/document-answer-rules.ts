/** Shapes and rules of the Director queue. Pure: the page, its client component and the API share this file. */

export type SlotLock = "clinical" | "number" | "date" | "signature" | "heading";
/** `header` is the header of the table column the placeholder sits in, null outside a table with a header row. */
export type QueueSlot = { column: number; placeholder: string; kind: "ISI" | "CEK"; detail: string | null; lock: SlotLock | null; header: string | null };
export type QueueItem = { id: string; docPath: string; docTitle: string; heading: string | null; text: string; slots: QueueSlot[] };
export type ValueRules = { maxLength: number; refusePattern: string };
export type DirectorQueue = { valueRules: ValueRules; items: QueueItem[]; drafts: string[] };
export type Decision = "value" | "confirm" | "correction" | "skip";
export type SlotDecision = { decision: Decision; text: string };
export type StoredSlot = SlotDecision & { column: number; placeholder: string };
export type StoredAnswer = { id: string; docPath: string; lineText: string; slots: StoredSlot[]; answeredBy: string; answeredAt: string };
export type LineState = "open" | "answered" | "locked";

export const CORRECTION_MAX = 280;

// Control characters and the two Unicode line separators: a value or a note is one line of text.
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// A pipe ends a table cell, a backtick starts inline code that hides the line's other placeholders, and
// placeholder syntax would put a gap back into the document.
const VALUE_FORBIDDEN = /[`|]|\[ISI|\[CEK/;
const LOCKS: readonly unknown[] = ["clinical", "number", "date", "signature", "heading"];

/** Null when the save is acceptable, otherwise the Indonesian message for a 400. */
export function saveError(item: QueueItem, slots: SlotDecision[], rules: ValueRules): string | null {
  if (slots.length !== item.slots.length) return "Jumlah isian tidak sesuai baris.";
  const pairs = item.slots.map((slot, index) => ({ slot, decision: slots[index].decision, text: slots[index].text }));
  if (pairs.some(({ slot, decision }) => slot.lock !== null && decision !== "skip")) return "Butir ini terkunci.";
  if (pairs.some(({ slot, decision }) => (slot.kind === "ISI" ? decision === "confirm" || decision === "correction" : decision === "value"))) {
    return "Pilihan tidak berlaku untuk butir ini.";
  }
  const values = pairs.filter(({ decision }) => decision === "value").map(({ text }) => text.trim());
  if (values.some((text) => text.length === 0 || text.length > rules.maxLength || CONTROL.test(text) || VALUE_FORBIDDEN.test(text))) {
    return "Isian tidak valid.";
  }
  const refuse = new RegExp(rules.refusePattern, "i");
  if (values.some((text) => refuse.test(text))) return "Isi dengan nilainya, bukan keterangan.";
  const corrections = pairs.filter(({ decision }) => decision === "correction").map(({ text }) => text.trim());
  if (corrections.some((text) => text.length === 0 || text.length > CORRECTION_MAX || CONTROL.test(text))) return "Catatan koreksi tidak valid.";
  if (pairs.some(({ decision, text }) => (decision === "confirm" || decision === "skip") && text !== "")) return "Isian tidak valid.";
  if (pairs.every(({ decision }) => decision === "skip")) return "Belum ada yang diisi.";
  return null;
}

export function lineState(item: QueueItem, answer: StoredAnswer | undefined): LineState {
  if (item.slots.every((slot) => slot.lock !== null)) return "locked";
  if (!answer) return "open";
  const decided = item.slots.every((slot, index) => slot.lock !== null || (index < answer.slots.length && answer.slots[index].decision !== "skip"));
  return decided ? "answered" : "open";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlot(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.column)
    && typeof value.placeholder === "string"
    && (value.kind === "ISI" || value.kind === "CEK")
    && (value.detail === null || typeof value.detail === "string")
    && (value.lock === null || LOCKS.includes(value.lock))
    && (value.header === null || typeof value.header === "string");
}

function isItem(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.docPath === "string"
    && typeof value.docTitle === "string"
    && (value.heading === null || typeof value.heading === "string")
    && typeof value.text === "string"
    && Array.isArray(value.slots) && value.slots.length > 0 && value.slots.every(isSlot);
}

function isPattern(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
}

export function isDirectorQueue(value: unknown): value is DirectorQueue {
  if (!isRecord(value) || !isRecord(value.valueRules)) return false;
  const { maxLength, refusePattern } = value.valueRules;
  return typeof maxLength === "number" && Number.isInteger(maxLength) && maxLength > 0
    && isPattern(refusePattern)
    && Array.isArray(value.items) && value.items.every(isItem)
    && Array.isArray(value.drafts) && value.drafts.every((path) => typeof path === "string");
}
