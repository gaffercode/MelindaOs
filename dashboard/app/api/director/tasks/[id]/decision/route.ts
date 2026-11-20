import { directorDecision } from "@/lib/director/director-decision-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return directorDecision(request, (await params).id); });
