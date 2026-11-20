import type { Mark, MarkScope } from "@/lib/director/director-marks-api";
import { postJson, readJson } from "./tasks/board-client";

/*
 * Browser side of /api/director/marks: the Director's marks kept on the server so they follow the Director across devices.
 * Type-only import above: lib/director/director-marks-api is server code. Every function throws on failure; callers decide what that means.
 */

const MAX_ITEMS = 200;

function isMark(value: unknown): value is Mark {
  return typeof value === "object" && value !== null && "key" in value && "value" in value && typeof value.key === "string" && typeof value.value === "string";
}

/** The marks of one scope (and of one report date for `email_handling`). Throws on a non-OK answer or a wrong shape. */
export async function fetchMarks(scope: MarkScope, options: { date?: string; signal?: AbortSignal } = {}): Promise<Mark[]> {
  const url = `/api/director/marks?scope=${encodeURIComponent(scope)}${options.date === undefined ? "" : `&date=${encodeURIComponent(options.date)}`}`;
  const body = await readJson<{ marks?: unknown }>(await fetch(url, { cache: "no-store", signal: options.signal }), "Tanda belum dapat dibaca.");
  if (!Array.isArray(body.marks) || !body.marks.every(isMark)) throw new Error("Jawaban tanda tidak dikenal.");
  return body.marks.map(({ key, value }) => ({ key, value }));
}

/** Saves marks in requests of at most 200, one after the other; stops by throwing at the first one that fails. Sends nothing for no items. */
export async function saveMarks(scope: MarkScope, items: Mark[], csrf: string, date?: string): Promise<void> {
  for (let start = 0; start < items.length; start += MAX_ITEMS) {
    await postJson<unknown>("/api/director/marks", { scope, ...(date === undefined ? {} : { date }), items: items.slice(start, start + MAX_ITEMS) }, csrf);
  }
}

/** The local entries whose key the server does not have, in their order. A key both sides have is not returned, whatever its value. */
export function missingOnServer(local: Mark[], server: Mark[]): Mark[] {
  const known = new Set(server.map((mark) => mark.key));
  return local.filter((mark) => !known.has(mark.key));
}
