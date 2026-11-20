import { requirePermission } from "../access/access-api";
import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson } from "./director-api";
import type { DirectorAuthConfiguration } from "./director-auth";
import { wibDate } from "./director-data";
import { loadDirectorQueue } from "./director-queue";
import { DirectorStoreError } from "./director-store";
import { saveError, type Decision, type DirectorQueue, type QueueItem, type SlotDecision, type StoredAnswer, type StoredSlot } from "../knowledge/document-answer-rules";

const RPC = "melinda_director_answers" as const;
const ID_PATTERN = /^[0-9a-f]{16}$/;
const DECISIONS: readonly Decision[] = ["value", "confirm", "correction", "skip"];
const BODY_LIMIT = 16384;

export type AnswerList = { answers: StoredAnswer[]; orphaned: StoredAnswer[] };
export type DownloadRow = { id: string; docPath: string; lineText: string; column: number; placeholder: string; decision: "value" | "confirm" | "correction"; text: string; answeredBy: string; answeredAt: string };
export type AnswerDownload = { exportedAt: string; rows: DownloadRow[] };

const invalidResponse = () => new DirectorStoreError(503, "invalid_response");
const badFormat = () => new DirectorApiError(400, "Format permintaan tidak valid.");
const unknownLine = () => new DirectorApiError(400, "Baris dokumen tidak dikenal.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function requireQueue(): Promise<DirectorQueue> {
  const queue = await loadDirectorQueue();
  if (!queue) throw new DirectorApiError(503, "Daftar isian belum tersedia.");
  return queue;
}
async function storeCall(config: DirectorAuthConfiguration, command: "list" | "set" | "clear", args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result: unknown = await config.store.call<unknown>(command, args, RPC);
  if (!isRecord(result)) throw invalidResponse();
  return result;
}

function parseStoredSlot(value: unknown): StoredSlot {
  if (!isRecord(value)) throw invalidResponse();
  const { column, placeholder, text } = value;
  const decision = DECISIONS.find((candidate) => candidate === value.decision);
  if (typeof column !== "number" || typeof placeholder !== "string" || !decision || typeof text !== "string") throw invalidResponse();
  return { column, placeholder, decision, text };
}
function parseStored(value: unknown): StoredAnswer {
  if (!isRecord(value)) throw invalidResponse();
  const { id, docPath, lineText, slots, answeredBy, answeredAt } = value;
  if (typeof id !== "string" || typeof docPath !== "string" || typeof lineText !== "string" || !Array.isArray(slots) || typeof answeredBy !== "string" || typeof answeredAt !== "string") throw invalidResponse();
  return { id, docPath, lineText, slots: slots.map(parseStoredSlot), answeredBy, answeredAt };
}
/** A stored row still answers its line when the line's text and placeholders are unchanged and the rules still accept it. */
function stillAnswers(item: QueueItem | undefined, row: StoredAnswer, queue: DirectorQueue): boolean {
  return item !== undefined
    && row.lineText === item.text
    && row.slots.length === item.slots.length
    && row.slots.every((slot, index) => slot.column === item.slots[index].column && slot.placeholder === item.slots[index].placeholder)
    && saveError(item, row.slots, queue.valueRules) === null;
}
async function readAnswers(config: DirectorAuthConfiguration, queue: DirectorQueue): Promise<AnswerList> {
  const { answers } = await storeCall(config, "list", {});
  if (!Array.isArray(answers)) throw invalidResponse();
  const items = new Map(queue.items.map((item) => [item.id, item]));
  const list: AnswerList = { answers: [], orphaned: [] };
  for (const row of answers.map(parseStored)) (stillAnswers(items.get(row.id), row, queue) ? list.answers : list.orphaned).push(row);
  return list;
}

/** One slot of a save: `{ decision, text? }`. The text is trimmed; a missing text is empty. */
function parseSlot(raw: unknown): SlotDecision {
  const body = objectBody(raw, ["decision"], ["text"]);
  const decision = DECISIONS.find((candidate) => candidate === body.decision);
  const text = body.text ?? "";
  if (!decision || typeof text !== "string") throw badFormat();
  return { decision, text: text.trim() };
}

/** `GET /api/director/document-answers`: stored answers, split into those that still match a queue line and the rest. */
export async function listAnswers(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "director.only", false);
  return jsonResponse(await readAnswers(config, await requireQueue()));
}

/** `POST /api/director/document-answers` with `{ id, slots: [{ decision, text? }] }`: saves the answer for one line. */
export async function saveAnswer(request: Request): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "director.only", true);
  await rateLimit(config, `director-answers:${reviewerId}`, 120, 60);
  const queue = await requireQueue();
  const body = objectBody(await readBoundedJson(request, BODY_LIMIT), ["id", "slots"]);
  if (!Array.isArray(body.slots)) throw badFormat();
  const slots = body.slots.map(parseSlot);
  const item = queue.items.find((candidate) => candidate.id === body.id);
  if (!item) throw unknownLine();
  const error = saveError(item, slots, queue.valueRules);
  if (error) throw new DirectorApiError(400, error);
  const stored = item.slots.map((slot, index) => ({ column: slot.column, placeholder: slot.placeholder, decision: slots[index].decision, text: slots[index].text }));
  const { saved } = await storeCall(config, "set", { reviewer: reviewerId, item: { id: item.id, docPath: item.docPath, lineText: item.text, slots: stored } });
  if (saved !== 1) throw invalidResponse();
  return jsonResponse({ saved });
}

/** `DELETE /api/director/document-answers?id=`: clears one stored answer, whether or not its line is still in the queue. */
export async function clearAnswer(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "director.only", true);
  await requireQueue();
  const id = new URL(request.url).searchParams.get("id");
  if (id === null || !ID_PATTERN.test(id)) throw unknownLine();
  const { cleared } = await storeCall(config, "clear", { id });
  if (cleared !== 0 && cleared !== 1) throw invalidResponse();
  return jsonResponse({ cleared });
}

/** `GET /api/director/document-answers/unduh`: the file `python -m readiness --answers` reads, one row per answered placeholder. */
export async function downloadAnswers(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "director.only", false);
  const queue = await requireQueue();
  const { answers } = await readAnswers(config, queue);
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const rows: DownloadRow[] = queue.items.flatMap((item) => {
    const answer = byId.get(item.id);
    if (!answer) return [];
    const { id, docPath, lineText, answeredBy, answeredAt } = answer;
    return answer.slots.flatMap(({ column, placeholder, decision, text }) => (decision === "skip" ? [] : [{ id, docPath, lineText, column, placeholder, decision, text, answeredBy, answeredAt }]));
  });
  const download: AnswerDownload = { exportedAt: new Date().toISOString(), rows };
  return jsonResponse(download, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="director-answers-${wibDate()}.json"`,
    "Cache-Control": "no-store",
  });
}
