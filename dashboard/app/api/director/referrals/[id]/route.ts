import { guard } from "@/lib/access/guard";
import { apiBoundary } from "@/lib/director/director-api";
import { updateReferral } from "@/lib/referral/referral-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = guard(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return apiBoundary(() => updateReferral(request, id));
});
