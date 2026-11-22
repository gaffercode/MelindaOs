import { requirePermission } from "../access/access-api";
import {
  DirectorApiError,
  jsonResponse,
  objectBody,
  readBoundedJson,
  requestKey,
  validRevisionId,
} from "../director/director-api";
import {
  ClinicalValidationError,
  parseClinicalDraft,
  parseClinicalKind,
  parseClinicalPayload,
  parseClinicalStatus,
} from "./clinical-contract";
import { createClinicalEntry, updateClinicalEntry, type ClinicalUpdate } from "./clinical-store";
import { SHIFTS } from "./clinical-types";

function invalid(error: unknown): never {
  if (error instanceof ClinicalValidationError) throw new DirectorApiError(400, "Format isian klinis tidak valid.");
  throw error;
}

/** `POST /api/director/klinis` — the Director or a doctor adds one entry. The Idempotency-Key header makes a double click harmless. */
export async function createClinical(request: Request): Promise<Response> {
  const { config, principal } = await requirePermission(request, "clinical.use", true);
  const key = requestKey(request);
  const body = await readBoundedJson(request, 20_480);
  let draft;
  try {
    draft = parseClinicalDraft(body);
  } catch (error) {
    return invalid(error);
  }
  const receipt = await createClinicalEntry(config, { key, draft, actor: principal.displayName });
  return jsonResponse(receipt, receipt.replayed ? 200 : 201);
}

/**
 * `POST /api/director/klinis/[id]` — edit or cancel one entry. `revision` must be the one the caller read, so two people
 * editing the same entry cannot overwrite each other silently (a stale revision answers 409).
 */
export async function updateClinical(request: Request, id: string): Promise<Response> {
  const { config, principal } = await requirePermission(request, "clinical.use", true);
  const entryId = validRevisionId(id);
  const body = objectBody(await readBoundedJson(request, 20_480), ["kind", "revision"], ["status", "unit", "shift", "payload"]);
  const update: ClinicalUpdate = { id: entryId, kind: "handover", revision: 0, actor: principal.displayName };
  try {
    update.kind = parseClinicalKind(body.kind);
    if (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1) throw new ClinicalValidationError("revision");
    update.revision = body.revision;
    if (body.status !== undefined) update.status = parseClinicalStatus(body.status);
    if (body.unit !== undefined) {
      if (typeof body.unit !== "string" || body.unit.trim().length < 1 || body.unit.trim().length > 60) throw new ClinicalValidationError("unit");
      update.unit = body.unit.trim();
    }
    if (body.shift !== undefined) {
      const shift = SHIFTS.find((candidate) => candidate === body.shift) ?? null;
      if (body.shift !== null && shift === null) throw new ClinicalValidationError("shift");
      if (shift === null && update.kind !== "insiden") throw new ClinicalValidationError("shift");
      update.shift = shift;
    }
    if (body.payload !== undefined) update.payload = parseClinicalPayload(update.kind, body.payload);
  } catch (error) {
    return invalid(error);
  }
  const entry = await updateClinicalEntry(config, update);
  return jsonResponse({ entry });
}
