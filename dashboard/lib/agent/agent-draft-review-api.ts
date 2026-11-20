import { requirePermission } from "../access/access-api";
import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";
import { findPatientIdentifiers, identifierLabels } from "../phi-guard";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_RPC = "melinda_agent_gateway" as const;
const NOTE_MAX = 1000;
const STATUSES = ["submitted", "accepted", "rejected"] as const;
const CATEGORIES = ["A", "B", "C"] as const;
const EXTENSIONS = { A: ".md", B: ".prompt.md", C: ".json" } as const;

export type AgentDraftStatus = (typeof STATUSES)[number];
export type AgentDraftSummary = { id: string; producer: string; title: string; category: (typeof CATEGORIES)[number]; docId: string | null; domain: string | null; department: string | null; note: string | null; source: string | null; status: AgentDraftStatus; receivedAt: string; reviewedAt: string | null; reviewNote: string | null };
export type AgentDraft = AgentDraftSummary & { content: string };

const notFound = () => new DirectorApiError(404, "Draf tidak ditemukan.");
const invalidResponse = () => new DirectorStoreError(503, "invalid_response");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw invalidResponse();
  return value;
}
function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw invalidResponse();
  return value;
}
function parseSummary(value: unknown): AgentDraftSummary {
  if (!isRecord(value)) throw invalidResponse();
  const category = CATEGORIES.find((candidate) => candidate === value.category);
  const status = STATUSES.find((candidate) => candidate === value.status);
  if (!category || !status) throw invalidResponse();
  return {
    id: text(value, "id"), producer: text(value, "producer"), title: text(value, "title"), category,
    docId: optionalText(value, "docId"), domain: optionalText(value, "domain"), department: optionalText(value, "department"),
    note: optionalText(value, "note"), source: optionalText(value, "source"), status,
    receivedAt: text(value, "receivedAt"), reviewedAt: optionalText(value, "reviewedAt"), reviewNote: optionalText(value, "reviewNote"),
  };
}
function parseDraft(value: unknown): AgentDraft {
  if (!isRecord(value)) throw invalidResponse();
  return { ...parseSummary(value), content: text(value, "content") };
}

async function gateway(config: DirectorAuthConfiguration, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const result: unknown = await config.store.call<unknown>(command, args, AGENT_RPC);
    if (!isRecord(result)) throw invalidResponse();
    return result;
  } catch (error) {
    if (error instanceof DirectorStoreError && error.status === 404) throw notFound();
    if (error instanceof DirectorStoreError && error.status === 503) throw new DirectorApiError(503, "Draf dari agent belum tersedia.");
    if (error instanceof DirectorStoreError && error.status === 409) throw new DirectorApiError(409, "Draf ini sudah diputuskan.");
    throw error;
  }
}
function validId(id: string): string {
  if (!UUID_PATTERN.test(id)) throw notFound();
  return id;
}

/** File name for a downloaded draft: `draf-<first 8 of id>-<slug><extension by category>`. */
export function draftFileName(draft: Pick<AgentDraft, "id" | "title" | "category">): string {
  const dashed = (value: string) => value.replace(/^-+|-+$/g, "");
  const slug = dashed(dashed(draft.title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, "-")).slice(0, 60)) || "dokumen";
  return `draf-${draft.id.slice(0, 8)}-${slug}${EXTENSIONS[draft.category]}`;
}

/** `GET /api/director/agent-drafts?status=submitted|accepted|rejected` — newest drafts first, without content. */
export async function listAgentDrafts(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "director.only");
  const status = new URL(request.url).searchParams.get("status") ?? "submitted";
  if (!STATUSES.some((candidate) => candidate === status)) throw new DirectorApiError(400, "Status tidak dikenal.");
  const { submissions } = await gateway(config, "review_list", { status });
  if (!Array.isArray(submissions)) throw invalidResponse();
  return jsonResponse({ submissions: submissions.map(parseSummary) });
}

/** `GET /api/director/agent-drafts/[id]` — one draft with its content. */
export async function readAgentDraft(request: Request, id: string): Promise<Response> {
  const { config } = await requirePermission(request, "director.only");
  const { submission } = await gateway(config, "review_read", { id: validId(id) });
  return jsonResponse({ submission: parseDraft(submission) });
}

/** `POST /api/director/agent-drafts/[id]` — accept, or reject with a reason. Deciding the same way twice is a replay. */
export async function decideAgentDraft(request: Request, id: string): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "director.only", true);
  await rateLimit(config, `agent-draft-review:${reviewerId}`, 60, 60);
  const draftId = validId(id);
  const body = objectBody(await readBoundedJson(request, 4096), ["decision"], ["note"]);
  const decision = body.decision;
  if (decision !== "accepted" && decision !== "rejected") throw new DirectorApiError(400, "Format permintaan tidak valid.");
  if (body.note !== undefined && typeof body.note !== "string") throw new DirectorApiError(400, "Format permintaan tidak valid.");
  const note = (body.note ?? "").trim();
  if (decision === "rejected" && !note) throw new DirectorApiError(400, "Alasan penolakan wajib diisi.");
  if (note.length > NOTE_MAX) throw new DirectorApiError(400, "Catatan maksimal 1000 karakter.");
  const found = findPatientIdentifiers(note);
  if (found.length) {
    logError("agent_draft_review_phi_blocked", { status: 422 });
    throw new DirectorApiError(422, `Catatan memuat data pasien (${found.map((identifier) => identifierLabels[identifier]).join(", ")}). Hapus lalu coba lagi.`);
  }
  const { submission, replayed } = await gateway(config, "review_decide", { id: draftId, decision, note, reviewer: reviewerId });
  if (typeof replayed !== "boolean") throw invalidResponse();
  return jsonResponse({ submission: parseDraft(submission), replayed });
}

/** `GET /api/director/agent-drafts/[id]/unduh` — the accepted draft as a file; nothing is published from here. */
export async function downloadAgentDraft(request: Request, id: string): Promise<Response> {
  const { config } = await requirePermission(request, "director.only");
  const { submission } = await gateway(config, "review_read", { id: validId(id) });
  const draft = parseDraft(submission);
  if (draft.status !== "accepted") throw new DirectorApiError(409, "Draf belum diterima, jadi belum bisa diunduh.");
  return new Response(draft.content, {
    status: 200,
    headers: {
      "Content-Type": draft.category === "C" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${draftFileName(draft)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
