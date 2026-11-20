import { randomBytes } from "node:crypto";
import { authConfiguration, authenticateBot, cookieSession, medifyPublisherConfiguration, satusehatPublisherConfiguration, csrfForSession, hashSecret, safeReturnPath, sessionCookie, verifyCsrf, verifyPasscode, type DirectorAuthConfiguration } from "./director-auth";
import { canonicalHash, compareReceivedRevisions, DirectorStoreError } from "./director-store";
import { parseDirectorSubmission, assertPublishableSubmission, SubmissionValidationError, type DirectorSubmission } from "./director-submission";
import { validReportDate } from "./director-data";
import { logError } from "../log";

export type Revision = { id: string; report_date: string; producer: string; payload_hash: string; payload: DirectorSubmission; status: "pending" | "published" | "rejected" | "superseded"; received_at: string };
export type ReviewQueue = { pending: Revision[]; publishedRevisionId: string | null; published: DirectorSubmission | null };
export class DirectorApiError extends Error {
  override readonly name = "DirectorApiError";
  constructor(public readonly status: number, message: string) { super(message); }
}
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
export async function apiBoundary(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); } catch (error) {
    if (error instanceof SubmissionValidationError) return jsonResponse({ error: "Format laporan tidak valid.", fields: error.paths }, 400);
    if (error instanceof DirectorStoreError || error instanceof DirectorApiError) return jsonResponse({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
    logError("director_api_unexpected", error);
    return jsonResponse({ error: "Layanan laporan belum tersedia. Coba lagi nanti." }, 503);
  }
}
export function requireConfiguration(): DirectorAuthConfiguration {
  const configuration = authConfiguration();
  if (!configuration) throw new DirectorApiError(503, "API pengiriman belum diaktifkan.");
  return configuration;
}
export async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new DirectorApiError(415, "Gunakan Content-Type application/json.");
  if (request.headers.get("Content-Encoding") && request.headers.get("Content-Encoding") !== "identity") throw new DirectorApiError(415, "Body terkompresi tidak didukung.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new DirectorApiError(413, "Ukuran permintaan melebihi batas.");
  if (!request.body) throw new DirectorApiError(400, "Body JSON wajib diisi.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DirectorApiError(413, "Ukuran permintaan melebihi batas."); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new DirectorApiError(400, "Body JSON tidak valid."); }
  } finally { reader.releaseLock(); }
}
export function objectBody(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) throw new DirectorApiError(400, "Format permintaan tidak valid.");
  return value as Record<string, unknown>;
}
export function requestKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new DirectorApiError(400, "Idempotency-Key wajib diisi (8–128 karakter).");
  return key;
}
export function validRevisionId(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new DirectorApiError(404, "Pengiriman tidak ditemukan.");
  return value;
}
export type HumanSessionRole = "director";

async function resolveHumanSession(
  config: DirectorAuthConfiguration,
  raw: string
): Promise<{ role: HumanSessionRole; reviewerId: string; passcodeSecret: string } | null> {
  const tokenHash = hashSecret(raw);
  const directorRead = await config.store.call<{ session: { reviewerId: string } | null }>("session_read", {
    tokenHash,
    credentialVersion: hashSecret(config.passcodeHash),
  });
  if (directorRead.session?.reviewerId === config.reviewerId) {
    return { role: "director", reviewerId: directorRead.session.reviewerId, passcodeSecret: config.passcodeHash };
  }
  return null;
}

