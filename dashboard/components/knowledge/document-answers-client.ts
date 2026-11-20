import type { AnswerList } from "@/lib/director/director-answers-api";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { Decision, SlotDecision, StoredAnswer } from "@/lib/knowledge/document-answer-rules";
import { readJson } from "../tasks/board-client";

/*
 * Browser side of /api/director/document-answers. Type-only import of lib/director/director-answers-api: it is server code.
 * Every function throws an Error with the API's own message on failure; callers decide what that means.
 */

const PATH = "/api/director/document-answers";
const DECISIONS: readonly unknown[] = ["value", "confirm", "correction", "skip"] satisfies Decision[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStoredAnswer(value: unknown): value is StoredAnswer {
  return isRecord(value)
    && typeof value.id === "string" && typeof value.docPath === "string" && typeof value.lineText === "string"
    && typeof value.answeredBy === "string" && typeof value.answeredAt === "string"
    && Array.isArray(value.slots) && value.slots.every((slot: unknown) => isRecord(slot)
      && typeof slot.column === "number" && typeof slot.placeholder === "string" && DECISIONS.includes(slot.decision) && typeof slot.text === "string");
}

/** Stored answers that still match a queue line, and the ones whose line changed. */
export async function fetchAnswers(signal?: AbortSignal): Promise<AnswerList> {
  const body: unknown = await readJson<unknown>(await fetch(PATH, { cache: "no-store", signal }), "Jawaban belum dapat dibaca.");
  if (!isRecord(body) || !Array.isArray(body.answers) || !Array.isArray(body.orphaned) || !body.answers.every(isStoredAnswer) || !body.orphaned.every(isStoredAnswer)) {
    throw new Error("Jawaban tersimpan tidak dikenal.");
  }
  return { answers: body.answers, orphaned: body.orphaned };
}

/** Saves the answer for one line; `slots` has one decision per placeholder of the line, in order. */
export async function saveAnswer(id: string, slots: SlotDecision[]): Promise<void> {
  const headers = { "Content-Type": "application/json", ...(await directorCsrfHeaders()) };
  await readJson<unknown>(await fetch(PATH, { method: "POST", headers, body: JSON.stringify({ id, slots }) }), "Jawaban belum dapat disimpan.");
}

/** Removes the stored answer of one line, whether or not the line is still in the queue. */
export async function clearAnswer(id: string): Promise<void> {
  await readJson<unknown>(await fetch(`${PATH}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await directorCsrfHeaders() }), "Jawaban belum dapat dihapus.");
}
