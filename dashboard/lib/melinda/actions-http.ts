import { apiBoundary, DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson, requireConfiguration, requireHuman } from "../director/director-api";
import { decideAction } from "./actions";

const ACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Director's Konfirmasi or Batal on a proposal. Session, CSRF and origin come from `requireHuman(..., true)`. Kept apart from the read routes, which stay small. */
export const actionDecisionResponse = (request: Request, id: string) => apiBoundary(async () => {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  await rateLimit(config, `melinda-action:${reviewerId}`, 30, 600);
  const body = objectBody(await readBoundedJson(request, 1024), ["decision"]);
  if (body.decision !== "confirm" && body.decision !== "cancel") throw new DirectorApiError(400, "Keputusan harus confirm atau cancel.");
  if (!ACTION_ID.test(id)) throw new DirectorApiError(404, "Usulan tidak ditemukan.");
  return jsonResponse(await decideAction(config, { owner: reviewerId, id, decision: body.decision, now: new Date() }));
});
