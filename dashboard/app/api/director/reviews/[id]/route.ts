import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, reviewBrief } from "@/lib/director/director-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return apiBoundary(async () => reviewBrief(request, (await params).id, await requirePermission(request, "executive.view", true))); });
