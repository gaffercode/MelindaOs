import { createHash, timingSafeEqual } from "node:crypto";
import { requirePermission } from "../access/access-api";
import { submitDailyDocument, submitDailyDocumentFile, type DailyDocumentReceipt } from "../daily/daily-documents";
import { DirectorApiError, jsonResponse, rateLimit, requireConfiguration } from "../director/director-api";
import { protectedDirectorMode, type DirectorAuthConfiguration } from "../director/director-auth";
import { canonicalHash } from "../director/director-store";
import { logError } from "../log";
import { findPatientIdentifiers } from "../phi-guard";
import { pullSatusehatOAuth, satusehatOAuthConfig } from "./satusehat-oauth-client";
import { parseSatusehatSnapshot, type SatusehatSnapshot } from "./satusehat-snapshot-contract";

function assertZeroPhi(payload: unknown): void {
  const visit = (value: unknown): boolean => {
    if (typeof value === "string") return findPatientIdentifiers(value).length > 0;
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    return Object.values(value).some(visit);
  };
  if (visit(payload)) {
    logError("satusehat_sync_phi_blocked", { status: 422 });
    throw new DirectorApiError(422, "Data hasil tarikan terdeteksi memuat identitas pasien dan ditolak.");
  }
}

export type PullAndStoreOptions = {
  config: DirectorAuthConfiguration | null;
  producerId: string;
  keyPrefix: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

/**
 * Pulls aggregate counts from the Kemenkes OAuth2 API, validates them (closed schema + PHI guard) and stores one
 * `satusehat_snapshot`. Shared by the Director sync button, the Vercel cron and the homepage "sync today" action.
 */
export async function pullAndStoreSatusehatSnapshot(options: PullAndStoreOptions): Promise<{ snapshot: SatusehatSnapshot; receipt: DailyDocumentReceipt }> {
  const oauth = satusehatOAuthConfig();
  if (!oauth) {
    throw new DirectorApiError(
      503,
      "Kunci sambungan otomatis Satu Sehat belum diatur di server (SATUSEHAT_CLIENT_ID, SATUSEHAT_CLIENT_SECRET, SATUSEHAT_ORG_ID).",
    );
  }

  let rawSnapshot;
  try {
    rawSnapshot = await pullSatusehatOAuth({ ...oauth, producer: options.producerId, fetch: options.fetch, now: options.now });
  } catch (error) {
    logError("satusehat_oauth_sync_failed", error);
    const message = error instanceof Error ? error.message : "Penarikan data dari Satu Sehat Kemenkes gagal.";
    throw new DirectorApiError(502, message);
  }

  const snapshot = parseSatusehatSnapshot(rawSnapshot);
  assertZeroPhi(snapshot);
  const key = `${options.keyPrefix}-${snapshot.date}-${canonicalHash(snapshot).slice(0, 16)}`;
  const submission = { producerId: options.producerId, key, date: snapshot.date, payload: snapshot };
  const receipt = options.config
    ? await submitDailyDocument(options.config, "satusehat_snapshot", submission)
    : await submitDailyDocumentFile("satusehat_snapshot", submission);
  return { snapshot, receipt };
}

/**
 * `POST /api/director/satusehat/sync` — Director/executive on-demand pull via Kemenkes OAuth2 API.
 * Checks executive permission and CSRF BEFORE checking OAuth2 env credentials so unauthenticated callers receive 401/403.
 */
export async function syncSatusehatLive(
  request: Request,
  deps: { fetch?: typeof globalThis.fetch; now?: () => Date } = {},
): Promise<Response> {
  let config: DirectorAuthConfiguration | null = null;
  let actorId = "local-dev";
  if (protectedDirectorMode()) {
    const allowed = await requirePermission(request, "executive.view", true);
    config = allowed.config;
    actorId = allowed.reviewerId;
  }

  if (!satusehatOAuthConfig()) {
    throw new DirectorApiError(
      503,
      "Kunci sambungan otomatis Satu Sehat belum diatur di server (SATUSEHAT_CLIENT_ID, SATUSEHAT_CLIENT_SECRET, SATUSEHAT_ORG_ID).",
    );
  }
  if (config) await rateLimit(config, `satusehat-sync:${actorId}`, 6, 300);

  const { snapshot, receipt } = await pullAndStoreSatusehatSnapshot({
    config,
    producerId: "dashboard-sync",
    keyPrefix: "satusehat-sync",
    fetch: deps.fetch,
    now: deps.now,
  });
  return jsonResponse({ snapshot, receipt }, receipt.replayed ? 200 : 201);
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Unset, short or mismatched secrets fail closed with 401. */
export function requireVercelCron(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (secret.length < 16 || !auth.startsWith("Bearer ") || auth.length > 512) {
    throw new DirectorApiError(401, "Kunci cron tidak valid.");
  }
  if (!timingSafeEqual(digest(auth.slice(7)), digest(secret))) {
    throw new DirectorApiError(401, "Kunci cron tidak valid.");
  }
}

/**
 * `GET /api/cron/satusehat` — scheduled by `vercel.json` at 05:55 and 17:55 WIB, five minutes before the Medify pull,
 * so the automatic Morning Brief composed after each Medify snapshot already reads same-day SATUSEHAT counts.
 */
export async function runSatusehatCron(
  request: Request,
  deps: { fetch?: typeof globalThis.fetch; now?: () => Date } = {},
): Promise<Response> {
  requireVercelCron(request);
  const config = protectedDirectorMode() ? requireConfiguration() : null;
  const { snapshot, receipt } = await pullAndStoreSatusehatSnapshot({
    config,
    producerId: "vercel-cron-satusehat",
    keyPrefix: "satusehat-cron",
    fetch: deps.fetch,
    now: deps.now,
  });
  return jsonResponse({ snapshot, receipt }, receipt.replayed ? 200 : 201);
}
