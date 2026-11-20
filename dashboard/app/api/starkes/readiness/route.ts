import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, jsonResponse } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { listStarkesAuditScores } from "@/lib/starkes/audit-store";
import { listEvidence } from "@/lib/starkes/evidence-store";
import { loadKelulusan } from "@/lib/starkes/kelulusan";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Everything the /starkes view needs in one call: register, Director audit scores, evidence, pass/fail rules. */
export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) await requirePermission(request, "starkes.use");
    const [scores, evidence, rules] = await Promise.all([listStarkesAuditScores(), listEvidence(), loadKelulusan()]);
    return jsonResponse({
      requirements: loadRequirementRegister().requirements,
      scores: scores.map((s) => ({ ep_id: s.ep_id, score: s.score, lock_state: s.lock_state })),
      evidence,
      rules,
    });
  });
});
