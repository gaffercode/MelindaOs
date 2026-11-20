import { requirePermission } from "../access/access-api";
import {
  clientAddress,
  DirectorApiError,
  jsonResponse,
  objectBody,
  rateLimit,
  readBoundedJson,
  requestKey,
  requireConfiguration,
  validRevisionId,
} from "../director/director-api";
import { parseReferralPayload, parseReferralStatus, ReferralValidationError } from "./referral-contract";
import { submitReferral, updateReferralStatus } from "./referral-store";
import type { ReferralDraft, ReferralStatus } from "./referral-types";

/** `POST /api/rujukan` — the public form. Same-origin, rate limited, size limited, never logged with content. */
export async function submitPublicReferral(request: Request): Promise<Response> {
  const config = requireConfiguration();
  if (request.headers.get("Origin") !== config.origin) throw new DirectorApiError(403, "Permintaan rujukan ditolak.");
  const key = requestKey(request);
  await rateLimit(config, `referral-ip:${clientAddress(request)}`, 5, 3600);
  const body = await readBoundedJson(request, 16_384);
  let payload: ReferralDraft;
  try {
    payload = parseReferralPayload(body);
  } catch (error) {
    if (error instanceof ReferralValidationError) throw new DirectorApiError(400, "Format rujukan tidak valid.");
    throw error;
  }
  const receipt = await submitReferral(config, { key, payload });
  return jsonResponse(receipt, receipt.replayed ? 200 : 201);
}

/** `POST /api/director/referrals/[id]` — the dashboard moves one referral through its statuses. */
export async function updateReferral(request: Request, id: string): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "executive.view", true);
  const referralId = validRevisionId(id);
  const body = objectBody(await readBoundedJson(request, 4096), ["status"], ["note"]);
  let status: ReferralStatus;
  try {
    status = parseReferralStatus(body.status);
  } catch {
    throw new DirectorApiError(400, "Status rujukan tidak valid.");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) throw new DirectorApiError(400, "Catatan terlalu panjang (maksimal 1000 karakter).");
  const referral = await updateReferralStatus(config, { id: referralId, status, note, actor: reviewerId });
  return jsonResponse({ referral });
}