export async function requireHuman(request: Request, config = requireConfiguration(), write = false) {
  const raw = cookieSession(request);
  if (!raw) throw new DirectorApiError(401, "Silakan masuk sebagai Direktur.");
  const resolved = await resolveHumanSession(config, raw);
  if (!resolved) throw new DirectorApiError(401, "Sesi berakhir. Silakan masuk kembali.");
  if (write && !verifyCsrf(request, raw, resolved.passcodeSecret, config.origin)) {
    throw new DirectorApiError(403, "Permintaan tidak berasal dari sesi yang sah.");
  }
  return { raw, reviewerId: resolved.reviewerId, role: resolved.role, config, passcodeSecret: resolved.passcodeSecret };
}
export async function rateLimit(config: DirectorAuthConfiguration, bucket: string, limit: number, seconds: number) {
  const result = await config.store.call<{ allowed: boolean }>("rate_limit", { bucket, limit, seconds });
  if (result.allowed !== true) throw new DirectorApiError(429, "Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.");
}
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}
export async function loginSession(request: Request): Promise<Response> {
  const config = requireConfiguration();
  if (request.headers.get("Origin") !== config.origin) throw new DirectorApiError(403, "Permintaan login ditolak.");
  const body = objectBody(await readBoundedJson(request, 4096), ["passcode"], ["returnTo", "role"]);
  // Throttle before verification so wrong passcodes count too; scrypt is CPU-bound.
  const ipBucket = `login-ip:${clientAddress(request)}`;
  await rateLimit(config, ipBucket, 10, 900);
  // `role` is still accepted from old cached login pages and ignored: Director is the only role.
  if (!verifyPasscode(body.passcode, config.passcodeHash)) throw new DirectorApiError(401, "Passcode tidak sesuai.");
  const role: HumanSessionRole = "director";
  const reviewerId = config.reviewerId;
  const passcodeSecret = config.passcodeHash;
  const bucket = `login:${reviewerId}`;
  await rateLimit(config, bucket, 5, 900);
  const raw = randomBytes(32).toString("hex");
  await config.store.call("session_create", {
    tokenHash: hashSecret(raw),
    reviewerId,
    credentialVersion: hashSecret(passcodeSecret),
  });
  await config.store.call("rate_reset", { bucket });
  await config.store.call("rate_reset", { bucket: ipBucket });
  return jsonResponse(
    { returnTo: safeReturnPath(body.returnTo), csrfToken: csrfForSession(raw, passcodeSecret), role },
    200,
    { "Set-Cookie": sessionCookie(raw, config.secure) }
  );
}
export async function getSession(request: Request): Promise<Response> {
  const { raw, reviewerId, role, passcodeSecret } = await requireHuman(request);
  return jsonResponse({ reviewerId, role, csrfToken: csrfForSession(raw, passcodeSecret) });
}
export async function logoutSession(request: Request): Promise<Response> {
  const { raw, config } = await requireHuman(request, requireConfiguration(), true);
  await config.store.call("session_revoke", { tokenHash: hashSecret(raw) });
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": sessionCookie("", config.secure, true) });
}
/** Medify documents accept only the dedicated Medify publisher key (the Biznet Gio scheduler). */
export function requireMedifyPublisher(request: Request): string {
  const medify = medifyPublisherConfiguration();
  const producerId = medify ? authenticateBot(request, medify) : null;
  if (!producerId) throw new DirectorApiError(401, "Token pengiriman tidak valid.");
  return producerId;
}
/** SATUSEHAT scheduled snapshots accept the dedicated SATUSEHAT publisher key or the configured Biznet publisher key. */
export function requireSatusehatPublisher(request: Request): string {
  const publisher = satusehatPublisherConfiguration();
  const producerId = publisher ? authenticateBot(request, publisher) : null;
  if (!producerId) throw new DirectorApiError(401, "Token pengiriman tidak valid.");
  return producerId;
}
/** The route resolves the caller (`requirePermission`, in `lib/access/access-api`, which imports this module) and passes the store in. */
export async function getReviewQueue(request: Request, { config }: { config: DirectorAuthConfiguration }): Promise<Response> {
  const url = new URL(request.url), date = url.searchParams.get("tanggal") ?? "";
  const offset = url.searchParams.get("offset") ?? "0";
  if (!validReportDate(date) || !/^\d{1,6}$/.test(offset)) throw new DirectorApiError(400, "Tanggal atau halaman antrean tidak valid.");
  return jsonResponse(await config.store.call<ReviewQueue>("review_list", { date, offset: Number(offset) }));
}
export async function reviewBrief(request: Request, id: string, { config, reviewerId }: { config: DirectorAuthConfiguration; reviewerId: string }): Promise<Response> {
  const key = requestKey(request);
  const body = objectBody(await readBoundedJson(request, 4096), ["action", "payloadHash", "expectedPublishedRevisionId"], ["reason"]);
  if (!["approve-and-publish", "reject"].includes(body.action as string) || typeof body.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(body.payloadHash) || (body.expectedPublishedRevisionId !== null && (typeof body.expectedPublishedRevisionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.expectedPublishedRevisionId)))) throw new DirectorApiError(400, "Format review tidak valid.");
  if (body.action === "reject" && (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500)) throw new DirectorApiError(400, "Alasan penolakan wajib diisi (maksimal 500 karakter).");
  const revisionId = validRevisionId(id);
  const { revision } = await config.store.call<{ revision: Revision }>("revision_read", { id: revisionId });
  if (canonicalHash(parseDirectorSubmission(revision.payload)) !== revision.payload_hash || revision.payload_hash !== body.payloadHash) throw new DirectorApiError(409, "Isi laporan berubah. Muat ulang antrean.");
  if (body.action === "approve-and-publish") {
    assertPublishableSubmission(revision.payload);
    if (revision.status === "pending") {
      const { published } = await config.store.call<{ published: Revision | null }>("published", { date: revision.report_date });
      if (published && compareReceivedRevisions(published, revision) < 0) throw new DirectorApiError(409, "Laporan lebih baru sudah diperiksa. Muat ulang sebelum memeriksa kiriman lama.");
    }
  }
  const args = { ...body, id: revisionId, reviewerId, key, requestHash: canonicalHash({ ...body, id: revisionId }) };
  return jsonResponse(await config.store.call("review", args));
}
