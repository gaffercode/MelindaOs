import { requirePermission } from "../access/access-api";
import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson } from "./director-api";
import type { DirectorAuthConfiguration } from "./director-auth";
import { DirectorStoreError } from "./director-store";

const RPC = "melinda_director_marks" as const;
const SCOPES = ["task_reply_read", "email_handling"] as const;
const REPLY_KEY = /^[A-Za-z0-9_-]{1,80}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 200;
const BODY_LIMIT = 32768;

export type MarkScope = (typeof SCOPES)[number];
export type Mark = { key: string; value: string };
export const EMAIL_HANDLING_VALUES = ["belum", "destri", "eskalasi"] as const;

const invalidResponse = () => new DirectorStoreError(503, "invalid_response");
const badKey = () => new DirectorApiError(400, "Kunci tanda tidak valid.");
const badValue = () => new DirectorApiError(400, "Nilai tanda tidak dikenal.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseScope(value: unknown): MarkScope {
  const scope = SCOPES.find((candidate) => candidate === value);
  if (!scope) throw new DirectorApiError(400, "Jenis tanda tidak dikenal.");
  return scope;
}
/** A real calendar date: `2026-02-30` matches the pattern but does not survive the round trip through `Date.UTC`. */
function parseDate(value: unknown): string {
  const invalid = () => new DirectorApiError(400, "Tanggal tidak valid.");
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw invalid();
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw invalid();
  return value;
}
/** The date of a request: required for `email_handling`, refused for `task_reply_read`. `undefined` means absent. */
function dateFor(scope: MarkScope, date: unknown): string | null {
  if (scope === "task_reply_read") {
    if (date !== undefined) throw new DirectorApiError(400, "Tanggal tidak berlaku untuk tanda ini.");
    return null;
  }
  return parseDate(date);
}
function validMailbox(key: string): boolean {
  return key.length >= 3 && key.length <= 120 && key === key.trim()
    && !key.split("").some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
    && /melinda/i.test(key);
}
/** One item of a save; for `email_handling` the stored key is `<date>:<mailbox>`, the mailbox exactly as sent. */
function parseItem(date: string | null, raw: unknown): Mark {
  const { key, value } = objectBody(raw, ["key", "value"]);
  if (typeof key !== "string") throw badKey();
  if (date === null) {
    if (!REPLY_KEY.test(key)) throw badKey();
    if (value !== "read") throw badValue();
    return { key, value };
  }
  if (!validMailbox(key)) throw new DirectorApiError(400, "Kotak surat tidak dikenal.");
  const status = EMAIL_HANDLING_VALUES.find((candidate) => candidate === value);
  if (!status) throw badValue();
  return { key: `${date}:${key}`, value: status };
}

async function storeCall(config: DirectorAuthConfiguration, command: "list" | "set", args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result: unknown = await config.store.call<unknown>(command, args, RPC);
  if (!isRecord(result)) throw invalidResponse();
  return result;
}
function parseMarks(value: unknown, prefix: string): Mark[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((row: unknown) => {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.value !== "string" || !row.key.startsWith(prefix)) throw invalidResponse();
    return { key: row.key.slice(prefix.length), value: row.value };
  });
}

/** `GET /api/director/marks?scope=&date=`: the Director's marks of one scope, newest first. */
export async function listMarks(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "director.only", false);
  const query = new URL(request.url).searchParams;
  const scope = parseScope(query.get("scope"));
  const date = dateFor(scope, query.get("date") ?? undefined);
  const prefix = date === null ? "" : `${date}:`;
  const { marks } = await storeCall(config, "list", date === null ? { scope } : { scope, prefix });
  return jsonResponse({ marks: parseMarks(marks, prefix) });
}

/** `POST /api/director/marks` with `{ scope, date?, items: [{ key, value }] }`: saves 1 to 200 marks. */
export async function saveMarks(request: Request): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "director.only", true);
  await rateLimit(config, `director-marks:${reviewerId}`, 120, 60);
  const body = objectBody(await readBoundedJson(request, BODY_LIMIT), ["scope", "items"], ["date"]);
  const scope = parseScope(body.scope);
  const date = dateFor(scope, body.date);
  const { items } = body;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw new DirectorApiError(400, "Daftar tanda harus berisi 1 sampai 200 butir.");
  const { saved } = await storeCall(config, "set", { scope, reviewer: reviewerId, items: items.map((item: unknown) => parseItem(date, item)) });
  if (typeof saved !== "number") throw invalidResponse();
  return jsonResponse({ saved });
}
