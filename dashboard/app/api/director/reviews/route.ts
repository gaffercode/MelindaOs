import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, getReviewQueue } from "@/lib/director/director-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(async () => getReviewQueue(request, await requirePermission(request, "executive.view"))); });
