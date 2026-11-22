import { actionDecisionResponse } from "@/lib/melinda/actions-http";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return actionDecisionResponse(request, (await params).id); });
