import { answerRequest } from "@/lib/ask/http";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, rateLimit } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tanya Melinda for the Director session. */
export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    if (protectedDirectorMode()) {
      const { config, reviewerId } = await requirePermission(request, "knowledge.ask", true);
      await rateLimit(config, `ask:${reviewerId}`, 30, 600);
    }
    return answerRequest(request);
  });
});
